import { MAX_ENEMY_INDICATORS } from './constants.js';
import { state } from './state.js';
import { canKillSpecificEnemy } from './enemies.js';
import { recordScore } from './hiscores.js';
import { unlockAudio, sfx, music, isMuted, setMuted } from './audio.js';

// Cached DOM references, resolved once at init (plan 007) — the hot loop
// must never call getElementById. game.js calls initUI() before any UI write.
export const el = {
    score: null,
    collectTime: null,
    killIndicator: null,
    messageBox: null,
    deathReason: null,
    finalScore: null,
    startOverlay: null,
    startButton: null,
    pauseButton: null,
    speedButton: null,
    hiscoreSlot: null,
    muteButton: null
};

export function initUI() {
    el.score = document.getElementById('score');
    el.collectTime = document.getElementById('collect-time');
    el.killIndicator = document.getElementById('kill-indicator');
    el.messageBox = document.getElementById('message-box');
    el.deathReason = document.getElementById('death-reason');
    el.finalScore = document.getElementById('final-score');
    el.startOverlay = document.getElementById('start-overlay');
    el.startButton = document.getElementById('start-button');
    el.pauseButton = document.getElementById('pause-button');
    el.speedButton = document.getElementById('speed-cycle-button');
    el.hiscoreSlot = document.getElementById('hiscore-slot');
    el.muteButton = document.getElementById('mute-button');
    initMuteToggle();
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
            // Unmuting mid-run brings the music back immediately.
            if (state.gameActive && !state.onStartScreen) music.start();
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
// #hiscore-slot hosts the local top-5 leaderboard (plan 009).
export function showDeathScreen(reason, hiscores = [], rank = -1) {
    el.deathReason.textContent = reason;
    el.finalScore.textContent = state.score;
    renderHiscores(hiscores, rank);
    el.messageBox.style.display = 'block'; // Make the death screen visible
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

// Ends the current run. This is the ONLY legal way to end a game — every
// death cause (enemy collision, collect-clock expiry, future hazards) must
// call it. Idempotent: safe against double triggers within one frame.
export function endGame(reason) {
    if (!state.gameActive) return;
    state.gameActive = false;
    music.stop(); // 0.3s fadeout — the death jingle plays over it
    sfx.death();
    const { list, rank } = recordScore(state.score);
    showDeathScreen(reason, list, rank);
}

// Hides the message box.
export function hideMessage() {
    el.messageBox.style.display = 'none'; // Make the message box invisible
}

// Score / timer DOM writes.
export function updateScoreDisplay() {
    el.score.textContent = state.score;
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
