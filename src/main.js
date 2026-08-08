import { applySpeedMultiplier, speedUp, speedDown, forceWorldMode, perfInfo, setPlayerCount, advanceGameTime } from './game.js';
import { state } from './state.js';
import { spawnNearPlayer, spawnAtPosition, spawnChunkFood } from './collectibles.js';
import { spawnNewEnemies, updateEnemyStreaming, resetEnemyStreaming, updateSpawnWarnings, debugSpawnSpecies, pendingSpawnInfo, clearPendingSpawns } from './enemies.js';
import { onTouchStart, onTouchMove, onTouchEndOrCancel, gamepadVector, pollGamepad, isGamepadConnected, gamepadDebugInfo, seatInfo } from './input.js';
import { sfx, isMuted, audioState, music } from './audio.js';
import { spawnBurst, spawnScorePopup, effectsInfo } from './effects.js';
import { terrainHeight, groundHeightAt, terrainInfo, isWalkable, canMove, terrainTint, isRockFree, biomeRegion, biomeRegionKey } from './terrain.js';
import { WORLD_SEED, DAILY_WORLD } from './constants.js';
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
        // A gold food at LOCAL (x, z) under a spec-owned chunk key (plan
        // 025): never released by streaming, cleared by setupNewGame like
        // every collectible. Production gold rides the seeded chunk scatter.
        spawnGoldFood: (x, z) => spawnChunkFood(x, z, 'debug-gold', true),
        spawnNewEnemies,
        updateEnemyStreaming, // Bubble spawn path (endless spawn-band spec)
        updateSpawnWarnings, // Warn-pipeline tick — materializes pending spawns (plan 017)
        // Formed species enemy at (x, z), no warn/materialize (plan 024;
        // plan 025 boss). Returns the state.enemies index — never the THREE
        // group (a Group cannot cross the page.evaluate serialization).
        spawnSpecies: (key, x, z, scaleFactor) =>
            state.enemies.indexOf(debugSpawnSpecies(key, x, z, scaleFactor)),
        pendingSpawnInfo, // Plain-data pending-warn queue (plan 024: kill-wave band + warn-time specs)
        clearPendingSpawns, // Drops every warn disc — spec death-proofing needs the PIPELINE cleared, not just live bodies (effects pool spec)
        resetEnemyStreaming,
        applySpeedMultiplier, // Speed recompute path (balance spec — size speed bonus)
        speedUp,
        speedDown,
        forceWorldMode, // Classic torus for wrap regression tests only
        // Deterministic game-clock stepper (plan 027): rAF-paused loop of
        // the REAL update(1/60). THE sanctioned way for specs to move game
        // time — no wall-clock waits, no load-dependent dilation.
        advance: advanceGameTime,
        // Two-player split-screen (plan 026): flips the roster; on the start
        // overlay this re-runs setup so both heroes spawn. startTwoPlayer is
        // the coop spec's entry; setPlayerCount(1) returns to solo.
        setPlayerCount,
        startTwoPlayer: () => setPlayerCount(2),
        seatInfo, // { claims: [padIndex|null x2], keyboardActive: [bool x2] } — coop seat specs
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
        // The resolved world seed + whether the daily flag drove it (plan
        // 025) — the worldfun spec pins ?seed=/daily resolution through this.
        worldSeedInfo: () => ({ seed: WORLD_SEED, daily: DAILY_WORLD }),
        terrainHeight, // Pure seeded height sampler (endless) — determinism checks
        groundHeightAt, // Origin-aware local-coordinate sampler (endless)
        terrainInfo, // { activeChunks, pooledMeshes, queued, builds, ... } — streaming/pool checks
        terrainTint, // { h, r, g, b } vertex color at TRUE coords — biome/shoreline checks
        biomeRegion, // { key, bin, cellX, cellZ, name, color } at TRUE coords — region-identity checks (plan 025)
        biomeRegionKey, // Identity-only hot path (H13) — worldfun pins it byte-equal to biomeRegion().key
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
