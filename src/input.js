import { MAX_DRAG_DISTANCE, DEAD_ZONE_RADIUS, MOVEMENT_MODE } from './constants.js';
import { state } from './state.js';
import { togglePause, startRun, resetGame, cycleSpeed, tryJump } from './game.js';
import { sfx } from './audio.js';

export const keys = {}; // Object to keep track of currently pressed keys

// --- Keyboard movement vector (game-feel pass) ---
// Builds a UNIT-length input vector from the held movement keys (arrows and
// their WASD aliases), so diagonals move at exactly player speed instead of
// the old per-axis 1.41x. Opposite keys cancel to a clean zero (no jitter).
// Returned object is a module-level scratch — read it, don't keep it.
const keyboardScratch = { x: 0, z: 0 };
export function keyboardVector() {
    const right = (keys['arrowright'] || keys['d']) ? 1 : 0;
    const left = (keys['arrowleft'] || keys['a']) ? 1 : 0;
    const down = (keys['arrowdown'] || keys['s']) ? 1 : 0;
    const up = (keys['arrowup'] || keys['w']) ? 1 : 0;
    let x = right - left;
    let z = down - up;
    if (x !== 0 && z !== 0) {
        const inv = 1 / Math.hypot(x, z); // Both axes held: scale to unit length
        x *= inv;
        z *= inv;
    }
    keyboardScratch.x = x;
    keyboardScratch.z = z;
    return keyboardScratch;
}

// --- Event Handlers ---
// Handles key press down events.
export function onKeyDown(event) {
    // Held-key auto-repeat must not re-trigger state transitions (start,
    // restart, pause) — a held Space would otherwise strobe through them.
    const isRepeat = event.repeat;

    // Start overlay owns the keyboard while visible: any plain key starts
    // the run (browser shortcuts with modifiers are left alone).
    if (state.onStartScreen) {
        if (isRepeat || event.metaKey || event.ctrlKey || event.altKey) return;
        event.preventDefault();
        startRun();
        return;
    }

    // Game over: Space/Enter returns to the start overlay; everything else
    // is ignored. This guard runs BEFORE the pause handling below, so the
    // same press can never also toggle pause — by the time gameActive is
    // true again, this handler has already returned.
    if (!state.gameActive) {
        if (!isRepeat && (event.code === 'Space' || event.code === 'Enter')) {
            event.preventDefault();
            resetGame(); // Returns to the start overlay
        }
        return;
    }

    const key = event.key.toLowerCase();

    // Handle space bar for pause.
    // Plan 014 spike: in continuous mode Space is BOOST (held — handled by
    // movement-continuous.js's own listeners), so pause moves to P.
    // ENDLESS (owner queue item 5): Space is JUMP — pause moves to P, the
    // exact same pattern as the spike. Classic keeps Space = pause.
    if (key === ' ' || key === 'space') {
        event.preventDefault(); // Prevent page scroll
        if (MOVEMENT_MODE === 'continuous') return; // Boost, not pause
        if (state.worldMode === 'endless') {
            if (!isRepeat) tryJump(); // Fresh presses only — no held-key hop strobe
            return;
        }
        if (!isRepeat) togglePause();
        return;
    }
    if ((MOVEMENT_MODE === 'continuous' || state.worldMode === 'endless') && key === 'p') {
        if (!isRepeat) togglePause();
        return;
    }

    // Enter = pause/resume in BOTH modes (owner request) — a consistent
    // pause key regardless of what Space means in the current mode. Only
    // reachable mid-run: the overlay and death-screen guards above already
    // consumed Enter in those states (start / restart respectively).
    if (event.code === 'Enter') {
        if (!isRepeat) {
            sfx.click();
            togglePause();
        }
        return;
    }

    // F cycles the speed multiplier mid-run — owner: "shouldn't have to use
    // the mouse". Only reachable DURING a run: the start overlay consumed
    // the key above (any key starts there), and the death screen returned
    // before this. Mirrors the button path exactly (click sfx included).
    if (key === 'f') {
        if (!isRepeat) {
            sfx.click();
            cycleSpeed();
        }
        return;
    }

    keys[key] = true; // Record that the key is pressed
    // Prevent default browser action for arrow keys (scrolling)
    if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        event.preventDefault();
    }
}

// Handles key release events.
export function onKeyUp(event) {
    const key = event.key.toLowerCase();
    if (key !== ' ' && key !== 'space') { // Don't set space to false
        keys[key] = false; // Record that the key is released
    }
}

// --- Touch Anywhere Controls (plan 012) ---
// The finger that started the drag is tracked by its Touch.identifier so a
// second finger (e.g. tapping Pause mid-drag) can never hijack the movement
// vector. null means no drag in progress.
let activeTouchId = null;

// Returns the tracked driving touch from a TouchList-like, or null.
function findTrackedTouch(touchList) {
    for (let i = 0; i < touchList.length; i++) {
        if (touchList[i].identifier === activeTouchId) return touchList[i];
    }
    return null;
}

// Exported (and exposed on window.__game.debug) so the touch spec can drive
// the handler logic directly with fabricated event objects.
export function onTouchStart(e) {
    // Touches that start on UI never drive movement: buttons handle their
    // own taps, and the start overlay / message box own their whole surface.
    if (e.target.closest('button, #start-overlay, #message-box')) return;
    e.preventDefault();
    // A second finger on the canvas must not restart or hijack the drag.
    if (state.touchActive) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    activeTouchId = touch.identifier;
    state.touchActive = true;
    state.touchStartPoint.x = touch.clientX;
    state.touchStartPoint.y = touch.clientY;
    state.currentTouchPoint.x = touch.clientX;
    state.currentTouchPoint.y = touch.clientY;
    updateMovementVector();
}

export function onTouchMove(e) {
    if (!state.touchActive) return;
    e.preventDefault();
    const touch = findTrackedTouch(e.changedTouches);
    if (!touch) return; // Only the driving finger steers
    state.currentTouchPoint.x = touch.clientX;
    state.currentTouchPoint.y = touch.clientY;
    updateMovementVector();
}

export function onTouchEndOrCancel(e) {
    if (!state.touchActive) return;
    // Another finger lifting must not end the drag — only the driving one.
    if (!findTrackedTouch(e.changedTouches)) return;
    activeTouchId = null;
    state.touchActive = false;
    state.movementVector = { x: 0, y: 0 };
}

export function setupTouchControls() {
    state.gameScreenContainer = document.getElementById('game-container'); // Control area

    if (state.gameScreenContainer) {
        // Calculate game container center once, and on resize
        const updateGameCanvasBounds = () => { // Renamed for clarity
            const rect = state.gameScreenContainer.getBoundingClientRect();
            state.gameCanvasRect = rect; // Store the whole rect
            state.gameCanvasCenterX = rect.left + rect.width / 2;
            state.gameCanvasCenterY = rect.top + rect.height / 2;
        };
        updateGameCanvasBounds(); // Initial calculation
        window.addEventListener('resize', updateGameCanvasBounds); // Update on window resize

        state.gameScreenContainer.addEventListener('touchstart', onTouchStart);
        state.gameScreenContainer.addEventListener('touchmove', onTouchMove);
        state.gameScreenContainer.addEventListener('touchend', onTouchEndOrCancel);
        state.gameScreenContainer.addEventListener('touchcancel', onTouchEndOrCancel);
    } else {
        console.warn("Game container element not found for touch controls!");
    }
}

// NEW Function: updateMovementVector
function updateMovementVector() {
    let deltaX = state.currentTouchPoint.x - state.touchStartPoint.x;
    let deltaY = state.currentTouchPoint.y - state.touchStartPoint.y;

    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (distance < DEAD_ZONE_RADIUS) {
        state.movementVector.x = 0;
        state.movementVector.y = 0;
        return;
    }

    let normX = deltaX / MAX_DRAG_DISTANCE;
    let normY = deltaY / MAX_DRAG_DISTANCE;

    const magnitude = Math.sqrt(normX * normX + normY * normY);
    if (magnitude > 1.0) {
        normX /= magnitude;
        normY /= magnitude;
    }

    state.movementVector.x = normX;
    state.movementVector.y = normY;
}
