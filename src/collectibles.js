import * as THREE from 'three';
import { worldSize, worldBoundary, collectibleSpawnRadius, minSpawnDistanceFromPlayer } from './constants.js';
import { state } from './state.js';
import { wrapPosition } from './worldmath.js';
import { groundHeightAt, isFoodSpot, chunkKeyForTrue, applyWorldBend } from './terrain.js';

// Shared GPU resources for ALL collectibles — allocated once for the app's
// lifetime and never disposed (plan 007). Per-spawn allocation would leak
// GPU memory since removal is scene.remove only.
const COLLECTIBLE_GEOMETRY = new THREE.BoxGeometry(0.7, 0.7, 0.7); // Smaller cube
// Exported for effects.js (plan 015): the food glow pulse animates
// emissiveIntensity on this ONE shared material — all food pulses in sync.
export const COLLECTIBLE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x76FF03 }); // Lime Green for collectibles (food)
// Same horizon bend as terrain — without this, far food reads as floating sky cubes.
applyWorldBend(COLLECTIBLE_MATERIAL);

// Builds a collectible mesh (small lime-green cube) on the shared resources.
function buildCollectible() {
    const collectible = new THREE.Mesh(COLLECTIBLE_GEOMETRY, COLLECTIBLE_MATERIAL);
    // No castShadow (plan 020 / audit P-1): a 0.7u glowing cube's shadow is
    // invisible at gameplay zoom, but every food block was a shadow-pass draw.
    collectible.receiveShadow = true; // Though small, good practice
    // Per-item phase so the rotate/bob idle animation (effects.js) doesn't
    // move every cube in visible lockstep.
    collectible.userData.phase = Math.random() * Math.PI * 2;
    return collectible;
}

// Single spawner: the caller supplies the placement strategy via pickPosition.
// ENDLESS: food never spawns in water or inside a boulder — the picker is
// retried a few times against isFoodSpot, and a spawn with no dry option
// (e.g. an enemy killed at the water's very edge) is simply skipped: food is
// plentiful by design, a missing crumb is invisible.
const FOOD_PLACE_ATTEMPTS = 12;

export function spawnCollectible(pickPosition) {
    let x, z;
    if (state.worldMode === 'endless') {
        let placed = false;
        for (let attempt = 0; attempt < FOOD_PLACE_ATTEMPTS; attempt++) {
            ({ x, z } = pickPosition());
            if (isFoodSpot(x, z)) { placed = true; break; }
        }
        if (!placed) return;
    } else {
        ({ x, z } = pickPosition());
    }
    const collectible = buildCollectible();
    collectible.position.set(x, 0.35, z); // Position on the ground
    wrapPosition(collectible.position); // Never place food outside the world — it would be uncollectable
    if (state.worldMode === 'endless') {
        // Grounded at spawn so food sits on the hills even on the paused
        // title screen. The terrain height is CACHED (plan 020 / audit P-4):
        // food never moves in XZ and heights are rebase-invariant (they are
        // heights, not coordinates — a rebase shifts local x/z, never the
        // true-coordinate sample made here), so the per-frame bob in
        // effects.js reuses baseY instead of re-sampling the noise field.
        const groundY = groundHeightAt(collectible.position.x, collectible.position.z);
        collectible.position.y = groundY + 0.45;
        collectible.userData.baseY = groundY;
        // Streaming ownership: every endless collectible belongs to the
        // chunk under it and despawns when that chunk releases (terrain.js).
        collectible.userData.chunkKey = chunkKeyForTrue(
            collectible.position.x + state.worldOrigin.x,
            collectible.position.z + state.worldOrigin.z
        );
    }
    state.collectibles.push(collectible);
    state.scene.add(collectible);
}

// --- Per-chunk seeded food (endless streaming; called by terrain.js) ---
// The chunk scatter already validated the spot (land, rock clearance), so
// this places directly — no picker, no retry, deterministic layout.
export function spawnChunkFood(localX, localZ, chunkKey) {
    const collectible = buildCollectible();
    const groundY = groundHeightAt(localX, localZ);
    collectible.position.set(localX, groundY + 0.45, localZ);
    collectible.userData.baseY = groundY; // Rebase-invariant height cache (plan 020 P-4)
    collectible.userData.chunkKey = chunkKey;
    state.collectibles.push(collectible);
    state.scene.add(collectible);
}

// Removes every collectible owned by a released chunk (seeded AND dynamic —
// dynamic spawns are tagged with their containing chunk at creation).
// Shared resources: scene.remove is the entire cleanup.
export function releaseFoodForChunk(chunkKey) {
    for (let i = state.collectibles.length - 1; i >= 0; i--) {
        if (state.collectibles[i].userData.chunkKey === chunkKey) {
            state.scene.remove(state.collectibles[i]);
            state.collectibles.splice(i, 1);
        }
    }
}

// Spawn a collectible in a random box around the player.
export function spawnNearPlayer() {
    if (!state.player) return; // Can't spawn relative to non-existent player

    spawnCollectible(() => {
        let spawnX, spawnZ;
        let distanceToPlayer;
        // Keep trying to find a spawn position until it's not too close to the player
        do {
            // Random position within a square area around the player
            spawnX = state.player.position.x + (Math.random() * collectibleSpawnRadius * 2) - collectibleSpawnRadius;
            spawnZ = state.player.position.z + (Math.random() * collectibleSpawnRadius * 2) - collectibleSpawnRadius;
            distanceToPlayer = Math.sqrt(Math.pow(spawnX - state.player.position.x, 2) + Math.pow(spawnZ - state.player.position.z, 2));
        } while (distanceToPlayer < minSpawnDistanceFromPlayer);
        return { x: spawnX, z: spawnZ };
    });
}

// Spawn a collectible anywhere in the world (initial even distribution).
export function spawnAnywhere() {
    spawnCollectible(() => {
        let spawnX, spawnZ;
        let distanceToPlayerStart;
        const playerInitialX = 0; // Player starts at 0,0,0
        const playerInitialZ = 0;

        // Keep trying to find a spawn position until it's not too close to player's initial spot
        do {
            spawnX = (Math.random() * worldSize) - worldBoundary; // Random pos in [-worldBoundary, +worldBoundary]
            spawnZ = (Math.random() * worldSize) - worldBoundary; // Random pos in [-worldBoundary, +worldBoundary]
            distanceToPlayerStart = Math.sqrt(Math.pow(spawnX - playerInitialX, 2) + Math.pow(spawnZ - playerInitialZ, 2));
        } while (distanceToPlayerStart < minSpawnDistanceFromPlayer);
        return { x: spawnX, z: spawnZ };
    });
}

// Spawn a collectible scattered around a specific position (e.g., enemy death).
export function spawnAtPosition(position) {
    spawnCollectible(() => {
        const scatterRange = 1.5; // How far the particles can scatter
        return {
            x: position.x + (Math.random() - 0.5) * scatterRange * 2,
            z: position.z + (Math.random() - 0.5) * scatterRange * 2
        };
    });
}
