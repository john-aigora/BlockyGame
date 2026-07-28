import { applySpeedMultiplier, speedUp, speedDown, forceWorldMode } from './game.js';
import { state } from './state.js';
import { spawnNearPlayer, spawnAtPosition } from './collectibles.js';
import { spawnNewEnemies, updateEnemyStreaming, resetEnemyStreaming } from './enemies.js';
import { onTouchStart, onTouchMove, onTouchEndOrCancel, gamepadVector, pollGamepad, isGamepadConnected, gamepadDebugInfo } from './input.js';
import { sfx, isMuted, audioState, music } from './audio.js';
import { spawnBurst, spawnScorePopup, effectsInfo } from './effects.js';
import { terrainHeight, groundHeightAt, terrainInfo, isWalkable, canMove, terrainTint, isRockFree } from './terrain.js';
import { cloudInfo } from './clouds.js';
import { movementDebug } from './movement-continuous.js';

// Read-only debug/test handle; production code must never read it.
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
        terrainHeight, // Pure seeded height sampler (endless) — determinism checks
        groundHeightAt, // Origin-aware local-coordinate sampler (endless)
        terrainInfo, // { activeChunks, pooledMeshes, queued, builds, ... } — streaming/pool checks
        terrainTint, // { h, r, g, b } vertex color at TRUE coords — biome/shoreline checks
        isWalkable, // Endless collision query (water + rocks) — impassability checks
        canMove, // Honest directional movement probe — gap-width fairness checks
        isRockFree, // Rock-circle-only query — the jump spec finds seeded rocks with it
        cloudInfo, // { classicCount, activeEndless, pooled, allocs, minY, maxY } — sky pool checks
        movementDebug // Plan 014 spike introspection: { energy, boostHeld, heading, hasMouse }
    }
};
