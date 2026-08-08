import { MAX_DRAG_DISTANCE, DEAD_ZONE_RADIUS, CONTINUOUS_MOVEMENT, GAMEPAD_DEADZONE, GAMEPAD_STICK_CURVE } from './constants.js';
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

// --- Two-player seat claims (plan 026; battle-paddle port) ---
// A pad CLAIMS a seat by producing real directional input (deadzoned stick
// or D-pad non-zero) — silent ghost interfaces (dual DB9 adapters) can
// never claim. Claims are keyed by gamepad.index (the only stable identity
// on those adapters — never the id string), persist until disconnect, and
// the FIRST live pad takes P1 unless P1's keyboard half was used this run
// (then P2 — the keyboard player keeps their hero); the second live pad
// takes the other seat. Solo never consults any of this: the single-pad
// activity-scan path below is untouched.
const seatClaims = [null, null]; // seat → gamepad.index (null = open)
const kbSeatActive = [false, false]; // This run used the seat's keyboard half (claim tiebreak)

// New run: nobody has "used the keyboard" yet (game.js setupNewGame).
export function resetSeatActivity() {
    kbSeatActive[0] = false;
    kbSeatActive[1] = false;
}

function seatForPadIndex(index) {
    if (seatClaims[0] === index) return 0;
    if (seatClaims[1] === index) return 1;
    return -1;
}

// gamepad.index normally equals the list slot, but the mock harness (and
// exotic stacks) may not — resolve by scanning.
function padByIndex(list, index) {
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].index === index && list[i].connected) return list[i];
    }
    return null;
}

// Deadzoned direction magnitude of THIS pad (stick + D-pad) — the claim test.
function padDirectionMagnitude(gp) {
    const ax = gp.axes || [];
    const stick = applyDeadzone(axisValue(ax, 0), axisValue(ax, 1), GAMEPAD_DEADZONE);
    const dpad = readDpad(gp);
    return Math.hypot(stick.x + dpad.x, stick.y + dpad.z);
}

// Runs every 2P poll: vacate dead claims, seat live claimants.
function refreshSeatClaims(list) {
    for (let seat = 0; seat < 2; seat++) {
        if (seatClaims[seat] != null && !padByIndex(list, seatClaims[seat])) {
            seatClaims[seat] = null; // Disconnect vacates the seat
        }
    }
    for (let i = 0; i < list.length; i++) {
        const gp = list[i];
        if (!gp || !gp.connected) continue;
        if (seatForPadIndex(gp.index) >= 0) continue; // Already seated
        if (padDirectionMagnitude(gp) <= 0) continue; // Ghosts never claim
        let seat = -1;
        if (seatClaims[0] == null && seatClaims[1] == null) {
            seat = kbSeatActive[0] ? 1 : 0; // First live pad: P1 unless P1 is a keyboard player this run
        } else if (seatClaims[0] == null) {
            seat = 0;
        } else if (seatClaims[1] == null) {
            seat = 1;
        }
        if (seat >= 0) seatClaims[seat] = gp.index;
    }
}

// Read-only snapshot for specs/debug (plain data, never the live arrays).
export function seatInfo() {
    return { claims: [...seatClaims], keyboardActive: [...kbSeatActive] };
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

// Unit-length (or zero) move vector from ONE pad's left stick + D-pad.
// Stick Y is screen-down positive on the standard mapping, matching our
// world +Z / "S key" convention used by keyboardVector.
function computePadVector(gp, out) {
    out.x = 0;
    out.z = 0;
    if (!gp) return out;

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
    out.x = x;
    out.z = z;
    return out;
}

// The ACTIVE pad's vector (solo path + debug HUD).
export function gamepadVector() {
    return computePadVector(activeGamepad(), gamepadAxesScratch);
}

// The vector of the pad CLAIMING this seat (2P path); zero when unseated.
const seatPadScratch = { x: 0, z: 0 };
function seatPadVector(seat) {
    const idx = seatClaims[seat];
    if (idx == null) {
        seatPadScratch.x = 0;
        seatPadScratch.z = 0;
        return seatPadScratch;
    }
    const list = navigator.getGamepads ? navigator.getGamepads() : null;
    return computePadVector(padByIndex(list, idx), seatPadScratch);
}

// Re-export for debug callers that already import input.
export { rumble } from './rumble.js';
import { setSeatPadResolver } from './rumble.js';

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
    if (state.players.length >= 2) {
        // 2P (plan 026): EVERY connected pad polls — seats claim, edge
        // actions fire per pad (Start pauses both from either pad; A jumps
        // for the pad's OWN seat). The solo single-active-pad path below is
        // untouched.
        pollGamepadSeats();
        return;
    }
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

    // A = jump, B = pause — one bind set in every world mode (audit D-6:
    // the classic-only "A mirrors Space as pause" fork is gone; classic is
    // a test/debug path and shares the endless binds, and tryJump itself
    // no-ops outside endless). Continuous: A is boost (held — see
    // gamepadBoostHeld), not an edge action.
    if (!CONTINUOUS_MOVEMENT) {
        if (buttonEdge(gp, b.a)) tryJump();
        if (buttonEdge(gp, b.b)) {
            sfx.click();
            togglePause();
        }
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

// The 2P poll body (plan 026): claims + per-pad edges. Reuses the per-pad
// edge Map (prevPadButtonsByIndex) — each pad's buttons edge independently,
// and a fresh pad seeds without firing, exactly like the solo hand-off rule.
function pollGamepadSeats() {
    const list = navigator.getGamepads ? navigator.getGamepads() : null;
    if (!list) {
        if (prevPadButtonsByIndex.size) prevPadButtonsByIndex.clear();
        padConnected = false;
        updatePadHud(null);
        updatePadDebug(null);
        return;
    }
    refreshSeatClaims(list);
    // Collect intents first, then apply shared actions ONCE (Fugu P2):
    // mutating start/death/pause inside the per-pad loop let pad 1 observe
    // pad 0's reset as a fresh start overlay and auto-startRun same frame.
    let anyPad = null;
    let wantStart = false;
    let wantReset = false;
    let wantPause = false;
    let wantMute = false;
    let wantSpeedUp = false;
    let wantSpeedDown = false;
    let wantZoomIn = false;
    let wantZoomOut = false;
    const jumpSeats = [];
    const onStart = state.onStartScreen;
    const inRun = state.gameActive && !state.onStartScreen;
    const onDeath = !state.gameActive && !state.onStartScreen;

    for (let i = 0; i < list.length; i++) {
        const gp = list[i];
        if (!gp || !gp.connected) continue;
        if (!anyPad) anyPad = gp;
        // First poll of this pad: seed edge state without firing — a button
        // already held must not auto-start, jump, or toggle pause.
        if (!prevPadButtonsByIndex.has(gp.index)) {
            snapshotButtons(gp);
            continue;
        }
        const b = padButtons(gp);

        if (onStart) {
            if (anyFaceEdge(gp)) wantStart = true;
            snapshotButtons(gp);
            continue;
        }

        if (onDeath) {
            if (buttonEdge(gp, b.a) || buttonEdge(gp, b.start)) wantReset = true;
            snapshotButtons(gp);
            continue;
        }

        if (!inRun) {
            snapshotButtons(gp);
            continue;
        }

        // Start+Select chord = mid-run restart (priority over single binds).
        if (buttonPressed(gp, b.start) && buttonPressed(gp, b.back) &&
            (buttonEdge(gp, b.start) || buttonEdge(gp, b.back))) {
            wantReset = true;
            snapshotButtons(gp);
            continue;
        }

        // Start / B = pause BOTH. Select/Back = mute. Shared → one apply.
        if (buttonEdge(gp, b.start)) wantPause = true;
        if (buttonEdge(gp, b.back)) wantMute = true;

        // A = jump for the pad's OWN seat (claim required first).
        if (!CONTINUOUS_MOVEMENT) {
            if (buttonEdge(gp, b.a)) {
                const seat = seatForPadIndex(gp.index);
                if (seat >= 0) jumpSeats.push(seat);
            }
            if (buttonEdge(gp, b.b)) wantPause = true;
        }

        // Speed and zoom are world-shared — either pad may drive them.
        if (!state.isPaused && buttonEdge(gp, b.y)) wantSpeedUp = true;
        if (!state.isPaused && buttonEdge(gp, b.x)) wantSpeedDown = true;
        if (buttonEdge(gp, b.lb)) wantZoomOut = true;
        if (buttonEdge(gp, b.rb)) wantZoomIn = true;

        snapshotButtons(gp);
    }

    // Apply shared intents once. Reset wins over start (never same state).
    if (wantReset) {
        if (inRun) sfx.click();
        resetGame();
    } else if (wantStart) {
        startRun();
    } else {
        if (wantPause) {
            sfx.click();
            togglePause();
        }
        if (wantMute) toggleMuteFromUI();
        for (const seat of jumpSeats) tryJump(seat);
        if (wantSpeedUp) {
            sfx.click();
            speedUp();
        }
        if (wantSpeedDown) {
            sfx.click();
            speedDown();
        }
        if (wantZoomOut) {
            sfx.click();
            zoomOut();
        }
        if (wantZoomIn) {
            sfx.click();
            zoomIn();
        }
    }

    padConnected = !!anyPad;
    updatePadHud(anyPad);
    updatePadDebug(anyPad);
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
    // Seat-aware rumble (plan 026): kills/collects/deaths pulse the pad of
    // the seat that earned them. Injection (not import) keeps rumble.js free
    // of input.js — see rumble.js.
    setSeatPadResolver((seat) => {
        const idx = seatClaims[seat];
        if (idx == null) return null;
        return padByIndex(navigator.getGamepads ? navigator.getGamepads() : null, idx);
    });
    window.addEventListener('gamepadconnected', (e) => {
        padPollCounter++; // Invalidate the selection cache — react this frame
        padConnected = true;
        preferredPadIndex = e.gamepad ? e.gamepad.index : preferredPadIndex;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
        padPollCounter++; // Invalidate the selection cache — react this frame
        if (e.gamepad && e.gamepad.index === preferredPadIndex) preferredPadIndex = null;
        if (e.gamepad) {
            prevPadButtonsByIndex.delete(e.gamepad.index);
            // A vacated seat reopens for the next live pad (plan 026).
            if (seatClaims[0] === e.gamepad.index) seatClaims[0] = null;
            if (seatClaims[1] === e.gamepad.index) seatClaims[1] = null;
        }
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

// One seat's HALF of the keyboard in 2P: WASD drives seat 0, Arrows drive
// seat 1 (Space vs Slash jump the same split — see onKeyDown). Solo never
// calls this — moveVector's solo branch keeps the full alias merge.
const keyboardHalfScratch = { x: 0, z: 0 };
function keyboardHalfVector(seat) {
    const right = (seat === 0 ? keys['d'] : keys['arrowright']) ? 1 : 0;
    const left = (seat === 0 ? keys['a'] : keys['arrowleft']) ? 1 : 0;
    const down = (seat === 0 ? keys['s'] : keys['arrowdown']) ? 1 : 0;
    const up = (seat === 0 ? keys['w'] : keys['arrowup']) ? 1 : 0;
    keyboardHalfScratch.x = right - left;
    keyboardHalfScratch.z = down - up;
    return keyboardHalfScratch;
}

// THE movement vector (audit C-5): sums EVERY source for a seat — keyboard,
// gamepad, and the touch drag — then clamps ONCE to unit length. game.js
// consumes this for all player movement; the old shape added the touch
// vector on top of the already-clamped keys+stick sum, so stacking touch
// and keyboard reached 2x speed.
// SOLO (one player): the exact classic merge — WASD+Arrows aliases, the
// ACTIVE pad, touch. 2P (plan 026): the seat's keyboard half + the pad
// claiming that seat (additive, same one-clamp rule, now per seat); the
// touch drag keeps driving seat 0.
// Returned object is a module-level scratch — read it, don't keep it.
const moveScratch = { x: 0, z: 0 };
export function moveVector(seat = 0) {
    let x;
    let z;
    if (state.players.length < 2) {
        const kv = keyboardVector();
        x = kv.x;
        z = kv.z;
        if (state.touchActive) {
            x += state.movementVector.x;
            z += state.movementVector.y; // Touch vector is {x,y}: y drives world z
        }
    } else {
        const kv = keyboardHalfVector(seat);
        const pv = seatPadVector(seat);
        x = kv.x + pv.x;
        z = kv.z + pv.z;
        if (seat === 0 && state.touchActive) {
            x += state.movementVector.x;
            z += state.movementVector.y;
        }
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

    // Modifier chords are the browser's, never the game's (audit C-10):
    // Cmd/Ctrl/Alt+key means find, reload, tab-switch... — firing a game
    // action underneath fights the OS. Bail before EVERY game bind,
    // including the game-over restart below (Cmd+Space is Spotlight, not
    // "reset my run" — B4 review advisory A1). Held movement keys are
    // unaffected: a chord's keydown never latches; keyup still clears.
    if (event.metaKey || event.ctrlKey || event.altKey) return;

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

    // Space = JUMP, P = pause — one bind set in every world mode (audit
    // D-6: the classic-only Space-as-pause fork is gone; classic is a
    // test/debug path and shares the endless binds, and tryJump itself
    // no-ops outside endless). Plan 014 spike: in continuous mode Space is
    // BOOST (held — handled by movement-continuous.js's own listeners);
    // P still pauses there.
    if (key === ' ' || key === 'space') {
        event.preventDefault(); // Prevent page scroll
        if (CONTINUOUS_MOVEMENT) return; // Boost, not pause
        if (!isRepeat) tryJump(0); // Fresh presses only — no held-key hop strobe
        return;
    }
    // 2P keyboard jump split (plan 026): Slash is seat 1's Space (Enter is
    // pause, so the right hand gets the key beside its arrows). Solo leaves
    // '/' exactly as before (an inert latched key).
    if (key === '/' && state.players.length >= 2) {
        event.preventDefault();
        if (!isRepeat) tryJump(1);
        return;
    }
    if (key === 'p') {
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
    // Seat-claim tiebreak (plan 026): remember which keyboard half moved
    // this run — the first claiming pad then leaves that player their hero.
    // WASD is seat 0's half; the arrows are seat 1's in 2P (in solo they
    // alias seat 0, whose keyboard is then "in use" either way).
    if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
        kbSeatActive[0] = true;
    } else if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        kbSeatActive[state.players.length >= 2 ? 1 : 0] = true;
    }
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
    // ONE container ref (audit D-10): the canvas host is also the touch
    // control area. game.js init resolves state.gameContainer before calling
    // this; the fallback lookup keeps any direct caller safe.
    if (!state.gameContainer) state.gameContainer = document.getElementById('game-container');
    const container = state.gameContainer;

    if (container) {
        // Calculate game container center once, and on resize
        const updateGameCanvasBounds = () => { // Renamed for clarity
            const rect = container.getBoundingClientRect();
            state.gameCanvasRect = rect; // Store the whole rect
            state.gameCanvasCenterX = rect.left + rect.width / 2;
            state.gameCanvasCenterY = rect.top + rect.height / 2;
        };
        updateGameCanvasBounds(); // Initial calculation
        window.addEventListener('resize', updateGameCanvasBounds); // Update on window resize

        container.addEventListener('touchstart', onTouchStart);
        container.addEventListener('touchmove', onTouchMove);
        container.addEventListener('touchend', onTouchEndOrCancel);
        container.addEventListener('touchcancel', onTouchEndOrCancel);
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
