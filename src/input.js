import { MAX_DRAG_DISTANCE, DEAD_ZONE_RADIUS } from './constants.js';
import { state } from './state.js';
import { togglePause, startRun, resetGame } from './game.js';

export const keys = {}; // Object to keep track of currently pressed keys

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

    // Handle space bar for pause
    if (key === ' ' || key === 'space') {
        event.preventDefault(); // Prevent page scroll
        if (!isRepeat) togglePause();
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

// NEW Touch Anywhere Event Listeners
export function setupTouchControls() {
    state.gameScreenContainer = document.getElementById('game-container'); // Control area

    if (state.gameScreenContainer) {
        // Calculate game container center once, and on resize
        const updateGameCanvasBounds = () => { // Renamed for clarity
            const rect = state.gameScreenContainer.getBoundingClientRect();
            state.gameCanvasRect = rect; // Store the whole rect
            state.gameCanvasCenterX = rect.left + rect.width / 2;
            state.gameCanvasCenterY = rect.top + rect.height / 2;
            console.log("Game canvas bounds updated:", state.gameCanvasRect);
        };
        updateGameCanvasBounds(); // Initial calculation
        window.addEventListener('resize', updateGameCanvasBounds); // Update on window resize

        state.gameScreenContainer.addEventListener('touchstart', (e) => {
            const targetElement = e.target;
            if (!targetElement.closest('button')) {
                e.preventDefault();
            }
            if (e.touches.length > 0) {
                state.touchActive = true;
                state.touchStartPoint.x = e.touches[0].clientX;
                state.touchStartPoint.y = e.touches[0].clientY;
                state.currentTouchPoint.x = e.touches[0].clientX;
                state.currentTouchPoint.y = e.touches[0].clientY;
                updateMovementVector();
            }
        });

        state.gameScreenContainer.addEventListener('touchmove', (e) => {
            if (state.touchActive) {
                e.preventDefault();
            }
            if (state.touchActive && e.touches.length > 0) {
                state.currentTouchPoint.x = e.touches[0].clientX;
                state.currentTouchPoint.y = e.touches[0].clientY;
                updateMovementVector();
            }
        });

        const onTouchEndOrCancel = () => {
            if (state.touchActive) {
                state.touchActive = false;
                state.movementVector = { x: 0, y: 0 };
            }
        };

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
