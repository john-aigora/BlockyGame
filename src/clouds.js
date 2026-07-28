import * as THREE from 'three';
import {
    CLOUD_ALTITUDE_MIN, CLOUD_ALTITUDE_MAX, CLOUD_WIND_X, CLOUD_WIND_Z,
    CLOUD_BOB_AMPLITUDE, CLOUD_BOB_SPEED, CLOUD_OPACITY,
    CLASSIC_CLOUD_COUNT, CLOUD_CHUNK_CHANCE, CLOUD_APPEAR_TIME,
    CLOUD_CLEAR_NEAR, CLOUD_CLEAR_FAR,
    TERRAIN_SEED, CHUNK_SIZE, worldBoundary
} from './constants.js';
import { state } from './state.js';
import { wrapCoord, torusDeltaComponent } from './worldmath.js';

// --- Fluffy voxel clouds (owner queue item 4) ---
// Pure scenery in BOTH modes: clusters of 3-6 soft-white boxes floating at
// CLOUD_ALTITUDE_MIN..MAX with a gentle per-cloud bob and one shared wind
// drift. Resource discipline (plan 007 law): ONE shared unit-box geometry
// (every puff is a scaled instance) + ONE shared material for every cloud
// in the game — the renderer's geometry count never moves, no matter how
// many clouds stream in and out. castShadow stays OFF: a drifting shadow
// over the play field would be readability noise, and the shadow camera
// never reaches cloud altitude anyway.
//
// CLASSIC: a fixed pool of CLASSIC_CLOUD_COUNT clouds scattered over the
// arena. Their canonical anchors drift and wrap on the torus (wrapCoord),
// and each frame the mesh renders at the player-relative nearest image
// (torusDeltaComponent) — the same seamless-seam treatment as collectibles.
// ENDLESS: seeded per chunk (~1 per 2-3 chunks), streamed and RELEASED with
// the chunk window through the terrain.js build/release hooks, recycling
// through a pool exactly like the boulders. In endless, wrapCoord is the
// identity and torusDeltaComponent is plain subtraction, so the SAME anchor
// math renders them in place — one code path, both worlds.
//
// Reduced motion: drift and bob are object motion (WCAG-allowed) — kept.

const MAX_PUFFS = 6; // Box meshes per cloud group (3..6 shown per shape roll)

let cloudMaterial = null;
let puffGeometry = null;
let classicRoot = null; // Holds the fixed classic pool
let endlessRoot = null; // Holds the streamed endless clouds
const classicClouds = []; // Always CLASSIC_CLOUD_COUNT once built
const endlessActive = new Map(); // chunkKey → cloud group
const cloudPool = []; // Released endless clouds, reshaped on reuse
let windClock = 0; // Scenery clock (advances every rendered frame)
let cloudAllocCount = 0; // Debug: pool discipline is testable

// Deterministic per-cloud RNG (same mulberry-ish step as the rock scatter).
function seededRng(seedA, seedB) {
    let s = (Math.imul(seedA, 2654435761) ^ Math.imul(seedB, 1597334677) ^ (TERRAIN_SEED + 733)) >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function acquireCloud(parent) {
    const pooled = cloudPool.pop();
    if (pooled) {
        pooled.visible = true;
        if (pooled.parent !== parent) parent.add(pooled);
        return pooled;
    }
    cloudAllocCount++;
    const group = new THREE.Group();
    for (let i = 0; i < MAX_PUFFS; i++) {
        group.add(new THREE.Mesh(puffGeometry, cloudMaterial)); // castShadow defaults off
    }
    parent.add(group);
    return group;
}

// Reshapes a cloud group into a fresh 3-6 puff cluster from the given RNG,
// and stamps its per-cloud animation state. `appear` 0 = grow in (endless
// streaming), 1 = born full-size (classic boot).
function shapeCloud(group, rng, anchorX, anchorZ, appear) {
    const puffs = 3 + Math.floor(rng() * (MAX_PUFFS - 2)); // 3..6
    // Sized for the near sky band (the only band this camera frames):
    // clusters up to ~9u across read fluffy overhead without ever owning
    // more than a sliver of the frame.
    const size = 1.9 + rng() * 1.7;
    for (let i = 0; i < MAX_PUFFS; i++) {
        const puff = group.children[i];
        if (i >= puffs) { puff.visible = false; continue; }
        puff.visible = true;
        // Wide, low blocks read as stacked cloud slabs, not dice.
        puff.scale.set(
            size * (1.1 + rng() * 1.5),
            size * (0.45 + rng() * 0.4),
            size * (0.7 + rng() * 1.0)
        );
        puff.position.set(
            (rng() - 0.5) * size * 2.4,
            (rng() - 0.5) * size * 0.8,
            (rng() - 0.5) * size * 1.6
        );
    }
    const ud = group.userData;
    ud.anchorX = anchorX;
    ud.anchorZ = anchorZ;
    ud.baseY = CLOUD_ALTITUDE_MIN + rng() * (CLOUD_ALTITUDE_MAX - CLOUD_ALTITUDE_MIN);
    ud.bobPhase = rng() * Math.PI * 2;
    ud.appear = appear;
    group.position.set(anchorX, ud.baseY, anchorZ);
    group.scale.setScalar(appear > 0 ? 1 : 0.001);
}

// --- Init (idempotent; called once from game.js init) ---
export function initClouds() {
    if (cloudMaterial) return;
    puffGeometry = new THREE.BoxGeometry(1, 1, 1);
    // Soft white with the faintest teal lean (palette family) + an emissive
    // whisper so clouds stay readable against the dark zenith. ONE material
    // for every puff of every cloud; fog swallows them at distance for free.
    cloudMaterial = new THREE.MeshStandardMaterial({
        color: 0xDCEFEA, // Soft white, teal-leaning — bright but never neon up close
        transparent: true,
        opacity: CLOUD_OPACITY,
        emissive: 0x9FD8CF,
        emissiveIntensity: 0.12,
        roughness: 1
    });
    classicRoot = new THREE.Group();
    endlessRoot = new THREE.Group();
    state.scene.add(classicRoot);
    state.scene.add(endlessRoot);
    // The classic pack exists from boot (classic is the default world) —
    // seeded scatter over the arena, biased AWAY from the spawn's center
    // sightline so the play camera never opens under a cloud.
    for (let i = 0; i < CLASSIC_CLOUD_COUNT; i++) {
        const rng = seededRng(i + 1, 91);
        const angle = (i / CLASSIC_CLOUD_COUNT) * Math.PI * 2 + rng() * 0.6;
        const dist = worldBoundary * (0.3 + rng() * 0.6); // 30..90u out — never overhead at spawn
        const cloud = acquireCloud(classicRoot);
        shapeCloud(cloud, rng, Math.cos(angle) * dist, Math.sin(angle) * dist, 1);
        classicClouds.push(cloud);
    }
}

// Shows exactly one sky per mode (called from applyWorldEnvironment).
export function setCloudMode(endless) {
    if (!classicRoot) return;
    classicRoot.visible = !endless;
    endlessRoot.visible = endless;
}

// --- Endless streaming hooks (terrain.js build/release) ---
// Seeded roll per chunk: the same chunk always grows the same cloud (or
// none), at the same spot in the sky — deterministic like rocks and food.
export function spawnChunkCloud(chunkKey, cx, cz) {
    const rng = seededRng(cx, cz);
    if (rng() >= CLOUD_CHUNK_CHANCE) return;
    const trueX = cx * CHUNK_SIZE + rng() * CHUNK_SIZE;
    const trueZ = cz * CHUNK_SIZE + rng() * CHUNK_SIZE;
    const cloud = acquireCloud(endlessRoot);
    // appear 0: chunks build at the fog-swallowed window edge, and the slow
    // scale-in erases what little pop the fog lets through.
    shapeCloud(cloud, rng, trueX - state.worldOrigin.x, trueZ - state.worldOrigin.z, 0);
    endlessActive.set(chunkKey, cloud);
}

export function releaseChunkCloud(chunkKey) {
    const cloud = endlessActive.get(chunkKey);
    if (!cloud) return;
    endlessActive.delete(chunkKey);
    cloud.visible = false;
    cloudPool.push(cloud);
}

// Floating-origin rebase: endless anchors are LOCAL coordinates — shift
// them with the world (classic anchors are torus-canonical; never touched).
export function shiftClouds(dx, dz) {
    for (const cloud of endlessActive.values()) {
        cloud.userData.anchorX -= dx;
        cloud.userData.anchorZ -= dz;
    }
}

// --- Per-frame drift (called from animate every rendered frame) ---
// Runs during pause and on the title screen on purpose: clouds are scenery,
// and a breathing sky keeps the attract scene alive. dt is real frame time
// clamped by the caller's MAX_DELTA.
function animateCloud(cloud, px, pz, dt) {
    const ud = cloud.userData;
    ud.anchorX = wrapCoord(ud.anchorX + CLOUD_WIND_X * dt);
    ud.anchorZ = wrapCoord(ud.anchorZ + CLOUD_WIND_Z * dt);
    cloud.position.x = px + torusDeltaComponent(px, ud.anchorX);
    cloud.position.z = pz + torusDeltaComponent(pz, ud.anchorZ);
    cloud.position.y = ud.baseY + Math.sin(windClock * CLOUD_BOB_SPEED + ud.bobPhase) * CLOUD_BOB_AMPLITUDE;
    if (ud.appear < 1) {
        ud.appear = Math.min(1, ud.appear + dt / CLOUD_APPEAR_TIME);
    }
    // Readability guard (screenshot-checked): the top-down-ish camera only
    // ever frames NEAR clouds (far ones sit above the frame top), so the
    // near field is graded instead of banned — a cloud parking right OVER
    // the player's head (inside CLOUD_CLEAR_NEAR) shrinks away entirely,
    // one just past it rides at ~55% size, easing to full by ~40u out.
    // Smooth on every edge (and multiplied with the appear grow-in), so
    // nothing ever pops; food and foes stay readable through the 0.85
    // opacity even when a cloud drifts by.
    const d = Math.hypot(cloud.position.x - px, cloud.position.z - pz);
    const smooth01 = (t) => {
        const k = Math.min(1, Math.max(0, t));
        return k * k * (3 - 2 * k);
    };
    const overhead = smooth01((d - CLOUD_CLEAR_NEAR) / (CLOUD_CLEAR_FAR - CLOUD_CLEAR_NEAR));
    const presence = 0.55 + 0.45 * smooth01((d - CLOUD_CLEAR_FAR) / 24);
    cloud.scale.setScalar(Math.max(0.001, smooth01(ud.appear) * overhead * presence));
}

export function updateClouds(dt) {
    if (!cloudMaterial || !state.player) return;
    windClock += dt;
    const px = state.player.position.x;
    const pz = state.player.position.z;
    if (state.worldMode === 'endless') {
        for (const cloud of endlessActive.values()) animateCloud(cloud, px, pz, dt);
    } else {
        for (const cloud of classicClouds) animateCloud(cloud, px, pz, dt);
    }
}

// Debug/test introspection (read-only) — wired into window.__game by main.js.
export function cloudInfo() {
    const active = state.worldMode === 'endless' ? [...endlessActive.values()] : classicClouds;
    let minY = Infinity, maxY = -Infinity;
    for (const cloud of active) {
        if (cloud.userData.baseY < minY) minY = cloud.userData.baseY;
        if (cloud.userData.baseY > maxY) maxY = cloud.userData.baseY;
    }
    return {
        classicCount: classicClouds.length,
        activeEndless: endlessActive.size,
        pooled: cloudPool.length,
        allocs: cloudAllocCount,
        minY,
        maxY,
        sampleX: active.length > 0 ? active[0].position.x : null
    };
}
