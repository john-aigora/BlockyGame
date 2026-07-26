import './game.js';
import { state } from './state.js';
import { spawnNearPlayer, spawnAtPosition } from './collectibles.js';
import { sfx, isMuted, audioState, music } from './audio.js';

// Read-only debug/test handle; production code must never read it.
// `debug` exposes spawners for the Playwright suites (world/resources
// specs) and audio state introspection (audio spec — real audio output
// can't be asserted headlessly).
window.__game = {
    state,
    debug: {
        spawnNearPlayer,
        spawnAtPosition,
        sfx,
        isMuted,
        audioState,
        musicActive: () => music.isActive()
    }
};
