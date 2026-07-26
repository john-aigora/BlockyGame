import { MAX_ENEMY_INDICATORS } from './constants.js';
import { state } from './state.js';
import { canKillSpecificEnemy } from './enemies.js';

// --- UI and Message Functions ---
// Displays a message (usually game over) in the message box.
export function showMessage(message) {
    const messageBox = document.getElementById('message-box');
    const messageText = document.getElementById('message-text');
    messageText.textContent = message;
    messageBox.style.display = 'block'; // Make the message box visible
}

// Ends the current run. This is the ONLY legal way to end a game — every
// death cause (enemy collision, collect-clock expiry, future hazards) must
// call it. Idempotent: safe against double triggers within one frame.
export function endGame(reason) {
    if (!state.gameActive) return;
    state.gameActive = false;
    showMessage(`GAME OVER! ${reason} Final Score: ${state.score}`);
}

// Hides the message box.
export function hideMessage() {
    const messageBox = document.getElementById('message-box');
    messageBox.style.display = 'none'; // Make the message box invisible
}

// Score / timer DOM writes.
export function updateScoreDisplay() {
    document.getElementById('score').textContent = state.score;
}

export function updateCollectTimeDisplay() {
    document.getElementById('collect-time').textContent = Math.max(0, Math.ceil(state.collectTimeLeft));
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
// dt is in seconds; the flash toggles on a time accumulator (plan 007 owns the final look).
export function updateKillIndicator(dt) {
    const anyEnemyKillable = state.enemies.some(enemy => canKillSpecificEnemy(enemy));
    const killIndicator = document.getElementById('kill-indicator');
    if (killIndicator) {
        if (anyEnemyKillable) {
            killIndicator.style.display = 'block';
            state.killFlashClock += dt;
            if (state.killFlashClock > 0.5) {
                state.killFlashClock = 0;
                state.killIndicatorVisible = !state.killIndicatorVisible;
            }
            killIndicator.style.opacity = state.killIndicatorVisible ? '1' : '0.3';
        } else {
            killIndicator.style.display = 'none';
        }
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
