import * as THREE from 'three';
import {
    CHUNK_SIZE, CHUNK_SEGMENTS, CHUNK_WINDOW_RADIUS, CHUNK_RELEASE_RADIUS,
    CHUNK_BUILDS_PER_FRAME, TERRAIN_AMPLITUDE, TERRAIN_WAVELENGTH, WORLD_SEED,
    WATER_LEVEL, CURVE_STRENGTH, SPAWN_MESA_RADIUS,
    ROCKS_PER_CHUNK_MAX, ROCK_SPAWN_CLEARANCE,
    WATER_WALK_MARGIN, ROCK_COLLIDER_FACTOR,
    FOOD_PER_CHUNK_MIN, FOOD_PER_CHUNK_MAX, FOOD_WATER_CLEARANCE, GOLD_CHUNK_CHANCE,
    minSpawnDistanceFromPlayer,
    BIOME_WAVELENGTH, BIOME_TINT_STRENGTH, SHORE_BAND_HEIGHT, SHORE_BAND_BOOST,
    WATER_DEPTH_RANGE, WATER_DEEP_TINT, WATER_SNAP, REGION_BINS
} from './constants.js';
import { state } from './state.js';
import { makeGroundTexture, GROUND_TILE } from './world.js';
import { spawnChunkFood, releaseFoodForChunk } from './collectibles.js';
import { spawnChunkCloud, releaseChunkCloud } from './clouds.js';

// --- Endless World Terrain Engine ---
// Everything here is ENDLESS-MODE ONLY: classic mode never calls in (its
// flat ground plane lives in world.js, untouched). The engine streams a
// (2*CHUNK_WINDOW_RADIUS+1)^2 window of vertex-displaced, vertex-colored
// terrain chunks around the player, with a following water plane, seeded
// voxel boulders, and a curved-horizon vertex bend on the world materials.
//
// DISPOSE DISCIPLINE: after warmup, walking allocates NOTHING — released
// chunks (and rocks) return to pools and are re-displaced in place. The
// renderer's geometry count must plateau at pool size.

// Water plane base footprint (world units) and extra radius beyond the
// furthest living player so fog does not swallow the surface first.
const WATER_BASE_SIZE = 560; // Solo default: half-extent 280 around the player
const WATER_COVER_MARGIN = 220; // Past the furthest living player (fog far ~camDist*4.5)

// --- Seeded value noise (deterministic, dependency-free) ---
// Integer-lattice hash → bilinear interpolation with smoothstep fade.
// Same (x, z) in TRUE world coordinates always yields the same height,
// across chunks, rebuilds, and floating-origin rebases.
function hash2(ix, iz) {
    let h = (ix * 374761393 + iz * 668265263 + WORLD_SEED * 144665) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296; // [0, 1)
}

function valueNoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx); // Smoothstep fade
    const sz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

// One centered octave in [-1, 1]; offsets decorrelate the octaves.
function octave(x, z, wavelength, ox, oz) {
    return (valueNoise(x / wavelength + ox, z / wavelength + oz) - 0.5) * 2;
}

// THE terrain-sampling API — TRUE world coordinates in, height out.
// Weights calibrated (scripted sweep): ~25% of terrain below WATER_LEVEL,
// max slope ~0.21 (always walkable), rolling hills ~±2.5 typical.
export function terrainHeight(x, z) {
    const w = TERRAIN_WAVELENGTH;
    let h = (
        octave(x, z, w * 4, 0, 0) * 0.62 +          // Continents: broad basins and rises (the lakes)
        octave(x, z, w, 37.7, 61.3) * 0.28 +        // Rolling hills at the design wavelength
        octave(x, z, w * 0.45, 113.1, 96.9) * 0.10  // Fine detail
    ) * TERRAIN_AMPLITUDE;
    // Spawn mesa: every run starts at true (0,0) — blend the terrain up to
    // guaranteed dry land there so no run ever begins in a lake.
    const d = Math.hypot(x, z);
    if (d < SPAWN_MESA_RADIUS) {
        const t = 1 - d / SPAWN_MESA_RADIUS;
        const s = t * t * (3 - 2 * t);
        h += (Math.max(h, 0.6) - h) * s;
    }
    return h;
}

// Convenience: sample under a LOCAL (scene-space) position — adds the
// floating-origin offset. This is what gameplay code grounds entities with.
export function groundHeightAt(localX, localZ) {
    return terrainHeight(localX + state.worldOrigin.x, localZ + state.worldOrigin.z);
}

// --- Curved horizon (the wow) ---
// SHIPPED: the onBeforeCompile shader patch (not the CPU fallback). The
// project_vertex chunk is replaced so the vertex is bent DOWN in world
// space by dist²·CURVE_STRENGTH from the camera before view/projection —
// terrain, water, and rocks roll away over the horizon. mvPosition is
// still defined, so fog (and everything downstream) works unchanged.
// Characters/food are fog-hidden before the bend would matter, so only
// world materials carry the patch. r128 keys its program cache on
// onBeforeCompile.toString(), so patched materials never collide with the
// stock MeshStandardMaterial program.
const bendUniform = { value: CURVE_STRENGTH };
const BEND_PROJECT_CHUNK = /* glsl */`
vec4 bentWorld = modelMatrix * vec4( transformed, 1.0 );
float bendDx = bentWorld.x - cameraPosition.x;
float bendDz = bentWorld.z - cameraPosition.z;
bentWorld.y -= ( bendDx * bendDx + bendDz * bendDz ) * uCurveStrength;
vec4 mvPosition = viewMatrix * bentWorld;
gl_Position = projectionMatrix * mvPosition;
`;

// Exported so food and characters share the same horizon roll as terrain
// (otherwise far pickups/enemies float "in the sky" above the curved ground).
export function applyWorldBend(material) {
    if (!material || material.userData.worldBend) return;
    material.userData.worldBend = true;
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uCurveStrength = bendUniform;
        shader.vertexShader = 'uniform float uCurveStrength;\n' +
            shader.vertexShader.replace('#include <project_vertex>', BEND_PROJECT_CHUNK);
    };
    material.needsUpdate = true;
}

// --- Module state ---
const HALF = CHUNK_SIZE / 2;
const VERTS = (CHUNK_SEGMENTS + 1) * (CHUNK_SEGMENTS + 1);

let terrainRoot = null; // Group holding chunks + rocks + water; visibility = mode
let terrainMaterial = null;
let rockMaterial = null;
let waterMesh = null;
let active = new Map(); // key "cx,cz" → { key, cx, cz, mesh, rocks }
// Collision fast path (plan 020 P-8): the same chunks keyed by a packed int
// — blockedByRock probes a 3x3 neighborhood per movement sample, and the
// string keys were 9 concatenations per probe. The string `chunk.key` field
// stays THE identity everywhere else (food/cloud ownership, terrainInfo).
const activeByInt = new Map();

function chunkIntKey(cx, cz) {
    return ((cx & 0xFFFF) << 16) | (cz & 0xFFFF);
}
const meshPool = []; // Released chunk meshes, buffers reused by re-displacing
const rockPool = []; // Released boulder groups (4 box children each)
let queue = []; // Pending chunk builds: { key, cx, cz }
const pending = new Set(); // Keys in the queue (dupe guard)
let lastScanSignature = null; // The anchor chunk set of the last window scan
let waterClock = 0;
let streaming = false; // True while endless mode is the live environment

// Streaming anchors (plan 026): every LIVING player is an anchor — the
// active set is the UNION of each anchor's window. With all players dead
// (the frozen death-screen world) the fallback anchor is seat 0's corpse,
// which is exactly the old single-player behavior. Scratch array over
// PRE-ALLOCATED slot objects (B8 review ADV-9) — this runs per frame, and
// the old literal pushes allocated 1-2 objects each call.
const anchorScratch = [];
const anchorSlots = [{ cx: 0, cz: 0 }, { cx: 0, cz: 0 }]; // One per possible seat; the corpse fallback reuses slot 0

function pushAnchor(x, z) {
    const slot = anchorSlots[anchorScratch.length] ??
        (anchorSlots[anchorScratch.length] = { cx: 0, cz: 0 }); // Roster growth beyond 2 stays safe
    slot.cx = Math.floor((x + state.worldOrigin.x) / CHUNK_SIZE);
    slot.cz = Math.floor((z + state.worldOrigin.z) / CHUNK_SIZE);
    anchorScratch.push(slot);
}

function currentAnchors() {
    anchorScratch.length = 0;
    for (const player of state.players) {
        if (!player.alive || !player.mesh) continue;
        pushAnchor(player.mesh.position.x, player.mesh.position.z);
    }
    if (anchorScratch.length === 0 && state.players[0].mesh) {
        const p = state.players[0].mesh.position;
        pushAnchor(p.x, p.z);
    }
    return anchorScratch;
}

// Debug counters (terrainInfo) — pool discipline is testable.
let buildCount = 0;
let meshAllocCount = 0;
let rockAllocCount = 0;

const ROCK_BLOCKS = 4; // Box children per pooled boulder group

// --- Height → vertex tint (brightness factor multiplying the grid map) ---
// Values may exceed 1.0: the shader multiplies, so >1 BRIGHTENS the teal
// texture — deep teal lake beds, exact classic teal at mid, lighter crests.
function heightTint(h) {
    if (h <= WATER_LEVEL) {
        // Lake bed: darker with depth
        const t = Math.min(1, (WATER_LEVEL - h) / 2.2);
        return 0.62 - 0.24 * t;
    }
    if (h <= 0.9) {
        // Shore → mid: eases up to the classic ground teal
        const t = (h - WATER_LEVEL) / (0.9 - WATER_LEVEL);
        return 0.74 + 0.26 * t;
    }
    // Mid → crest: brightens
    const t = Math.min(1, (h - 0.9) / 2.4);
    return 1.0 + 0.5 * t;
}

// --- Full vertex color: height tint + shoreline band + biome shift ---
// (stage 3 spectacle). The ground texture is pure teal (r≈0 everywhere), so
// hue can only move along the green↔blue axis — which conveniently IS the
// teal family, so the palette identity holds by construction:
//   biome > 0 → greener, spring-teal region; biome < 0 → bluer, deep-cyan
// region. One extra ultra-low-frequency noise octave per vertex, sampled in
// TRUE coordinates: regions are world-fixed, deterministic, rebase-immune.
// The shoreline band is a brightness bump feathered across the first
// SHORE_BAND_HEIGHT above the waterline — a pale waterline ring around
// every lake, strongest right at the water's edge.
function computeTint(tx, tz, h, out) {
    let tint = heightTint(h);
    if (h > WATER_LEVEL && h < WATER_LEVEL + SHORE_BAND_HEIGHT) {
        const band = 1 - (h - WATER_LEVEL) / SHORE_BAND_HEIGHT;
        tint += SHORE_BAND_BOOST * band * band; // Feather: bright edge, soft fade
    }
    const biome = biomeAt(tx, tz); // [-1, 1]
    out.r = tint;
    out.g = tint * (1 + BIOME_TINT_STRENGTH * biome);
    out.b = tint * (1 - BIOME_TINT_STRENGTH * biome);
    return out;
}

// --- Named biome regions (plan 025 Step 3) ---
// The tint's ultra-low-frequency octave IS the biome field — biomeAt exposes
// it raw. Deterministic in TRUE coordinates: world-fixed, rebase-immune,
// same everywhere the same seed is played.
export function biomeAt(tx, tz) {
    return octave(tx, tz, BIOME_WAVELENGTH, 51.3, 27.9);
}

// REGION_BINS lives in the GAME BALANCE block (constants.js) — it tunes how
// often DISCOVERED fires and what the REGIONS death stat can reach
// (terminal review A-2: every balance knob in the block, no exceptions).
// Kid-friendly two-word region names. Which name a region wears is a seeded
// hash pick — the TABLE is fixed, the MAP of it is per-world.
const REGION_NAMES = [
    'THE TEAL SHALLOWS', 'COPPER FLATS', 'MINT MEADOWS', 'THE LOST LAKES',
    'PEBBLE PLAINS', 'WHISPER HILLS', 'THE JELLY FIELDS', 'BUMPY BADLANDS',
    'THE SLEEPY SHORES', 'CLOVER COUNTRY', 'THE WOBBLY WILDS', 'SUGAR STEPPES'
];

// The biome octave quantized into its identity band (shared by the key and
// display paths below — one binning rule, never a fork).
function biomeBin(biome) {
    return Math.min(REGION_BINS - 1, Math.max(0, Math.floor(((biome + 1) / 2) * REGION_BINS)));
}

// Identity-only region key at TRUE (tx, tz) — THE hot path (H13, plan 028
// batch). updateRegionDiscovery calls this every frame for every living
// player, and on almost every frame the answer is "same key as before":
// building the full biomeRegion object there threw away a fresh object,
// a name hash, and a formatted CSS color string per player per frame.
// This returns just the key (one short string — the comparison target
// game.js stores in player.regionKey), leaving name/color to biomeRegion,
// which the discovery branch calls only when a region actually commits.
export function biomeRegionKey(tx, tz) {
    return biomeBin(biomeAt(tx, tz)) + ':' +
        Math.floor(tx / BIOME_WAVELENGTH) + ':' + Math.floor(tz / BIOME_WAVELENGTH);
}

// Region identity + display data at TRUE (tx, tz): the biome bin crossed
// with a BIOME_WAVELENGTH-sized cell grid, so one huge biome band still
// breaks into discoverable places. `key` is the identity game.js debounces
// on (byte-identical to biomeRegionKey at the same point — same binning,
// same cell math); `name` is a seeded pick from the table (WORLD_SEED in
// the mix — a new seed deals a fresh map of names); `color` is the biome's
// own tint direction as a CSS color for the DISCOVERED popup (greener bins
// mint, bluer bins sky-cyan — the teal family both ways, readable on any
// sky). Display path: called on discovery commits, resets, and the debug
// handle — never per frame (that is biomeRegionKey's job).
export function biomeRegion(tx, tz) {
    const biome = biomeAt(tx, tz);
    const bin = biomeBin(biome);
    const cellX = Math.floor(tx / BIOME_WAVELENGTH);
    const cellZ = Math.floor(tz / BIOME_WAVELENGTH);
    let h = (Math.imul(bin + 1, 2246822519) ^ Math.imul(cellX, 374761393) ^
        Math.imul(cellZ, 668265263) ^ Math.imul(WORLD_SEED, 144665)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    const name = REGION_NAMES[(h >>> 0) % REGION_NAMES.length];
    const t = (biome + 1) / 2;
    const color = `rgb(${Math.round(96 + 30 * (1 - t))}, ${Math.round(200 + 45 * t)}, ${Math.round(255 - 70 * t)})`;
    return { key: bin + ':' + cellX + ':' + cellZ, bin, cellX, cellZ, name, color };
}

const tintScratch = { r: 0, g: 0, b: 0 }; // Reused by every vertex loop

// Debug/test wrapper (main.js → window.__game.debug): the exact vertex
// color the terrain would carry at TRUE (x, z). Pure math, allocation-free
// callers aside — tests assert biome variation and the shoreline band here.
export function terrainTint(x, z) {
    const h = terrainHeight(x, z);
    const t = computeTint(x, z, h, { r: 0, g: 0, b: 0 });
    return { h, r: t.r, g: t.g, b: t.b };
}

// --- Init (idempotent; endless-mode entry) ---
export function initTerrain() {
    if (terrainRoot) return;
    terrainRoot = new THREE.Group();
    terrainRoot.visible = false;
    state.scene.add(terrainRoot);

    // The classic grid canvas, world-UV-mapped: chunks write UVs in tile
    // units (trueX / GROUND_TILE), so repeat stays 1 and the pattern is
    // seamless across chunks AND invariant under rebase.
    const gridTexture = makeGroundTexture(state.renderer);
    gridTexture.repeat.set(1, 1);
    terrainMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff, // The teal lives in the texture; vertex color scales it
        map: gridTexture,
        vertexColors: true
    });
    applyWorldBend(terrainMaterial);

    rockMaterial = new THREE.MeshStandardMaterial({ color: 0x3E5F58 }); // Muted teal-grey stone — palette family
    applyWorldBend(rockMaterial);

    // Water: ONE translucent plane following the player at WATER_LEVEL.
    // Segmented so the horizon bend curves it smoothly (a single quad would
    // only bend at its corners) AND so the depth tint below has resolution:
    // 80x80 segments = 7-unit sampling. Gentle emissive shimmer, ~0.18Hz —
    // subtle and far from any photosensitivity limit.
    // Base size is 560 (half-extent 280). In 2P the mesh scale grows with
    // living-player separation so lakes under both heroes stay visible
    // (union of camera footprints + fog margin; Fugu P1).
    const waterGeometry = new THREE.PlaneGeometry(WATER_BASE_SIZE, WATER_BASE_SIZE, 80, 80);
    waterGeometry.rotateX(-Math.PI / 2);
    const waterVerts = waterGeometry.attributes.position.count;
    waterGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(waterVerts * 3).fill(1), 3));
    const waterMaterial = new THREE.MeshStandardMaterial({
        color: 0x006064, // Deep-dive teal-cyan — the world family, read as water
        vertexColors: true, // Depth tint: the vertex color darkens with lakebed depth
        transparent: true,
        opacity: 0.78,
        roughness: 0.35,
        metalness: 0.1,
        emissive: 0x00838F,
        emissiveIntensity: 0.1,
        depthWrite: false // The lake bed stays visible through the surface
    });
    applyWorldBend(waterMaterial);
    waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    waterMesh.frustumCulled = false; // Follows the camera; culling buys nothing
    waterMesh.position.y = WATER_LEVEL;
    terrainRoot.add(waterMesh);
}

// --- Water depth tint (stage 3 spectacle) ---
// Deeper water reads darker: each water vertex is tinted by the lakebed
// depth beneath it (pure math — terrainHeight works everywhere, built chunk
// or not). The plane follows the player in WATER_SNAP steps, and the tint
// is recomputed ONLY on a step (~every 12 units of travel, one pass over
// 81x81 verts), so the pattern stays world-fixed between steps and the
// per-frame cost is zero. sqrt eases the shore→deep ramp: the first meter
// of depth does most of the darkening, which is how shallows read.
let waterSnapTrueX = null, waterSnapTrueZ = null;
let waterRecolorCount = 0; // terrainInfo — tests pin the recolor cadence

function recolorWater() {
    waterRecolorCount++;
    const posArr = waterMesh.geometry.attributes.position.array;
    const colArr = waterMesh.geometry.attributes.color.array;
    const count = waterMesh.geometry.attributes.position.count;
    // Geometry is unit-base; mesh.scale stretches the visible plane. Sample
    // lakebed depth in the SCALED footprint so a 2P union plane tints fully.
    const sx = waterMesh.scale.x;
    const sz = waterMesh.scale.z;
    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const h = terrainHeight(
            waterSnapTrueX + posArr[i3] * sx,
            waterSnapTrueZ + posArr[i3 + 2] * sz);
        const depth = WATER_LEVEL - h;
        let tint = 1;
        if (depth > 0) {
            tint = 1 - (1 - WATER_DEEP_TINT) * Math.sqrt(Math.min(1, depth / WATER_DEPTH_RANGE));
        }
        colArr[i3] = colArr[i3 + 1] = colArr[i3 + 2] = tint;
    }
    waterMesh.geometry.attributes.color.needsUpdate = true;
}

// Enable/disable the endless environment (mode switch). Classic hides the
// whole root and halts streaming; nothing is disposed — pools persist.
export function setTerrainActive(on) {
    if (!terrainRoot) return;
    terrainRoot.visible = on;
    streaming = on;
}

// New endless run: release everything (a previous run may have wandered
// thousands of units away), then synchronously build the 3x3 under the
// spawn so the title scene never shows a hole beneath the player.
const SPAWN_ANCHOR = [{ cx: 0, cz: 0 }]; // Every run starts at true (0,0)

export function resetTerrainForNewRun() {
    if (!terrainRoot) return;
    for (const chunk of active.values()) releaseChunk(chunk);
    active.clear();
    activeByInt.clear();
    queue = [];
    pending.clear();
    lastScanSignature = null; // First updateTerrain re-scans for the live roster
    scanWindow(SPAWN_ANCHOR);
    // Build the innermost ring immediately; the rest streams in.
    processQueue(SPAWN_ANCHOR, 9);
    if (waterMesh) {
        waterMesh.position.set(0, WATER_LEVEL, 0);
        // Depth tint for the spawn neighborhood (the last run may have left
        // the snap thousands of units away — or at null on first boot).
        if (waterSnapTrueX !== 0 || waterSnapTrueZ !== 0) {
            waterSnapTrueX = 0;
            waterSnapTrueZ = 0;
            recolorWater();
        }
    }
}

// --- Per-frame streaming (called from the animate loop, endless only) ---
export function updateTerrain(dt) {
    if (!streaming || !state.players[0].mesh) return;
    const anchors = currentAnchors();
    if (anchors.length === 0) return;
    // Re-scan only when some anchor changed chunks (the solo single-anchor
    // change check, generalized to the anchor SET).
    let signature = '';
    for (const a of anchors) signature += a.cx + ',' + a.cz + '|';
    if (signature !== lastScanSignature) {
        lastScanSignature = signature;
        scanWindow(anchors);
    }
    processQueue(anchors, CHUNK_BUILDS_PER_FRAME);

    // Water follows the LIVING players' midpoint in WATER_SNAP steps (the
    // midpoint of one player is the player — the exact solo behavior). In 2P
    // the plane SCALEs to the union of living positions + WATER_COVER_MARGIN
    // so lakes under both heroes stay visible even at 600u separation
    // (fixed 560 left a dry gap past ~280u from midpoint — Fugu P1).
    // True-coordinate grid, so a rebase changes nothing; crossing a step or
    // a scale change re-tints the depth colors for the new footprint.
    waterClock += dt;
    let mx = 0, mz = 0, living = 0;
    for (const player of state.players) {
        if (!player.alive || !player.mesh) continue;
        mx += player.mesh.position.x;
        mz += player.mesh.position.z;
        living++;
    }
    if (living === 0) {
        mx = state.players[0].mesh.position.x;
        mz = state.players[0].mesh.position.z;
    } else {
        mx /= living;
        mz /= living;
    }
    // Furthest living hero from the midpoint (Chebyshev) drives the scale.
    let maxReach = 0;
    for (const player of state.players) {
        if (!player.alive || !player.mesh) continue;
        const dx = Math.abs(player.mesh.position.x - mx);
        const dz = Math.abs(player.mesh.position.z - mz);
        maxReach = Math.max(maxReach, dx, dz);
    }
    const halfBase = WATER_BASE_SIZE / 2;
    const needHalf = maxReach + WATER_COVER_MARGIN;
    const waterScale = Math.max(1, needHalf / halfBase);
    const scaleChanged = Math.abs(waterMesh.scale.x - waterScale) > 0.01;
    if (scaleChanged) waterMesh.scale.set(waterScale, 1, waterScale);

    const trueX = mx + state.worldOrigin.x;
    const trueZ = mz + state.worldOrigin.z;
    const snapX = Math.round(trueX / WATER_SNAP) * WATER_SNAP;
    const snapZ = Math.round(trueZ / WATER_SNAP) * WATER_SNAP;
    if (snapX !== waterSnapTrueX || snapZ !== waterSnapTrueZ || scaleChanged) {
        waterSnapTrueX = snapX;
        waterSnapTrueZ = snapZ;
        recolorWater();
    }
    waterMesh.position.set(snapX - state.worldOrigin.x, WATER_LEVEL, snapZ - state.worldOrigin.z);
    waterMesh.material.emissiveIntensity = 0.08 + 0.045 * Math.sin(waterClock * 1.1);
}

// Chebyshev distance from a chunk coordinate to the nearest anchor.
function anchorDistance(anchors, cx, cz) {
    let best = Infinity;
    for (const a of anchors) {
        const d = Math.max(Math.abs(cx - a.cx), Math.abs(cz - a.cz));
        if (d < best) best = d;
    }
    return best;
}

// Scan the UNION window of all anchors: release chunks outside EVERY
// anchor's release ring, queue every anchor's missing window chunks (the
// pending set dedupes overlap between anchors).
function scanWindow(anchors) {
    for (const chunk of active.values()) {
        if (anchorDistance(anchors, chunk.cx, chunk.cz) > CHUNK_RELEASE_RADIUS) {
            active.delete(chunk.key);
            activeByInt.delete(chunkIntKey(chunk.cx, chunk.cz));
            releaseChunk(chunk);
        }
    }
    for (const a of anchors) {
        for (let dz = -CHUNK_WINDOW_RADIUS; dz <= CHUNK_WINDOW_RADIUS; dz++) {
            for (let dx = -CHUNK_WINDOW_RADIUS; dx <= CHUNK_WINDOW_RADIUS; dx++) {
                const kx = a.cx + dx, kz = a.cz + dz;
                const key = kx + ',' + kz;
                if (!active.has(key) && !pending.has(key)) {
                    pending.add(key);
                    queue.push({ key, cx: kx, cz: kz });
                }
            }
        }
    }
}

// Build up to `budget` queued chunks, nearest to ANY anchor first.
function processQueue(anchors, budget) {
    while (budget > 0 && queue.length > 0) {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < queue.length; i++) {
            const d = anchorDistance(anchors, queue[i].cx, queue[i].cz);
            if (d < bestD) { bestD = d; best = i; }
        }
        const entry = queue.splice(best, 1)[0];
        pending.delete(entry.key);
        if (bestD > CHUNK_RELEASE_RADIUS) continue; // Every player left it behind — drop, don't build
        buildChunk(entry.key, entry.cx, entry.cz);
        budget--;
    }
}

// --- Chunk build / release ---
// Frustum culling is ON (plan 020 / audit P-2): buildChunk computes a
// bounding sphere inflated by +24u, covering the horizon bend's worst-case
// vertex drop (~16.7u at the far chunk corner) with margin — behind-camera
// chunks stop costing draws. A FRESH mesh draws unconditionally for exactly
// one frame before the cull engages (onAfterRender flip): geometry
// registration with the renderer happens on first draw, and the resource-
// plateau specs pin registration to ALLOCATION time, not to whenever the
// camera happens to look at the chunk.
function acquireChunkMesh() {
    const pooled = meshPool.pop();
    if (pooled) {
        pooled.visible = true;
        // Cull-flag hardening (H8, plan 028 batch): only cull from frame 1
        // if this mesh's geometry has actually been through a render —
        // userData.registered is set by the eager-register flip below, at
        // the mesh's first real draw. A mesh released BEFORE that draw
        // (built and released between two resets with no rendered frame in
        // between) still carries its un-run flip handler; sending it back
        // out with frustumCulled=true would let an off-frustum re-entry
        // defer geometry registration until the camera happens to look at
        // it — exactly the late-registration bump the resource-plateau
        // specs pin against. Unreachable today (every reset path renders
        // between builds), closed anyway: the un-registered re-acquire
        // just re-enters the one-frame eager path its pending flip already
        // implements.
        pooled.frustumCulled = pooled.userData.registered === true;
        return pooled;
    }
    meshAllocCount++;
    const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEGMENTS, CHUNK_SEGMENTS);
    geometry.rotateX(-Math.PI / 2); // Flat on XZ; +y is up in vertex space
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3));
    const mesh = new THREE.Mesh(geometry, terrainMaterial);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // One eager-registration draw, then...
    mesh.onAfterRender = () => {
        mesh.userData.registered = true; // Proof of first real draw (H8 gate above)
        mesh.frustumCulled = true; // ...culled for life (pool reuse keeps it)
        mesh.onAfterRender = () => {};
    };
    terrainRoot.add(mesh);
    return mesh;
}

function buildChunk(key, cx, cz) {
    buildCount++;
    const mesh = acquireChunkMesh();
    const centerTrueX = cx * CHUNK_SIZE + HALF;
    const centerTrueZ = cz * CHUNK_SIZE + HALF;
    const posArr = mesh.geometry.attributes.position.array;
    const colArr = mesh.geometry.attributes.color.array;
    const uvArr = mesh.geometry.attributes.uv.array;
    for (let i = 0; i < VERTS; i++) {
        const i3 = i * 3;
        const tx = centerTrueX + posArr[i3];
        const tz = centerTrueZ + posArr[i3 + 2];
        const h = terrainHeight(tx, tz);
        posArr[i3 + 1] = h;
        computeTint(tx, tz, h, tintScratch);
        colArr[i3] = tintScratch.r;
        colArr[i3 + 1] = tintScratch.g;
        colArr[i3 + 2] = tintScratch.b;
        // World-space UVs in tile units — the grid stays fixed in the world
        // (v tracks -z, matching the classic plane's orientation).
        uvArr[i * 2] = tx / GROUND_TILE;
        uvArr[i * 2 + 1] = -tz / GROUND_TILE;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.color.needsUpdate = true;
    mesh.geometry.attributes.uv.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    // Cullable chunks (plan 020 / audit P-2): a fresh sphere per (re)build —
    // pooled meshes are re-displaced in place — inflated +24u to cover the
    // horizon bend's ≤~16.7u worst-case downward vertex shift (dist² ×
    // CURVE_STRENGTH at the far corner of the window) plus margin. The
    // frustumCulled flag itself is owned by acquireChunkMesh (fresh meshes
    // stay uncullable for one eager-registration draw).
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.boundingSphere.radius += 24;
    mesh.position.set(centerTrueX - state.worldOrigin.x, 0, centerTrueZ - state.worldOrigin.z);

    const chunk = { key, cx, cz, mesh, rocks: [], colliders: [] };
    scatterRocks(chunk, centerTrueX, centerTrueZ);
    scatterFood(chunk, centerTrueX, centerTrueZ);
    spawnChunkCloud(key, cx, cz); // Seeded sky: ~1 cloud per 2-3 chunks (clouds.js pool)
    active.set(key, chunk);
    activeByInt.set(chunkIntKey(cx, cz), chunk); // Collision fast path (plan 020 P-8)
}

function releaseChunk(chunk) {
    chunk.mesh.visible = false;
    meshPool.push(chunk.mesh);
    for (const rock of chunk.rocks) {
        rock.visible = false;
        rockPool.push(rock);
    }
    chunk.rocks.length = 0;
    chunk.colliders.length = 0;
    releaseChunkCloud(chunk.key); // The chunk's cloud streams out with it (pooled)
    // Food streams with its chunk: this run "forgets the past" here — a
    // released chunk takes its collectibles with it (shared GPU resources,
    // scene.remove is the whole cleanup). Rebuilding the chunk later regrows
    // the same seeded spots — the world regenerates behind you, by design.
    releaseFoodForChunk(chunk.key);
}

// --- Seeded voxel boulders (visual only this stage; collision is stage 2) ---
function acquireRock() {
    const pooled = rockPool.pop();
    if (pooled) {
        pooled.visible = true;
        return pooled;
    }
    rockAllocCount++;
    const group = new THREE.Group();
    const boxGeometry = getRockGeometry();
    for (let i = 0; i < ROCK_BLOCKS; i++) {
        const box = new THREE.Mesh(boxGeometry, rockMaterial);
        // receiveShadow only (plan 020 / audit P-1): characters shadow ONTO
        // boulders, but a boulder's own cast is invisible against the
        // terrain shading — and every rock block was a shadow-pass draw.
        box.receiveShadow = true;
        group.add(box);
    }
    terrainRoot.add(group);
    return group;
}

let rockGeometry = null;
function getRockGeometry() {
    if (!rockGeometry) rockGeometry = new THREE.BoxGeometry(1, 1, 1);
    return rockGeometry;
}

function scatterRocks(chunk, centerTrueX, centerTrueZ) {
    // Per-chunk seeded RNG: same chunk always grows the same boulders.
    let s = (Math.imul(chunk.cx, 668265263) ^ Math.imul(chunk.cz, 374761393) ^ WORLD_SEED) >>> 0;
    const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const count = 1 + Math.floor(next() * ROCKS_PER_CHUNK_MAX);
    for (let n = 0; n < count; n++) {
        const tx = centerTrueX - HALF + 3 + next() * (CHUNK_SIZE - 6);
        const tz = centerTrueZ - HALF + 3 + next() * (CHUNK_SIZE - 6);
        const sizeRoll = next();
        const blocksRoll = next();
        const yawRoll = next();
        const h = terrainHeight(tx, tz);
        if (h < WATER_LEVEL + 0.35) continue; // Never in (or teetering over) water
        if (Math.hypot(tx, tz) < ROCK_SPAWN_CLEARANCE) continue; // Clear of the run-start point
        const rock = acquireRock();
        const size = 0.7 + sizeRoll * 1.1;
        const blocks = 2 + Math.floor(blocksRoll * (ROCK_BLOCKS - 1)); // 2..4 stacked boxes
        let y = size * 0.5;
        for (let b = 0; b < ROCK_BLOCKS; b++) {
            const box = rock.children[b];
            if (b >= blocks) { box.visible = false; continue; }
            box.visible = true;
            const shrink = Math.pow(0.72, b);
            box.scale.set(size * shrink * (0.85 + next() * 0.3), size * shrink, size * shrink * (0.85 + next() * 0.3));
            box.position.set((next() - 0.5) * size * 0.3, y, (next() - 0.5) * size * 0.3);
            box.rotation.y = next() * Math.PI;
            y += size * Math.pow(0.72, b + 1) * 0.85;
        }
        rock.rotation.y = yawRoll * Math.PI * 2;
        rock.position.set(tx - state.worldOrigin.x, h - size * 0.18, tz - state.worldOrigin.z);
        chunk.rocks.push(rock);
        // Collision circle in TRUE coordinates (rebase-invariant); isWalkable
        // resolves boulders as impassable via these.
        chunk.colliders.push({ x: tx, z: tz, r: size * ROCK_COLLIDER_FACTOR });
    }
}

// --- Seeded per-chunk food (streams with the chunk) ---
// Same deterministic pattern as the rocks, on an independent seed stream:
// the same chunk always grows the same food spots — land only, clear of
// boulders and the run-start point. Collected food regrows only after the
// chunk is released AND rebuilt (the world regenerating behind you).
function scatterFood(chunk, centerTrueX, centerTrueZ) {
    let s = (Math.imul(chunk.cx, 2246822519) ^ Math.imul(chunk.cz, 3266489917) ^ (WORLD_SEED + 977)) >>> 0;
    const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const count = FOOD_PER_CHUNK_MIN + Math.floor(next() * (FOOD_PER_CHUNK_MAX - FOOD_PER_CHUNK_MIN + 1));
    // Gold prize (plan 025): ONE extra seeded roll, BEFORE the spot loop —
    // the roll-all law keeps the stream aligned so rebuilds reproduce the
    // identical layout, gold included. The same roll both decides (8% of
    // chunks) and PICKS the spot (goldRoll/chance re-spread over [0,1) →
    // uniform index). A gold spot that loses to water/rock rejection simply
    // isn't grown — rarity stays honest, alignment untouched.
    const goldRoll = next();
    const goldIndex = goldRoll < GOLD_CHUNK_CHANCE
        ? Math.floor((goldRoll / GOLD_CHUNK_CHANCE) * count)
        : -1;
    for (let n = 0; n < count; n++) {
        // Roll ALL randoms before any rejection — the stream stays aligned,
        // so every rebuild reproduces the identical layout.
        const tx = centerTrueX - HALF + 1.5 + next() * (CHUNK_SIZE - 3);
        const tz = centerTrueZ - HALF + 1.5 + next() * (CHUNK_SIZE - 3);
        if (!isFoodSpotTrue(tx, tz, chunk)) continue;
        if (Math.hypot(tx, tz) < minSpawnDistanceFromPlayer) continue; // Run-start clearance (classic rule)
        spawnChunkFood(tx - state.worldOrigin.x, tz - state.worldOrigin.z, chunk.key, n === goldIndex);
    }
}

// --- Walkability / placement queries (endless collision core) ---
// Water and boulders are IMPASSABLE. Both movement resolution (player and
// enemies, axis-separated slide) and spawn placement route through here.
// Water is pure math (terrainHeight), so it works even where no chunk is
// built yet; rock circles live on ACTIVE chunks — during the 1-2 frames a
// freshly entered chunk spends in the build queue its rocks don't block,
// which no ordinary movement can reach (the window builds nearest-first,
// well ahead of walking speed).
export function chunkKeyForTrue(tx, tz) {
    return Math.floor(tx / CHUNK_SIZE) + ',' + Math.floor(tz / CHUNK_SIZE);
}

function blockedByRock(tx, tz, radius) {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cz = Math.floor(tz / CHUNK_SIZE);
    // 3x3 chunk neighborhood: max rock radius + max entity radius stays far
    // below CHUNK_SIZE, so a circle can never span past adjacent chunks.
    // Packed-int lookups (plan 020 P-8): no string keys in the probe loop.
    for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
            const chunk = activeByInt.get(chunkIntKey(cx + dx, cz + dz));
            if (!chunk) continue;
            for (const c of chunk.colliders) {
                const ddx = tx - c.x;
                const ddz = tz - c.z;
                const rr = c.r + radius;
                if (ddx * ddx + ddz * ddz < rr * rr) return true;
            }
        }
    }
    return false;
}

// Can an entity of the given collision radius stand at this LOCAL position?
// STATIC query (spawn placement and the like): center-sampled water plus a
// conservative circle-vs-circle rock test. MOVEMENT resolution goes through
// canMove below, which samples the collider honestly.
export function isWalkable(localX, localZ, radius) {
    const tx = localX + state.worldOrigin.x;
    const tz = localZ + state.worldOrigin.z;
    if (terrainHeight(tx, tz) < WATER_LEVEL + WATER_WALK_MARGIN) return false;
    return !blockedByRock(tx, tz, radius);
}

// One honest sample point: dry land (above the visible shoreline plus the
// hair margin) and not inside a rock's collision circle. `ignoreRocks`
// (the jump, endless only) drops ONLY the rock clause — water stays law.
function probeOk(tx, tz, ignoreRocks) {
    if (terrainHeight(tx, tz) < WATER_LEVEL + WATER_WALK_MARGIN) return false;
    return ignoreRocks || !blockedByRock(tx, tz, 0);
}

// Is this LOCAL position clear of every rock collision circle for a body of
// the given radius? Static placement query (also on the debug handle — the
// jump spec finds seeded rocks with it).
export function isRockFree(localX, localZ, radius) {
    return !blockedByRock(localX + state.worldOrigin.x, localZ + state.worldOrigin.z, radius);
}

// Landing-grace wedge test (audit C-6): is one of the SAME radius-0 sample
// points the movement probes use — center plus ±radius on each axis —
// actually inside a rock circle? The jump's landing grace (game.js) keeps
// rocks ignored while wedged, so an arc may legally END inside a circle and
// walk clear. The OLD grace used the radius-INFLATED center circle
// (!isRockFree(x, z, radius)), which stays true across a ~radius-wide ring
// where every probe is already clear — rocks silently stopped existing
// there and the player could walk straight through a boulder. Probe parity
// closes that ring: wedged now means a probe point is genuinely inside.
export function isRockWedged(localX, localZ, radius) {
    const tx = localX + state.worldOrigin.x;
    const tz = localZ + state.worldOrigin.z;
    return blockedByRock(tx, tz, 0) ||
        blockedByRock(tx + radius, tz, 0) ||
        blockedByRock(tx - radius, tz, 0) ||
        blockedByRock(tx, tz + radius, 0) ||
        blockedByRock(tx, tz - radius, 0);
}

// --- Honest movement probe (owner escalation: "respect the size of the gap
// and the size of the player's block") ---
// May an entity whose collider is the TRUE visual half-width `radius` take
// the step (mx, mz) from LOCAL (localX, localZ)? The destination is sampled
// at the center, the LEADING edge of travel, and the two LATERAL extremes
// perpendicular to travel — the honest circle. Deliberately NOT the full
// circle: the trailing side is where the entity already stands, and sampling
// it is exactly what wedged both slide axes at corners (diagnosed cause (a)).
// Consequences, by construction:
//   - a gap passes iff gapWidth >= 2×radius (the lateral extremes ARE the
//     body edges — no hidden extra margin);
//   - the body never visually overhangs water (the old center-only test let
//     the block wade edge-deep — measured south edge at h=-0.906 < WL);
//   - at a corner the blocked axis fails while the open axis's own probes
//     still pass, so the axis-separated slide creeps instead of freezing.
export function canMove(localX, localZ, mx, mz, radius, ignoreRocks = false) {
    const len = Math.hypot(mx, mz);
    if (len === 0) return true;
    const nx = localX + state.worldOrigin.x + mx;
    const nz = localZ + state.worldOrigin.z + mz;
    const ux = (mx / len) * radius; // Travel direction scaled to the collider edge
    const uz = (mz / len) * radius;
    return probeOk(nx, nz, ignoreRocks) && // Center
        probeOk(nx + ux, nz + uz, ignoreRocks) && // Leading edge
        probeOk(nx - uz, nz + ux, ignoreRocks) && // Lateral extreme (left of travel)
        probeOk(nx + uz, nz - ux, ignoreRocks); // Lateral extreme (right of travel)
}

// --- The slide (shared by the player and enemies) ---
// Resolves a desired step into the applied step, written into `slideResult`
// (module scratch — read it, don't keep it): the full step first (a narrow
// DIAGONAL corridor must pass even when both single axes wouldn't), then
// the axis-separated slide, then the corner deflections. The deflections
// fix the last freeze mode: a diagonal held INTO a wiggling shoreline
// creeps the body flush against the contour, where the open axis's lateral
// probe starts failing by a hair — retreating that hair on the pressed
// axis (one frame's own step, dt-scaled, probe-verified like every other
// move) frees the open axis without ever letting the body overlap water.
export const slideResult = { x: 0, z: 0 };

export function slideMove(px, pz, mx, mz, radius, ignoreRocks = false) {
    slideResult.x = 0;
    slideResult.z = 0;
    if (mx === 0 && mz === 0) return slideResult;
    if (canMove(px, pz, mx, mz, radius, ignoreRocks)) {
        slideResult.x = mx;
        slideResult.z = mz;
        return slideResult;
    }
    let ax = 0;
    if (mx !== 0 && canMove(px, pz, mx, 0, radius, ignoreRocks)) ax = mx;
    if (mz !== 0 && canMove(px + ax, pz, 0, mz, radius, ignoreRocks)) {
        slideResult.x = ax;
        slideResult.z = mz;
        return slideResult;
    }
    if (ax !== 0) {
        slideResult.x = ax;
        return slideResult;
    }
    if (mx !== 0 && mz !== 0) {
        // Corner wedge: advance the open axis, retreat the pressed one.
        if (canMove(px, pz, mx, -mz, radius, ignoreRocks)) {
            slideResult.x = mx;
            slideResult.z = -mz;
        } else if (canMove(px, pz, -mx, mz, radius, ignoreRocks)) {
            slideResult.x = -mx;
            slideResult.z = mz;
        }
    }
    return slideResult;
}

// Food placement check in TRUE coordinates: dry land with real clearance
// above the waterline, not inside a boulder. `nearChunk` (optional) is a
// fast path for the chunk's own scatter; dynamic spawns pass nothing and
// use the neighborhood query.
function isFoodSpotTrue(tx, tz, nearChunk) {
    if (terrainHeight(tx, tz) < WATER_LEVEL + FOOD_WATER_CLEARANCE) return false;
    if (nearChunk) {
        for (const c of nearChunk.colliders) {
            const ddx = tx - c.x;
            const ddz = tz - c.z;
            const rr = c.r + 0.6;
            if (ddx * ddx + ddz * ddz < rr * rr) return false;
        }
        return true;
    }
    return !blockedByRock(tx, tz, 0.6);
}

// LOCAL-coordinate wrapper for the dynamic spawners (collectibles.js).
export function isFoodSpot(localX, localZ) {
    return isFoodSpotTrue(localX + state.worldOrigin.x, localZ + state.worldOrigin.z, null);
}

// --- Floating-origin rebase ---
// Chunk keys derive from TRUE coordinates, so a rebase (origin moved by a
// CHUNK_SIZE multiple) changes NO keys and forces NO rebuilds — only the
// local mesh positions shift. Water snaps back under the player next frame.
export function shiftTerrain(dx, dz) {
    for (const chunk of active.values()) {
        chunk.mesh.position.x -= dx;
        chunk.mesh.position.z -= dz;
        for (const rock of chunk.rocks) {
            rock.position.x -= dx;
            rock.position.z -= dz;
        }
    }
    if (waterMesh) {
        waterMesh.position.x -= dx;
        waterMesh.position.z -= dz;
    }
}

// Debug/test introspection (read-only) — wired into window.__game by main.js.
export function terrainInfo() {
    return {
        activeChunks: active.size,
        activeKeys: [...active.keys()],
        pooledMeshes: meshPool.length,
        pooledRocks: rockPool.length,
        queued: queue.length,
        builds: buildCount,
        meshAllocs: meshAllocCount,
        rockAllocs: rockAllocCount,
        hasWater: !!waterMesh,
        // Half-extent of the visible water plane in world units (base/2 * scale).
        waterHalf: waterMesh ? (WATER_BASE_SIZE / 2) * waterMesh.scale.x : 0,
        waterScale: waterMesh ? waterMesh.scale.x : 0,
        waterRecolors: waterRecolorCount,
        streaming
    };
}
