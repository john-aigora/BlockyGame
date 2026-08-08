import { applySpeedMultiplier, speedUp, speedDown, forceWorldMode, perfInfo } from './game.js';
import { state } from './state.js';
import { spawnNearPlayer, spawnAtPosition } from './collectibles.js';
import { spawnNewEnemies, updateEnemyStreaming, resetEnemyStreaming, updateSpawnWarnings } from './enemies.js';
import { onTouchStart, onTouchMove, onTouchEndOrCancel, gamepadVector, pollGamepad, isGamepadConnected, gamepadDebugInfo } from './input.js';
import { sfx, isMuted, audioState, music } from './audio.js';
import { spawnBurst, spawnScorePopup, effectsInfo } from './effects.js';
import { terrainHeight, groundHeightAt, terrainInfo, isWalkable, canMove, terrainTint, isRockFree } from './terrain.js';
import { cloudInfo } from './clouds.js';
import { movementDebug } from './movement-continuous.js';

// Test/debug handle; production code must never read it. (Not strictly
// read-only: some entries — spawners, streaming/warn ticks — mutate sim
// state on purpose so specs can drive the game deterministically.)
// `debug` exposes spawners for the Playwright suites (world/resources/
// balance specs), audio state introspection (audio spec — real audio output
// can't be asserted headlessly), and the raw touch handlers (touch spec —
// fed fabricated event objects to test identifier/UI-exclusion logic).
window.__game = {
    state,
    debug: {
        spawnNearPlayer,
        spawnAtPosition,
        spawnNewEnemies,
        updateEnemyStreaming, // Bubble spawn path (endless spawn-band spec)
        updateSpawnWarnings, // Warn-pipeline tick — materializes pending spawns (plan 017)
        resetEnemyStreaming,
        applySpeedMultiplier, // Speed recompute path (balance spec — size speed bonus)
        speedUp,
        speedDown,
        forceWorldMode, // Classic torus for wrap regression tests only
        touchHandlers: { onTouchStart, onTouchMove, onTouchEndOrCancel },
        gamepadVector, // Stick/D-pad unit vector (gamepad spec)
        pollGamepad, // Edge actions — tests drive a mocked navigator.getGamepads
        isGamepadConnected,
        gamepadDebugInfo, // Live pad id/mapping/axes for F310 diagnostics
        sfx,
        isMuted,
        audioState,
        musicActive: () => music.isActive(),
        spawnBurst, // Particle pool-discipline checks (effects spec)
        spawnScorePopup, // Score-popup pool-discipline checks (effects spec)
        effectsInfo, // { reducedMotion, activeParticles, poolSize }
        perfInfo, // { calls, triangles, geometries, textures, frameMsAvg } — plan 020 measurement hook
        terrainHeight, // Pure seeded height sampler (endless) — determinism checks
        groundHeightAt, // Origin-aware local-coordinate sampler (endless)
        terrainInfo, // { activeChunks, pooledMeshes, queued, builds, ... } — streaming/pool checks
        terrainTint, // { h, r, g, b } vertex color at TRUE coords — biome/shoreline checks
        isWalkable, // Endless collision query (water + rocks) — impassability checks
        canMove, // Honest directional movement probe — gap-width fairness checks
        isRockFree, // Rock-circle-only query — the jump spec finds seeded rocks with it
        cloudInfo, // { classicCount, activeEndless, pooled, allocs, minY, maxY } — sky pool checks
        movementDebug, // Plan 014 spike introspection: { energy, boostHeld, heading, hasMouse }
        // Collider↔geometry binding probes (audit D-11): the true rendered
        // body-block widths, so the fairness spec can pin the collider
        // constants to the geometry they claim to describe.
        heroBodyWidth: () => state.player.userData.bodyMesh.geometry.parameters.width,
        enemyBodyWidth: () => state.enemies[0] && state.enemies[0].userData.bodyMesh.geometry.parameters.width
    }
};
