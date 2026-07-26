import * as THREE from 'three';
import {
    CHUNK_SIZE, CHUNK_SEGMENTS, CHUNK_WINDOW_RADIUS, CHUNK_RELEASE_RADIUS,
    CHUNK_BUILDS_PER_FRAME, TERRAIN_AMPLITUDE, TERRAIN_WAVELENGTH, TERRAIN_SEED,
    WATER_LEVEL, CURVE_STRENGTH, SPAWN_MESA_RADIUS,
    ROCKS_PER_CHUNK_MAX, ROCK_SPAWN_CLEARANCE
} from './constants.js';
import { state } from './state.js';
import { makeGroundTexture, GROUND_TILE } from './world.js';

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

// --- Seeded value noise (deterministic, dependency-free) ---
// Integer-lattice hash → bilinear interpolation with smoothstep fade.
// Same (x, z) in TRUE world coordinates always yields the same height,
// across chunks, rebuilds, and floating-origin rebases.
function hash2(ix, iz) {
    let h = (ix * 374761393 + iz * 668265263 + TERRAIN_SEED * 144665) | 0;
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

function applyWorldBend(material) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uCurveStrength = bendUniform;
        shader.vertexShader = 'uniform float uCurveStrength;\n' +
            shader.vertexShader.replace('#include <project_vertex>', BEND_PROJECT_CHUNK);
    };
}

// --- Module state ---
const HALF = CHUNK_SIZE / 2;
const VERTS = (CHUNK_SEGMENTS + 1) * (CHUNK_SEGMENTS + 1);

let terrainRoot = null; // Group holding chunks + rocks + water; visibility = mode
let terrainMaterial = null;
let rockMaterial = null;
let waterMesh = null;
let active = new Map(); // key "cx,cz" → { key, cx, cz, mesh, rocks }
const meshPool = []; // Released chunk meshes, buffers reused by re-displacing
const rockPool = []; // Released boulder groups (4 box children each)
let queue = []; // Pending chunk builds: { key, cx, cz }
const pending = new Set(); // Keys in the queue (dupe guard)
let lastScanCx = null, lastScanCz = null;
let waterClock = 0;
let streaming = false; // True while endless mode is the live environment

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
    // only bend at its corners). Gentle emissive shimmer, ~0.18Hz — subtle
    // and far from any photosensitivity limit.
    const waterGeometry = new THREE.PlaneGeometry(560, 560, 40, 40);
    waterGeometry.rotateX(-Math.PI / 2);
    const waterMaterial = new THREE.MeshStandardMaterial({
        color: 0x006064, // Deep-dive teal-cyan — the world family, read as water
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
export function resetTerrainForNewRun() {
    if (!terrainRoot) return;
    for (const chunk of active.values()) releaseChunk(chunk);
    active.clear();
    queue = [];
    pending.clear();
    lastScanCx = null;
    lastScanCz = null;
    scanWindow(0, 0);
    // Build the innermost ring immediately; the rest streams in.
    processQueue(0, 0, 9);
    if (waterMesh) waterMesh.position.set(0, WATER_LEVEL, 0);
}

// --- Per-frame streaming (called from the animate loop, endless only) ---
export function updateTerrain(dt) {
    if (!streaming || !state.player) return;
    const p = state.player.position;
    const cx = Math.floor((p.x + state.worldOrigin.x) / CHUNK_SIZE);
    const cz = Math.floor((p.z + state.worldOrigin.z) / CHUNK_SIZE);
    if (cx !== lastScanCx || cz !== lastScanCz) scanWindow(cx, cz);
    processQueue(cx, cz, CHUNK_BUILDS_PER_FRAME);

    // Water follows the player; shimmer breathes on its own clock.
    waterClock += dt;
    waterMesh.position.set(p.x, WATER_LEVEL, p.z);
    waterMesh.material.emissiveIntensity = 0.08 + 0.045 * Math.sin(waterClock * 1.1);
}

// Scan the window around chunk (cx, cz): release far chunks, queue missing.
function scanWindow(cx, cz) {
    lastScanCx = cx;
    lastScanCz = cz;
    for (const chunk of active.values()) {
        if (Math.max(Math.abs(chunk.cx - cx), Math.abs(chunk.cz - cz)) > CHUNK_RELEASE_RADIUS) {
            active.delete(chunk.key);
            releaseChunk(chunk);
        }
    }
    for (let dz = -CHUNK_WINDOW_RADIUS; dz <= CHUNK_WINDOW_RADIUS; dz++) {
        for (let dx = -CHUNK_WINDOW_RADIUS; dx <= CHUNK_WINDOW_RADIUS; dx++) {
            const kx = cx + dx, kz = cz + dz;
            const key = kx + ',' + kz;
            if (!active.has(key) && !pending.has(key)) {
                pending.add(key);
                queue.push({ key, cx: kx, cz: kz });
            }
        }
    }
}

// Build up to `budget` queued chunks, nearest to (cx, cz) first.
function processQueue(cx, cz, budget) {
    while (budget > 0 && queue.length > 0) {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < queue.length; i++) {
            const d = Math.max(Math.abs(queue[i].cx - cx), Math.abs(queue[i].cz - cz));
            if (d < bestD) { bestD = d; best = i; }
        }
        const entry = queue.splice(best, 1)[0];
        pending.delete(entry.key);
        if (bestD > CHUNK_RELEASE_RADIUS) continue; // The player left it behind — drop, don't build
        buildChunk(entry.key, entry.cx, entry.cz);
        budget--;
    }
}

// --- Chunk build / release ---
function acquireChunkMesh() {
    const pooled = meshPool.pop();
    if (pooled) {
        pooled.visible = true;
        return pooled;
    }
    meshAllocCount++;
    const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEGMENTS, CHUNK_SEGMENTS);
    geometry.rotateX(-Math.PI / 2); // Flat on XZ; +y is up in vertex space
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3));
    const mesh = new THREE.Mesh(geometry, terrainMaterial);
    mesh.receiveShadow = true;
    // No frustum culling: the horizon bend moves vertices far below the
    // unbent bounding sphere, and 49 chunks is a trivial draw count anyway.
    mesh.frustumCulled = false;
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
        const tint = heightTint(h);
        colArr[i3] = colArr[i3 + 1] = colArr[i3 + 2] = tint;
        // World-space UVs in tile units — the grid stays fixed in the world
        // (v tracks -z, matching the classic plane's orientation).
        uvArr[i * 2] = tx / GROUND_TILE;
        uvArr[i * 2 + 1] = -tz / GROUND_TILE;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.color.needsUpdate = true;
    mesh.geometry.attributes.uv.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.position.set(centerTrueX - state.worldOrigin.x, 0, centerTrueZ - state.worldOrigin.z);

    const chunk = { key, cx, cz, mesh, rocks: [] };
    scatterRocks(chunk, centerTrueX, centerTrueZ);
    active.set(key, chunk);
}

function releaseChunk(chunk) {
    chunk.mesh.visible = false;
    meshPool.push(chunk.mesh);
    for (const rock of chunk.rocks) {
        rock.visible = false;
        rockPool.push(rock);
    }
    chunk.rocks.length = 0;
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
        box.castShadow = true;
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
    let s = (Math.imul(chunk.cx, 668265263) ^ Math.imul(chunk.cz, 374761393) ^ TERRAIN_SEED) >>> 0;
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
    }
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
        streaming
    };
}
