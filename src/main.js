import { applySpeedMultiplier } from './game.js';
import { state } from './state.js';
import { spawnNearPlayer, spawnAtPosition } from './collectibles.js';
import { spawnNewEnemies } from './enemies.js';
import { onTouchStart, onTouchMove, onTouchEndOrCancel } from './input.js';
import { sfx, isMuted, audioState, music } from './audio.js';
import { spawnBurst, effectsInfo } from './effects.js';
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
        applySpeedMultiplier, // Speed recompute path (balance spec — size speed bonus)
        touchHandlers: { onTouchStart, onTouchMove, onTouchEndOrCancel },
        sfx,
        isMuted,
        audioState,
        musicActive: () => music.isActive(),
        spawnBurst, // Particle pool-discipline checks (effects spec)
        effectsInfo, // { reducedMotion, activeParticles, poolSize }
        movementDebug // Plan 014 spike introspection: { energy, boostHeld, heading, hasMouse }
    }
};
