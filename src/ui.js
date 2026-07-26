import { MAX_ENEMY_INDICATORS, DANGER_RADIUS, DANGER_VIGNETTE_MAX, HEARTBEAT_BPM, DEATH_SCREEN_DELAY } from './constants.js';
import { state } from './state.js';
import { canKillSpecificEnemy } from './enemies.js';
import { recordScore } from './hiscores.js';
import { torusDistance } from './worldmath.js';
import { unlockAudio, sfx, music, isMuted, setMuted } from './audio.js';
import { onPlayerDeath, onNewBest } from './effects.js';

// Cached DOM references, resolved once at init (plan 007) — the hot loop
// must never call getElementById. game.js calls initUI() before any UI write.
export const el = {
    score: null,
    collectTime: null,
    collectTimerDisplay: null,
    killIndicator: null,
    comboChip: null,
    dangerVignette: null,
    messageBox: null,
    deathReason: null,
    finalScore: null,
    startOverlay: null,
    startButton: null,
    modeClassic: null,
    modeEndless: null,
    pauseButton: null,
    speedButton: null,
    hiscoreSlot: null,
    muteButton: null,
    goFlourish: null
};

export function initUI() {
    el.score = document.getElementById('score');
    el.collectTime = document.getElementById('collect-time');
    el.collectTimerDisplay = document.getElementById('collect-timer-display');
    el.dangerVignette = document.getElementById('danger-vignette');
    dangerReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.killIndicator = document.getElementById('kill-indicator');
    el.comboChip = document.getElementById('combo-chip');
    el.messageBox = document.getElementById('message-box');
    el.deathReason = document.getElementById('death-reason');
    el.finalScore = document.getElementById('final-score');
    el.startOverlay = document.getElementById('start-overlay');
    el.startButton = document.getElementById('start-button');
    el.modeClassic = document.getElementById('mode-classic');
    el.modeEndless = document.getElementById('mode-endless');
    el.pauseButton = document.getElementById('pause-button');
    el.speedButton = document.getElementById('speed-cycle-button');
    el.hiscoreSlot = document.getElementById('hiscore-slot');
    el.muteButton = document.getElementById('mute-button');
    el.goFlourish = document.getElementById('go-flourish');
    initMuteToggle();
}

// --- GO! flourish (spectacle pass) ---
// One big center-screen "GO!" flash when a run begins: a single 0.6s
// scale+fade play (simple fade under reduced motion, via CSS) — one flash,
// nowhere near the 3/sec photosensitivity limit. The element idles at
// opacity 0, so no display bookkeeping is needed; the remove/reflow/add
// dance restarts the animation on rapid restarts.
export function showGoFlourish() {
    if (!el.goFlourish) return;
    el.goFlourish.classList.remove('go-play');
    void el.goFlourish.offsetWidth; // Forces a reflow so the animation restarts
    el.goFlourish.classList.add('go-play');
}

// --- World-mode picker (endless mode) ---
// Two buttons on the start overlay: CLASSIC ARENA and ENDLESS WORLD. The
// overlay itself starts a run on ANY pointer press, so both buttons stop
// propagation — picking a mode must never launch it. game.js supplies the
// switch callback (it owns the environment swap + fresh setup).
export function initModePicker(onPick) {
    for (const [button, mode] of [[el.modeClassic, 'classic'], [el.modeEndless, 'endless']]) {
        if (!button) continue;
        button.addEventListener('pointerdown', (e) => e.stopPropagation());
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            sfx.click();
            onPick(mode);
        });
    }
    updateModePicker();
}

// Reflects state.worldMode on the buttons (highlight + aria-pressed).
export function updateModePicker() {
    if (!el.modeClassic || !el.modeEndless) return;
    const endless = state.worldMode === 'endless';
    el.modeClassic.classList.toggle('mode-selected', !endless);
    el.modeEndless.classList.toggle('mode-selected', endless);
    el.modeClassic.setAttribute('aria-pressed', String(!endless));
    el.modeEndless.setAttribute('aria-pressed', String(endless));
}

// --- Mute Toggle (plan 010) ---
// Persisted by src/audio.js (the storage owner); the label reflects the
// saved state from boot. The click is a sanctioned unlock gesture, so
// unmuting works even before the first run starts.
function updateMuteButtonLabel() {
    el.muteButton.textContent = isMuted() ? '\u{1F507}' : '\u{1F50A}';
    el.muteButton.setAttribute('aria-pressed', String(isMuted()));
}

function initMuteToggle() {
    updateMuteButtonLabel();
    el.muteButton.addEventListener('click', () => {
        unlockAudio();
        setMuted(!isMuted()); // muting also stops the music (audio.js)
        updateMuteButtonLabel();
        if (!isMuted()) {
            sfx.click();
            // Unmuting mid-run brings the music back immediately — but only
            // while the run is actually live: music follows the pause state
            // (togglePause), so unmuting while paused must stay silent.
            if (state.gameActive && !state.isPaused && !state.onStartScreen) music.start();
        }
    });
}

// --- Start Overlay Functions (plan 008) ---
// The overlay owns the boot (and post-death) UX: while it is visible the
// game sits paused underneath and any key / click / tap starts the run.
export function showStartOverlay() {
    el.startOverlay.style.display = 'flex';
    state.onStartScreen = true;
}

export function hideStartOverlay() {
    el.startOverlay.style.display = 'none';
    state.onStartScreen = false;
}

// --- Death Screen Functions ---
// Fills the structured death screen (title is static "GAME OVER" markup);
// #hiscore-slot hosts the local top-5 leaderboard (plan 009). A rank-0
// NEW BEST earns confetti bursts behind the box + a victory fanfare.
export function showDeathScreen(reason, hiscores = [], rank = -1) {
    el.deathReason.textContent = reason;
    el.finalScore.textContent = state.score;
    renderHiscores(hiscores, rank);
    el.messageBox.style.display = 'block'; // Make the death screen visible
    if (rank === 0) {
        onNewBest(); // Staggered palette bursts, visible around the box
        sfx.fanfare();
    }
}

// Renders the BEST RUNS list into #hiscore-slot. The new run's row (by
// rank) is highlighted; rank 0 also earns the NEW BEST! badge. An empty
// list (storage unavailable AND the run failed to record) leaves the slot
// empty, which hides it.
function renderHiscores(list, rank) {
    el.hiscoreSlot.innerHTML = '';
    if (list.length === 0) return;
    if (rank === 0) {
        const badge = document.createElement('p');
        badge.className = 'hiscore-badge';
        badge.textContent = 'NEW BEST!';
        el.hiscoreSlot.appendChild(badge);
    }
    const title = document.createElement('p');
    title.className = 'hiscore-title';
    title.textContent = 'BEST RUNS';
    el.hiscoreSlot.appendChild(title);
    const ol = document.createElement('ol');
    ol.className = 'hiscore-list';
    list.forEach((entry, i) => {
        const li = document.createElement('li');
        li.textContent = `${entry.score} — ${entry.date}`;
        if (i === rank) li.classList.add('is-new');
        ol.appendChild(li);
    });
    el.hiscoreSlot.appendChild(ol);
}

// --- Combo chip (score-juice pass) ---
// A small yellow "COMBO xN" chip under the kill indicator. Visible only at
// x2 and up (x1 is just "a kill"); pops on every increment via the same
// remove/reflow/add dance as the score pop. enemies.js shows it on chained
// kills; timers.js hides it when the window expires; death and new games
// reset it here.
export function showComboChip(count) {
    if (!el.comboChip) return;
    el.comboChip.textContent = `COMBO x${count}`;
    el.comboChip.style.display = 'block';
    el.comboChip.classList.remove('combo-pop');
    void el.comboChip.offsetWidth; // Forces a reflow so the animation restarts
    el.comboChip.classList.add('combo-pop');
}

export function hideComboChip() {
    if (el.comboChip && el.comboChip.style.display !== 'none') {
        el.comboChip.style.display = 'none';
    }
}

// Zeroes the combo state and hides the chip — the single combo reset path
// (death via endGame, and every setupNewGame so a mid-run restart can't
// smuggle a live combo into the next run).
export function resetCombo() {
    state.comboCount = 0;
    state.comboTimeLeft = 0;
    hideComboChip();
}

// Ends the current run. This is the ONLY legal way to end a game — every
// death cause (enemy collision, collect-clock expiry, future hazards) must
// call it. Idempotent: safe against double triggers within one frame.
//
// Cinematic beat (spectacle pass): the player squashes flat and bursts
// (effects.js — the world is already frozen by the gameActive gate, but
// updateEffects keeps running), and the death screen arrives only after
// DEATH_SCREEN_DELAY. setTimeout is legal here — UI sequencing, not
// simulation. A restart during the delay is guarded twice: hideMessage()
// (via setupNewGame) clears the timer, and the callback re-checks that the
// game is still sitting on THIS dead run before showing anything.
let deathScreenTimer = null;

export function endGame(reason) {
    if (!state.gameActive) return;
    state.gameActive = false;
    resetCombo(); // Death breaks the chain (and clears the chip behind the box)
    resetTension(); // Panic pulse and danger vignette must not haunt the death screen
    resetIndicators(); // Nor stale enemy arrows / a frozen KILL! flash
    music.stop(); // 0.3s fadeout — the death jingle plays over it
    sfx.death();
    onPlayerDeath(); // Squash flat + orange-red burst (pool), behind the beat
    // Per-mode boards: the death screen shows the ladder of the mode that
    // just ended, and endless runs never pollute the classic top-5.
    const { list, rank } = recordScore(state.score, state.worldMode);
    deathScreenTimer = setTimeout(() => {
        deathScreenTimer = null;
        if (state.gameActive || state.onStartScreen) return; // A restart beat us to it
        showDeathScreen(reason, list, rank);
    }, DEATH_SCREEN_DELAY * 1000);
}

// --- Tension systems (awesome pass) ---
// The panic-timer CSS class and the danger vignette + heartbeat. All
// transient, all zeroed together by resetTension (endGame + setupNewGame).

let timerPanicOn = false;
let dangerBreathClock = 0; // Wall-independent breath phase (advances with game dt)
let dangerReducedMotion = false; // Resolved once in initUI
let lastVignetteCss = null; // Skip same-value style writes in the hot loop

// Toggles the 1Hz red pulse on the collect-timer display. Guarded so the
// per-frame call from tickCollectClock touches classList only on changes.
export function setTimerPanic(on) {
    if (on === timerPanicOn || !el.collectTimerDisplay) return;
    timerPanicOn = on;
    el.collectTimerDisplay.classList.toggle('timer-panic', on);
}

// Danger pulse + heartbeat, called each update frame from game.js BEFORE
// updateEnemies — so a death inside the enemy pass can zero the vignette
// without this frame re-raising it afterwards. The vignette eases toward
// DANGER_VIGNETTE_MAX while the nearest NON-killable enemy is within
// DANGER_RADIUS (torus-aware), with a slow 0.4Hz breath on top (static
// under reduced motion). The heartbeat thumps at HEARTBEAT_BPM only while
// danger persists AND hunt mode is off — the hunt layer already owns the
// music intensity; the heartbeat owns the dread.
export function updateDangerPulse(dt) {
    if (!state.gameActive || !state.player) return;
    let nearest = Infinity;
    let anyKillable = false;
    for (const enemyGroup of state.enemies) {
        if (canKillSpecificEnemy(enemyGroup)) {
            anyKillable = true;
            continue; // Killable enemies flee — they are prey, not danger
        }
        const d = torusDistance(enemyGroup.position, state.player.position);
        if (d < nearest) nearest = d;
    }
    const inDanger = nearest < DANGER_RADIUS;

    const target = inDanger ? DANGER_VIGNETTE_MAX : 0;
    state.dangerOpacity += (target - state.dangerOpacity) * (1 - Math.exp(-5 * dt));
    if (!inDanger && state.dangerOpacity < 0.003) state.dangerOpacity = 0; // Settle instead of asymptote
    // Reduced motion: static faint opacity (the eased base alone, no breath)
    let shown = state.dangerOpacity;
    if (!dangerReducedMotion && shown > 0) {
        dangerBreathClock += dt;
        // 0.4Hz breath riding the eased base; peak stays DANGER_VIGNETTE_MAX
        shown *= 0.8 + 0.2 * Math.sin(dangerBreathClock * Math.PI * 0.8);
    }
    const css = shown.toFixed(3);
    if (el.dangerVignette && css !== lastVignetteCss) {
        lastVignetteCss = css;
        el.dangerVignette.style.opacity = css;
    }

    if (inDanger && !anyKillable) {
        state.heartbeatClock -= dt;
        if (state.heartbeatClock <= 0) {
            sfx.heartbeat();
            state.heartbeatClock += 60 / HEARTBEAT_BPM;
        }
    } else {
        state.heartbeatClock = 0; // Re-entering danger thumps immediately
    }
}

// Zeroes every tension transient — the single reset path, called by endGame
// and by setupNewGame so neither the death screen nor a fresh run inherits
// a pulsing timer or a lingering red frame.
export function resetTension() {
    setTimerPanic(false);
    state.dangerOpacity = 0;
    state.heartbeatClock = 0;
    dangerBreathClock = 0;
    lastVignetteCss = null;
    if (el.dangerVignette) el.dangerVignette.style.opacity = '0';
}

// Hides every enemy indicator — the off-screen arrow pool and the KILL!
// flash — and rewinds the flash clock so the next appearance starts fully
// visible. The per-frame updaters only run while the game is live, so
// without this reset the last frame's indicators would freeze in place and
// haunt the death screen / start overlay, pointing at enemies that no
// longer exist. Same single-reset-path pattern as resetTension: called by
// endGame and by setupNewGame.
export function resetIndicators() {
    for (const indicator of state.enemyIndicators) {
        if (indicator.style.display !== 'none') indicator.style.display = 'none';
    }
    state.killFlashClock = 0;
    state.killIndicatorVisible = true;
    if (el.killIndicator && el.killIndicator.style.display !== 'none') {
        el.killIndicator.style.display = 'none';
    }
}

// Hides the message box — and cancels a death screen still waiting out the
// cinematic beat, so a fast restart can never have it pop over the overlay.
export function hideMessage() {
    if (deathScreenTimer !== null) {
        clearTimeout(deathScreenTimer);
        deathScreenTimer = null;
    }
    el.messageBox.style.display = 'none'; // Make the message box invisible
}

// Score / timer DOM writes. Score INCREASES get a pop animation (plan 015);
// resets to 0 on a new game don't. The remove/reflow/add dance retriggers
// the CSS animation on rapid scoring; reduced-motion users get no pop (CSS).
export function updateScoreDisplay() {
    const prev = Number(el.score.textContent);
    el.score.textContent = state.score;
    if (state.score > prev) {
        el.score.classList.remove('score-pop');
        void el.score.offsetWidth; // Forces a reflow so the animation restarts
        el.score.classList.add('score-pop');
    }
}

export function updateCollectTimeDisplay() {
    el.collectTime.textContent = Math.max(0, Math.ceil(state.collectTimeLeft));
}

// Creates the pool of off-screen enemy indicator elements.
export function createEnemyIndicators() {
    state.offscreenIndicatorContainer = document.getElementById('offscreen-indicator-container');
    if (state.offscreenIndicatorContainer) {
        for (let i = 0; i < MAX_ENEMY_INDICATORS; i++) {
            const indicator = document.createElement('div');
            indicator.className = 'enemy-indicator';
            // Base arrow points up (due to clip-path), will be rotated.
            state.offscreenIndicatorContainer.appendChild(indicator);
            state.enemyIndicators.push(indicator);
        }
    }
}

// Per-frame kill indicator update (flashes when any enemy is killable).
// dt is in seconds; the 0.5s accumulator gives a 1 flash/sec pulse — well
// under the 3/sec photosensitivity limit (WCAG 2.3.1) and, with the CSS
// opacity transition removed, an actually visible discrete flash.
export function updateKillIndicator(dt) {
    const anyEnemyKillable = state.enemies.some(enemy => canKillSpecificEnemy(enemy));
    // Hunt-mode music layer keys off the same already-computed signal;
    // the actual switch lands on the next bar boundary (audio.js).
    music.setIntensity(anyEnemyKillable ? 1 : 0);
    if (!el.killIndicator) return;
    if (anyEnemyKillable) {
        el.killIndicator.style.display = 'block';
        state.killFlashClock += dt;
        if (state.killFlashClock > 0.5) {
            state.killFlashClock = 0;
            state.killIndicatorVisible = !state.killIndicatorVisible;
        }
        el.killIndicator.style.opacity = state.killIndicatorVisible ? '1' : '0.35';
    } else if (el.killIndicator.style.display !== 'none') {
        el.killIndicator.style.display = 'none';
        // Reset so the next appearance always starts fully visible
        state.killFlashClock = 0;
        state.killIndicatorVisible = true;
    }
}

// --- Off-Screen Enemy Indicator Logic (per-frame) ---
export function updateOffscreenIndicators() {
    let indicatorsUsed = 0;
    const screenPadding = 15; // How far from the game edge indicators should sit (reduced slightly)

    state.enemies.forEach(enemyGroup => {
        const enemyPos = enemyGroup.position.clone();
        const screenPos = enemyPos.project(state.camera);

        const isOffScreenX = screenPos.x < -1 || screenPos.x > 1;
        const isOffScreenY = screenPos.y < -1 || screenPos.y > 1;

        if ((isOffScreenX || isOffScreenY) && indicatorsUsed < MAX_ENEMY_INDICATORS) {
            const indicator = state.enemyIndicators[indicatorsUsed];
            indicator.style.display = 'block';

            // Set indicator color based on killability
            if (canKillSpecificEnemy(enemyGroup)) {
                indicator.style.backgroundColor = 'rgba(255, 235, 59, 0.8)'; // Yellow (match enemy killable color, with alpha)
            } else {
                indicator.style.backgroundColor = 'rgba(3, 169, 244, 0.8)'; // Electric Blue (match enemy normal color, with alpha)
            }

            // Convert NDC to pixels relative to gameCanvasRect origin
            let x = (screenPos.x * state.gameCanvasRect.width / 2) + state.gameCanvasRect.width / 2;
            let y = -(screenPos.y * state.gameCanvasRect.height / 2) + state.gameCanvasRect.height / 2;

            // Clamp position to gameCanvasRect edges with padding
            // Position is relative to the #offscreen-indicator-container, which is viewport-sized.
            // So, we need to add gameCanvasRect.left and gameCanvasRect.top for final screen position.
            let clampedX = Math.max(screenPadding, Math.min(x, state.gameCanvasRect.width - screenPadding)) + state.gameCanvasRect.left;
            let clampedY = Math.max(screenPadding, Math.min(y, state.gameCanvasRect.height - screenPadding)) + state.gameCanvasRect.top;

            // Angle calculation from gameCanvasCenter to clamped enemy screen position (relative to viewport for atan2)
            const angle = Math.atan2(clampedY - state.gameCanvasCenterY, clampedX - state.gameCanvasCenterX) * 180 / Math.PI;

            indicator.style.transform = `translate(-50%, -50%) rotate(${angle + 90}deg)`;
            indicator.style.left = `${clampedX}px`;
            indicator.style.top = `${clampedY}px`;

            indicatorsUsed++;
        }
    });

    // Hide any unused indicators from the pool
    for (let i = indicatorsUsed; i < MAX_ENEMY_INDICATORS; i++) {
        if (state.enemyIndicators[i].style.display !== 'none') {
            state.enemyIndicators[i].style.display = 'none';
        }
    }
}
