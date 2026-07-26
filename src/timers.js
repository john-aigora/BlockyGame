import { initialCollectTime } from './constants.js';
import { state } from './state.js';
import { el, endGame, updateCollectTimeDisplay } from './ui.js';

// --- Collect Clock Functions ---
// The collect countdown runs on the game clock (advanced by dt from the
// animation loop), so pausing inherently freezes it and resuming does NOT
// reset it.

export function resetCollectClock() {
    state.collectTimeLeft = initialCollectTime;
    state.lastShownCollectTime = initialCollectTime;
    updateCollectTimeDisplay();
}

export function tickCollectClock(dt) {
    if (!state.gameActive) return;
    state.collectTimeLeft -= dt;

    // DOM write: ceil, and only when the displayed integer changes
    const shown = Math.max(0, Math.ceil(state.collectTimeLeft));
    if (shown !== state.lastShownCollectTime) {
        state.lastShownCollectTime = shown;
        el.collectTime.textContent = shown;
    }

    if (state.collectTimeLeft <= 0) { // Time ran out to collect a block
        endGame('Failed to collect a block in time.');
    }
}
