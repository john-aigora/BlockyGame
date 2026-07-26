import { initialCollectTime, PANIC_TIME } from './constants.js';
import { state } from './state.js';
import { el, endGame, updateCollectTimeDisplay, hideComboChip, setTimerPanic } from './ui.js';
import { sfx } from './audio.js';

// --- Collect Clock Functions ---
// The collect countdown runs on the game clock (advanced by dt from the
// animation loop), so pausing inherently freezes it and resuming does NOT
// reset it.

export function resetCollectClock() {
    state.collectTimeLeft = initialCollectTime;
    state.lastShownCollectTime = initialCollectTime;
    setTimerPanic(false); // A collect defuses the panic pulse the same frame
    updateCollectTimeDisplay();
}

export function tickCollectClock(dt) {
    if (!state.gameActive) return;
    state.collectTimeLeft -= dt;

    // Panic mode (tension pass): the final PANIC_TIME seconds pulse the
    // timer red (CSS class, 1Hz — photosensitivity-safe) and tick softly
    // once per displayed second. The food arrow (effects.js) keys off the
    // same PANIC_TIME threshold.
    const panic = state.collectTimeLeft > 0 && state.collectTimeLeft <= PANIC_TIME;
    setTimerPanic(panic);

    // DOM write: ceil, and only when the displayed integer changes
    const shown = Math.max(0, Math.ceil(state.collectTimeLeft));
    if (shown !== state.lastShownCollectTime) {
        state.lastShownCollectTime = shown;
        el.collectTime.textContent = shown;
        if (panic && shown >= 1) sfx.tick(); // Quiet urgency metronome: 5..4..3..2..1
    }

    if (state.collectTimeLeft <= 0) { // Time ran out to collect a block
        endGame('Failed to collect a block in time.');
    }
}

// --- Combo Window Clock (score-juice pass) ---
// Runs on the game clock like the collect countdown, so pausing freezes a
// live combo instead of silently eating it. killEnemy (enemies.js) starts /
// refreshes the window; expiry here drops the multiplier back to nothing.
export function tickComboClock(dt) {
    if (state.comboTimeLeft <= 0) return;
    state.comboTimeLeft -= dt;
    if (state.comboTimeLeft <= 0) {
        state.comboTimeLeft = 0;
        state.comboCount = 0;
        hideComboChip();
    }
}
