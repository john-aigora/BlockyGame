import { initialCollectTime, PANIC_TIME } from './constants.js';
import { state } from './state.js';
import { el, killPlayer, updateCollectTimeDisplay, hideComboChip, setTimerPanic } from './ui.js';
import { sfx } from './audio.js';

// --- Collect Clock Functions ---
// The collect countdown runs on the game clock (advanced by dt from the
// animation loop), so pausing inherently freezes it and resuming does NOT
// reset it. PER PLAYER since plan 026: each hero races their own 15s clock;
// expiry kills THAT hero (killPlayer — the last death is the solo endGame
// path). The DOM readout/panic/tick stay bound to seat 0 until Stage E
// splits the HUD per half.

// No argument = every player (setupNewGame); a player = just their clock
// (their collect resets only their own countdown).
export function resetCollectClock(player = null) {
    const targets = player ? [player] : state.players;
    for (const p of targets) {
        p.collectTimeLeft = initialCollectTime;
        p.lastShownCollectTime = initialCollectTime;
    }
    if (!player || player.seat === 0) {
        setTimerPanic(false); // A collect defuses the panic pulse the same frame
        updateCollectTimeDisplay();
    }
}

export function tickCollectClock(dt) {
    if (!state.gameActive) return;
    for (const p of state.players) {
        if (!p.alive) continue;
        p.collectTimeLeft -= dt;

        // Panic mode (tension pass): the final PANIC_TIME seconds pulse the
        // timer red (CSS class, 1Hz — photosensitivity-safe) and tick softly
        // once per displayed second. The food arrow (effects.js) keys off the
        // same PANIC_TIME threshold.
        const panic = p.collectTimeLeft > 0 && p.collectTimeLeft <= PANIC_TIME;
        if (p.seat === 0) setTimerPanic(panic);

        // DOM write: ceil, and only when the displayed integer changes
        const shown = Math.max(0, Math.ceil(p.collectTimeLeft));
        if (shown !== p.lastShownCollectTime) {
            p.lastShownCollectTime = shown;
            if (p.seat === 0) {
                el.collectTime.textContent = shown;
                if (panic && shown >= 1) sfx.tick(); // Quiet urgency metronome: 5..4..3..2..1
            }
        }

        if (p.collectTimeLeft <= 0) { // Time ran out to collect a block
            killPlayer(p, 'Failed to collect a block in time.');
            if (!state.gameActive) return; // Last player down — the frame stops with the run
        }
    }
}

// --- Combo Window Clock (score-juice pass) ---
// Runs on the game clock like the collect countdown, so pausing freezes a
// live combo instead of silently eating it. killEnemy (enemies.js) starts /
// refreshes each player's window; expiry here drops their multiplier back
// to nothing. The chip element shows seat 0's chain until Stage E.
export function tickComboClock(dt) {
    for (const p of state.players) {
        if (p.comboTimeLeft <= 0) continue;
        p.comboTimeLeft -= dt;
        if (p.comboTimeLeft <= 0) {
            p.comboTimeLeft = 0;
            p.comboCount = 0;
            if (p.seat === 0) hideComboChip();
        }
    }
}
