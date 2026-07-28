import { MAX_DRAG_DISTANCE, DEAD_ZONE_RADIUS, MOVEMENT_MODE, GAMEPAD_DEADZONE } from './constants.js';
import { state } from './state.js';
import { togglePause, startRun, resetGame, cycleSpeed, tryJump } from './game.js';
import { sfx } from './audio.js';

export const keys = {}; // Object to keep track of currently pressed keys

// --- Gamepad (HTML Gamepad API) ---
// Polled every frame from animate(). Tuned for the Logitech F310 (Amazon
// B003VAHYQY) as well as standard Xbox-layout pads.
//
// F310 has a physical D/X switch on the back:
//   X = XInput  → browser mapping "standard" (Xbox indices)
//   D = DirectInput → empty mapping; A is button 1, D-pad is a hat axis
// Both modes are supported. Prefer X if you can flip the switch.
//
// Standard: axes 0/1 stick, buttons 12-15 D-pad, 0=A, 3=Y, 8=Back, 9=Start
// DirectInput F310: axes 0/1 stick, hat on a later axis, 1=A, 2=B, 3=Y, 8/9 menu
const gamepadAxesScratch = { x: 0, z: 0 };
let prevPadButtons = []; // Edge detection for face/menu buttons
let padConnected = false;
let preferredPadIndex = null; // Stick to the pad that last produced input

// Applies radial deadzone then re-scales remaining throw to [0,1] so small
// intentional tilts still reach full speed near the rim.
function applyDeadzone(x, y, zone) {
    const mag = Math.hypot(x, y);
    if (mag <= zone) return { x: 0, y: 0 };
    const scale = Math.min(1, (mag - zone) / (1 - zone)) / mag;
    return { x: x * scale, y: y * scale };
}

function axisValue(ax, i) {
    const v = ax[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function buttonPressed(gp, index) {
    const b = gp.buttons && gp.buttons[index];
    if (!b) return false;
    // Some DirectInput builds report value without pressed.
    return !!(b.pressed || (typeof b.value === 'number' && b.value >= 0.5));
}

function buttonEdge(gp, index) {
    return buttonPressed(gp, index) && !prevPadButtons[index];
}

// True when this pad is the F310 (or kin) in DirectInput / non-standard mode.
function isDirectInputLayout(gp) {
    if (!gp) return false;
    if (gp.mapping === 'standard') return false;
    const id = (gp.id || '').toLowerCase();
    // Explicit F310 / Logitech Dual Action family, or any pad with no standard map.
    return id.includes('f310') || id.includes('dual action') || id.includes('logitech') ||
        gp.mapping === '' || gp.mapping === 'none';
}

// Logical face/menu indices for this pad (standard vs F310 DirectInput).
function padButtons(gp) {
    if (isDirectInputLayout(gp)) {
        // DirectInput F310: 0=X 1=A 2=B 3=Y 6=LT 7=RT 8=Back 9=Start
        return { a: 1, b: 2, x: 0, y: 3, back: 8, start: 9, rt: 7, lt: 6 };
    }
    // Standard / XInput
    return { a: 0, b: 1, x: 2, y: 3, back: 8, start: 9, rt: 7, lt: 6 };
}

function padActivityScore(gp) {
    let score = 0;
    if (gp.mapping === 'standard') score += 0.25;
    const ax = gp.axes || [];
    for (let i = 0; i < ax.length; i++) score += Math.abs(axisValue(ax, i));
    const btns = gp.buttons || [];
    for (let i = 0; i < btns.length; i++) {
        if (buttonPressed(gp, i)) score += 2;
    }
    return score;
}

// Prefer the pad that is currently producing input; lock onto it so a
// silent ghost slot (common on macOS) cannot steal the first index.
function activeGamepad() {
    const list = navigator.getGamepads ? navigator.getGamepads() : null;
    if (!list) return null;

    if (preferredPadIndex != null) {
        const locked = list[preferredPadIndex];
        if (locked && locked.connected) {
            if (padActivityScore(locked) > 0.15) return locked;
            // Keep lock while connected even at rest, once claimed.
            return locked;
        }
        preferredPadIndex = null;
    }

    let best = null;
    let bestScore = 0;
    let bestIndex = -1;
    let first = null;
    let firstIndex = -1;
    for (let i = 0; i < list.length; i++) {
        const gp = list[i];
        if (!gp || !gp.connected) continue;
        if (first == null) {
            first = gp;
            firstIndex = i;
        }
        const score = padActivityScore(gp);
        if (score > bestScore) {
            bestScore = score;
            best = gp;
            bestIndex = i;
        }
    }
    if (best && bestScore > 0.15) {
        preferredPadIndex = bestIndex;
        return best;
    }
    if (first) {
        preferredPadIndex = firstIndex;
        return first;
    }
    return null;
}

// D-pad as buttons (standard) or hat axis (DirectInput F310: usually axis 9,
// sometimes 5/6/7; values are discrete ±1 / ±0.714 / 0).
function readDpad(gp) {
    let x = 0;
    let z = 0;
    if (buttonPressed(gp, 15)) x += 1;
    if (buttonPressed(gp, 14)) x -= 1;
    if (buttonPressed(gp, 13)) z += 1;
    if (buttonPressed(gp, 12)) z -= 1;
    if (x !== 0 || z !== 0) return { x, z };

    const ax = gp.axes || [];
    // Scan late axes for a hat: large magnitude, near-cardinal values.
    for (let i = 0; i < ax.length; i++) {
        if (i < 2) continue; // 0/1 are the left stick
        const v = axisValue(ax, i);
        if (Math.abs(v) < 0.2 || Math.abs(v) > 1.01) continue;
        // Classic DirectInput POV: -1 up, 1 down on one axis is rare; more
        // often a single hat axis encodes 8-way as stepped floats.
        // Two-axis hats (6/7 or 4/5): treat as digital if past threshold.
    }
    // Two-axis hat pairs common on DI pads
    for (const [xi, yi] of [[6, 7], [4, 5], [5, 6], [7, 8]]) {
        if (xi >= ax.length || yi >= ax.length) continue;
        const hx = axisValue(ax, xi);
        const hy = axisValue(ax, yi);
        if (Math.abs(hx) < 0.5 && Math.abs(hy) < 0.5) continue;
        return {
            x: hx > 0.5 ? 1 : hx < -0.5 ? -1 : 0,
            z: hy > 0.5 ? 1 : hy < -0.5 ? -1 : 0
        };
    }
    // Single hat axis (F310 DI often reports POV as one axis)
    for (let i = 2; i < ax.length; i++) {
        const v = axisValue(ax, i);
        if (Math.abs(v) < 0.5) continue;
        // Map common POV encodings to cardinals (Chrome F310 DI ≈ stepped).
        if (v < -0.9) return { x: 0, z: -1 }; // up
        if (v > 0.9) return { x: 0, z: 1 }; // down
        if (v > 0.1 && v < 0.6) return { x: 1, z: 0 }; // right-ish
        if (v < -0.1 && v > -0.6) return { x: -1, z: 0 }; // left-ish
        // 8-way diagonals — approximate
        if (v > 0.6 && v <= 0.9) return { x: 1, z: 1 };
        if (v < -0.6 && v >= -0.9) return { x: -1, z: -1 };
    }
    return { x: 0, z: 0 };
}

// Unit-length (or zero) move vector from left stick + D-pad. Stick Y is
// screen-down positive on the standard mapping, matching our world +Z /
// "S key" convention used by keyboardVector.
export function gamepadVector() {
    const gp = activeGamepad();
    gamepadAxesScratch.x = 0;
    gamepadAxesScratch.z = 0;
    if (!gp) return gamepadAxesScratch;

    const ax = gp.axes || [];
    // Left stick is always axes 0/1 on F310 X and D modes and on standard pads.
    const stick = applyDeadzone(axisValue(ax, 0), axisValue(ax, 1), GAMEPAD_DEADZONE);
    const dpad = readDpad(gp);

    let x = stick.x + dpad.x;
    let z = stick.y + dpad.z;
    const mag = Math.hypot(x, z);
    if (mag > 1) {
        x /= mag;
        z /= mag;
    }
    gamepadAxesScratch.x = x;
    gamepadAxesScratch.z = z;
    return gamepadAxesScratch;
}

function anyFaceEdge(gp) {
    const b = padButtons(gp);
    for (const i of [b.a, b.b, b.x, b.y, b.start]) {
        if (buttonEdge(gp, i)) return true;
    }
    // Also accept raw 0 on DI pads (X button) so any face starts.
    if (buttonEdge(gp, 0)) return true;
    return false;
}

function snapshotButtons(gp) {
    const n = gp.buttons ? gp.buttons.length : 0;
    if (prevPadButtons.length !== n) prevPadButtons = new Array(n).fill(false);
    for (let i = 0; i < n; i++) prevPadButtons[i] = buttonPressed(gp, i);
}

// True while A or RT is held — continuous-mode boost (mirrors Space).
export function gamepadBoostHeld() {
    const gp = activeGamepad();
    if (!gp) return false;
    const b = padButtons(gp);
    return buttonPressed(gp, b.a) || buttonPressed(gp, b.rt);
}

export function isGamepadConnected() {
    return padConnected || !!activeGamepad();
}

// Read-only snapshot for debug HUD / tests.
export function gamepadDebugInfo() {
    const gp = activeGamepad();
    if (!gp) return { connected: false };
    const b = padButtons(gp);
    return {
        connected: true,
        id: gp.id,
        mapping: gp.mapping || '',
        index: gp.index,
        directInput: isDirectInputLayout(gp),
        buttons: { a: b.a, b: b.b, y: b.y, start: b.start },
        axes: Array.from(gp.axes || []).map((v) => Math.round((v || 0) * 100) / 100),
        move: { ...gamepadVector() }
    };
}

// Edge-triggered actions. Must run every animation frame (including pause /
// start / death) because update() early-returns outside a live run.
export function pollGamepad() {
    const gp = activeGamepad();
    if (!gp) {
        if (prevPadButtons.length) prevPadButtons = [];
        padConnected = false;
        updatePadHud(null);
        return;
    }
    padConnected = true;
    updatePadHud(gp);
    const b = padButtons(gp);

    // Start overlay: any face/start press begins the run (matches "any key").
    if (state.onStartScreen) {
        if (anyFaceEdge(gp)) {
            startRun();
            snapshotButtons(gp);
            return;
        }
        snapshotButtons(gp);
        return;
    }

    // Death screen: A or Start returns to the start overlay (Space/Enter).
    if (!state.gameActive) {
        if (buttonEdge(gp, b.a) || buttonEdge(gp, b.start)) {
            resetGame();
            snapshotButtons(gp);
            return;
        }
        snapshotButtons(gp);
        return;
    }

    // Mid-run (including paused): Start / Select pause-toggles.
    if (buttonEdge(gp, b.start) || buttonEdge(gp, b.back)) {
        sfx.click();
        togglePause();
    }

    // Classic: A mirrors Space (pause). Endless: A is jump. Continuous: A is
    // boost (held — see gamepadBoostHeld), not an edge action.
    if (MOVEMENT_MODE === 'continuous') {
        // boost is level-held, not edge; nothing here
    } else if (state.worldMode === 'endless') {
        if (buttonEdge(gp, b.a)) tryJump();
        // B also pauses in endless so one face button is always "stop"
        if (buttonEdge(gp, b.b)) {
            sfx.click();
            togglePause();
        }
    } else if (buttonEdge(gp, b.a)) {
        togglePause();
    }

    // Y cycles speed (mirrors F).
    if (!state.isPaused && buttonEdge(gp, b.y)) {
        sfx.click();
        cycleSpeed();
    }

    snapshotButtons(gp);
}

// Small bottom-left status so a dead pad is obvious (id + mode).
let padHudEl = null;
function updatePadHud(gp) {
    if (!padHudEl) {
        padHudEl = document.getElementById('pad-status');
        if (!padHudEl) return;
    }
    if (!gp) {
        padHudEl.hidden = true;
        return;
    }
    padHudEl.hidden = false;
    const mode = gp.mapping === 'standard' ? 'XInput' : 'DirectInput';
    const short = (gp.id || 'Gamepad').split('(')[0].trim().slice(0, 28);
    const mv = gamepadVector();
    const live = Math.hypot(mv.x, mv.z) > 0.05 ? ' · live' : '';
    padHudEl.textContent = `${short} · ${mode}${live}`;
}

export function setupGamepad() {
    window.addEventListener('gamepadconnected', (e) => {
        padConnected = true;
        preferredPadIndex = e.gamepad ? e.gamepad.index : preferredPadIndex;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
        if (e.gamepad && e.gamepad.index === preferredPadIndex) preferredPadIndex = null;
        padConnected = !!activeGamepad();
        prevPadButtons = [];
        updatePadHud(activeGamepad());
    });
}

// --- Keyboard + gamepad movement vector (game-feel pass) ---
// Builds a UNIT-length input vector from the held movement keys (arrows and
// their WASD aliases) plus the active gamepad stick/D-pad, so diagonals move
// at exactly player speed instead of the old per-axis 1.41x. Opposite keys
// cancel to a clean zero (no jitter). Stick + keys are summed then clamped
// so combining sources never exceeds full speed.
// Returned object is a module-level scratch — read it, don't keep it.
const keyboardScratch = { x: 0, z: 0 };
export function keyboardVector() {
    const right = (keys['arrowright'] || keys['d']) ? 1 : 0;
    const left = (keys['arrowleft'] || keys['a']) ? 1 : 0;
    const down = (keys['arrowdown'] || keys['s']) ? 1 : 0;
    const up = (keys['arrowup'] || keys['w']) ? 1 : 0;
    let x = right - left;
    let z = down - up;
    const gp = gamepadVector();
    x += gp.x;
    z += gp.z;
    const mag = Math.hypot(x, z);
    if (mag > 1) {
        x /= mag;
        z /= mag;
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
