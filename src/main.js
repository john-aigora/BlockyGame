import './game.js';
import { state } from './state.js';
import { spawnNearPlayer, spawnAtPosition } from './collectibles.js';
import { spawnNewEnemies } from './enemies.js';
import { onTouchStart, onTouchMove, onTouchEndOrCancel } from './input.js';
import { sfx, isMuted, audioState, music } from './audio.js';

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
        touchHandlers: { onTouchStart, onTouchMove, onTouchEndOrCancel },
        sfx,
        isMuted,
        audioState,
        musicActive: () => music.isActive()
    }
};
