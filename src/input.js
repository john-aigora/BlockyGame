import { MAX_DRAG_DISTANCE, DEAD_ZONE_RADIUS, MOVEMENT_MODE, GAMEPAD_DEADZONE, GAMEPAD_STICK_CURVE } from './constants.js';
import { state } from './state.js';
import { togglePause, startRun, resetGame, cycleSpeed, speedUp, speedDown, tryJump } from './game.js';
import { zoomIn, zoomOut } from './world.js';
import { sfx } from './audio.js';
import { toggleMuteFromUI } from './ui.js';

export const keys = {}; // Object to keep track of currently pressed keys

// --- Gamepad (HTML Gamepad API) ---
// Polled every frame from animate(). Tuned for the Logitech F310 (Amazon
// B003VAHYQY) as well as standard Xbox-layout pads.
//
// F310 has a physical D/X switch on the back:
//   X = XInput  → browser mapping "standard" (Xbox indices) — weak on macOS
//   D = DirectInput → empty mapping; A is button 1, D-pad is a hat axis
// On Mac, use D. Plan 016: full session without keyboard.
//
// Binds (run): stick/D-pad move · A jump/pause · B pause (endless) · Start pause
//   Select mute · Y faster · X slower · LB/RB zoom · Start+Select restart
// Title: stick/D-pad left-right mode · face start
const gamepadAxesScratch = { x: 0, z: 0 };
// Per-pad edge state keyed by gamepad.index — the only stable identity on
// dual-port DB9 adapters (both interfaces may share an id string). A single
// shared array would leak pressed-state across pads when the active pad
// switches, firing false edges on the new pad.
const prevPadButtonsByIndex = new Map();
let lastPolledPadIndex = null; // Detect active-pad hand-off → seed, don't fire
let padConnected = false;
let preferredPadIndex = null; // Stick to the pad that last produced input
let padDebugEl = null;
const PAD_DEBUG = typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('paddebug') === '1';

// Applies radial deadzone then re-scales remaining throw to [0,1] so small
// intentional tilts still reach full speed near the rim.
function applyDeadzone(x, y, zone) {
    const mag = Math.hypot(x, y);
    if (mag <= zone) return { x: 0, y: 0 };
    const scale = Math.min(1, (mag - zone) / (1 - zone)) / mag;
    return { x: x * scale, y: y * scale };
}

// Ease-in on each axis after deadzone (arcade analog walk).
function applyStickCurve(x, y, exp) {
    if (exp <= 1) return { x, y };
    const cx = Math.sign(x) * Math.pow(Math.abs(x), exp);
    const cz = Math.sign(y) * Math.pow(Math.abs(y), exp);
    return { x: cx, y: cz };
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
    const prev = prevPadButtonsByIndex.get(gp.index);
    return buttonPressed(gp, index) && !(prev && prev[index]);
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
        // DirectInput F310: 0=X 1=A 2=B 3=Y 4=LB 5=RB 6=LT 7=RT 8=Back 9=Start
        return { a: 1, b: 2, x: 0, y: 3, lb: 4, rb: 5, back: 8, start: 9, rt: 7, lt: 6 };
    }
    // Standard / XInput
    return { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 8, start: 9, rt: 7, lt: 6 };
}

function padActivityScore(gp) {
    let score = 0;
    const ax = gp.axes || [];
    for (let i = 0; i < ax.length; i++) score += Math.abs(axisValue(ax, i));
    const btns = gp.buttons || [];
    for (let i = 0; i < btns.length; i++) {
        if (buttonPressed(gp, i)) score += 2;
    }
    // Bias standard mapping only when the pad is already producing input, so an
    // idle Xbox pad cannot outrank a live DirectInput/DB9 stick (battle-paddle fix).
    if (score > 0 && gp.mapping === 'standard') score += 0.25;
    return score;
}

// Prefer the pad that is currently producing input; lock onto it so a
// silent ghost slot (common on macOS) cannot steal the first index.
// HuiJia dual DB9→USB: one device, two interfaces, same id, idle socket
// always connected — identity by gamepad.index only, and activity always wins.
// Scan ALL pads first; adopt any pad producing input (re-pointing the lock);
// the lock is only the idle fallback. (Ported back from battle-paddle.)
//
// PER-FRAME CACHE (plan 020 P-7): the selection scan ran up to 3x per frame
// (poll, movement vector, HUD). pollGamepad bumps padPollCounter once per
// frame, the first caller scans, same-counter callers reuse the SELECTION.
// The cached value is a live Gamepad reference — axis/button reads stay
// fresh (the test mocks mutate their pad objects in place, and the connect/
// disconnect listeners bump the counter so selection reacts immediately).
let padPollCounter = 0;
let padCacheCounter = -1;
let padCacheResult = null;

function activeGamepad() {
    if (padCacheCounter === padPollCounter) return padCacheResult;
    padCacheCounter = padPollCounter;
    padCacheResult = scanActiveGamepad();
    return padCacheResult;
}

function scanActiveGamepad() {
    const list = navigator.getGamepads ? navigator.getGamepads() : null;
    if (!list) return null;

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
    // Dual-port adapters leave a silent second interface connected forever.
    // Never keep a preferred lock on an idle pad when another pad is
    // producing input.
    if (best && bestScore > 0.15) {
        preferredPadIndex = bestIndex;
        return best;
    }
    if (preferredPadIndex != null) {
        const locked = list[preferredPadIndex];
        if (locked && locked.connected) return locked;
        preferredPadIndex = null;
    }
    if (first) {
        preferredPadIndex = firstIndex;
        return first;
    }
    return null;
}

// D-pad as buttons (standard) or hat axis (DirectInput F310: usually axis 9,
// sometimes 5/6/7; values are discrete ±1 / ±0.714 / 0).
// Standard-mapping pads expose D-pad only as buttons 12-15 — never scan
// axes there, or the right stick (axes 2/3) becomes phantom full-speed walk.
function readDpad(gp) {
    let x = 0;
    let z = 0;
    if (buttonPressed(gp, 15)) x += 1;
    if (buttonPressed(gp, 14)) x -= 1;
    if (buttonPressed(gp, 13)) z += 1;
    if (buttonPressed(gp, 12)) z -= 1;
    if (x !== 0 || z !== 0) return { x, z };

    // XInput / standard: no hat axes to read.
    if (gp.mapping === 'standard') return { x: 0, z: 0 };

    const ax = gp.axes || [];
    // Two-axis hat pairs common on DI pads (never 0/1 left stick, never 2/3
    // right stick — those are analog sticks on F310 D mode too).
    for (const [xi, yi] of [[6, 7], [4, 5], [7, 8]]) {
        if (xi >= ax.length || yi >= ax.length) continue;
        const hx = axisValue(ax, xi);
        const hy = axisValue(ax, yi);
        if (Math.abs(hx) < 0.5 && Math.abs(hy) < 0.5) continue;
        return {
            x: hx > 0.5 ? 1 : hx < -0.5 ? -1 : 0,
            z: hy > 0.5 ? 1 : hy < -0.5 ? -1 : 0
        };
    }
    // Single hat/POV axis: only high indices (F310 DI often uses 9). Skip
    // 0-3 so left/right sticks never decode as cardinal D-pad.
    for (let i = 4; i < ax.length; i++) {
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
    let stick = applyDeadzone(axisValue(ax, 0), axisValue(ax, 1), GAMEPAD_DEADZONE);
    stick = applyStickCurve(stick.x, stick.y, GAMEPAD_STICK_CURVE);
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

// Re-export for debug callers that already import input.
export { rumble } from './rumble.js';

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
    let prev = prevPadButtonsByIndex.get(gp.index);
    if (!prev || prev.length !== n) {
        prev = new Array(n).fill(false);
        prevPadButtonsByIndex.set(gp.index, prev);
    }
    for (let i = 0; i < n; i++) prev[i] = buttonPressed(gp, i);
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
    padPollCounter++; // New frame — the first activeGamepad() call rescans
    const gp = activeGamepad();
    if (!gp) {
        if (prevPadButtonsByIndex.size) prevPadButtonsByIndex.clear();
        lastPolledPadIndex = null;
        padConnected = false;
        updatePadHud(null);
        updatePadDebug(null);
        return;
    }
    padConnected = true;
    updatePadHud(gp);
    updatePadDebug(gp);
    // First poll of this pad (fresh connect, reconnect, or active-pad
    // hand-off): seed edge state without firing. A button already held must
    // not auto-start, jump, or toggle pause on the switch itself.
    const isNewActivePad = gp.index !== lastPolledPadIndex;
    lastPolledPadIndex = gp.index;
    if (isNewActivePad || !prevPadButtonsByIndex.has(gp.index)) {
        snapshotButtons(gp);
        return;
    }
    const b = padButtons(gp);

    // Start overlay: face/start begins the run. Classic mode picker retired.
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

    // Start+Select chord = mid-run restart (takes priority over single binds).
    if (buttonPressed(gp, b.start) && buttonPressed(gp, b.back) &&
        (buttonEdge(gp, b.start) || buttonEdge(gp, b.back))) {
        sfx.click();
        resetGame();
        snapshotButtons(gp);
        return;
    }

    // Start = pause. Select/Back = mute (plan 016; was also pause).
    if (buttonEdge(gp, b.start)) {
        sfx.click();
        togglePause();
    }
    if (buttonEdge(gp, b.back)) {
        toggleMuteFromUI(); // Same path as the mute button (aria, unlock, music)
    }

    // Classic: A mirrors Space (pause). Endless: A is jump. Continuous: A is
    // boost (held — see gamepadBoostHeld), not an edge action.
    if (MOVEMENT_MODE === 'continuous') {
        // boost is level-held, not edge; nothing here
    } else if (state.worldMode === 'endless') {
        if (buttonEdge(gp, b.a)) tryJump();
        if (buttonEdge(gp, b.b)) {
            sfx.click();
            togglePause();
        }
    } else if (buttonEdge(gp, b.a)) {
        togglePause();
    }

    // Y = faster, X = slower (dedicated slow-down). F key still cycles.
    if (!state.isPaused && buttonEdge(gp, b.y)) {
        sfx.click();
        speedUp();
    }
    if (!state.isPaused && buttonEdge(gp, b.x)) {
        sfx.click();
        speedDown();
    }

    // LB / RB = zoom out / in
    if (buttonEdge(gp, b.lb)) {
        sfx.click();
        zoomOut();
    }
    if (buttonEdge(gp, b.rb)) {
        sfx.click();
        zoomIn();
    }

    snapshotButtons(gp);
}

// Status line: pad id + short bind reminder when live. The composed string
// is compared against the last write (plan 020 P-7): a per-frame
// textContent assignment invalidates layout even when the text is
// identical, and this text only actually changes on connect/movement edges.
let padHudEl = null;
let lastPadHudText = null;
function updatePadHud(gp) {
    if (!padHudEl) {
        padHudEl = document.getElementById('pad-status');
        if (!padHudEl) return;
    }
    if (!gp) {
        if (!padHudEl.hidden) padHudEl.hidden = true;
        lastPadHudText = null; // A reconnect must rewrite the line
        return;
    }
    if (padHudEl.hidden) padHudEl.hidden = false;
    const mode = gp.mapping === 'standard' ? 'XInput' : 'DirectInput';
    const short = (gp.id || 'Gamepad').split('(')[0].trim().slice(0, 22);
    const mv = gamepadVector();
    const live = Math.hypot(mv.x, mv.z) > 0.05 ? ' · live' : '';
    const text = state.onStartScreen
        ? `${short} · ${mode}${live} · A start`
        : `${short} · ${mode}${live} · A jump · X slow · Y fast · Start pause · Select mute`;
    if (text !== lastPadHudText) {
        lastPadHudText = text;
        padHudEl.textContent = text;
    }
}

function updatePadDebug(gp) {
    if (!PAD_DEBUG) return;
    if (!padDebugEl) {
        padDebugEl = document.createElement('pre');
        padDebugEl.id = 'pad-debug';
        padDebugEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;'
            + 'margin:0;padding:6px 8px;font:11px/1.35 monospace;color:#B2DFDB;'
            + 'background:rgba(0,0,0,0.72);max-width:42vw;white-space:pre-wrap;pointer-events:none;';
        document.body.appendChild(padDebugEl);
    }
    if (!gp) {
        padDebugEl.textContent = 'pad: none';
        return;
    }
    const info = gamepadDebugInfo();
    padDebugEl.textContent = JSON.stringify(info, null, 0);
}

export function setupGamepad() {
    window.addEventListener('gamepadconnected', (e) => {
        padPollCounter++; // Invalidate the selection cache — react this frame
        padConnected = true;
        preferredPadIndex = e.gamepad ? e.gamepad.index : preferredPadIndex;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
        padPollCounter++; // Invalidate the selection cache — react this frame
        if (e.gamepad && e.gamepad.index === preferredPadIndex) preferredPadIndex = null;
        if (e.gamepad) prevPadButtonsByIndex.delete(e.gamepad.index);
        padConnected = !!activeGamepad();
        updatePadHud(activeGamepad());
        updatePadDebug(activeGamepad());
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

// THE movement vector (audit C-5): sums EVERY source — keyboard, gamepad
// (via keyboardVector above), and the touch drag — then clamps ONCE to unit
// length. game.js consumes this for all player movement; the old shape
// added the touch vector on top of the already-clamped keys+stick sum, so
// stacking touch and keyboard reached 2x speed.
// Returned object is a module-level scratch — read it, don't keep it.
const moveScratch = { x: 0, z: 0 };
export function moveVector() {
    const kv = keyboardVector();
    let x = kv.x;
    let z = kv.z;
    if (state.touchActive) {
        x += state.movementVector.x;
        z += state.movementVector.y; // Touch vector is {x,y}: y drives world z
    }
    const mag = Math.hypot(x, z);
    if (mag > 1) {
        x /= mag;
        z /= mag;
    }
    moveScratch.x = x;
    moveScratch.z = z;
    return moveScratch;
}

// Zeroes every transient movement input — held keys, the touch drag, and
// its vector (audit C-4). Wired to window blur and the visibilitychange
// hidden branch in game.js: an alt-tab or app switch mid-run swallows the
// matching keyup, and a latched key would walk the player into a lake on
// resume. Plan 026 reuses this on seat switches — keep exported.
export function clearTransientInput() {
    for (const key in keys) keys[key] = false;
    activeTouchId = null;
    state.touchActive = false;
    state.movementVector.x = 0;
    state.movementVector.y = 0;
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
    // the mouse". R steps slower (dedicated slow-down; pad X is the peer).
    // Only reachable DURING a run: the start overlay consumed the key above
    // (any key starts there), and the death screen returned before this.
    if (key === 'f') {
        if (!isRepeat) {
            sfx.click();
            cycleSpeed();
        }
        return;
    }
    if (key === 'r') {
        if (!isRepeat) {
            sfx.click();
            speedDown();
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
