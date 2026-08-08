// --- Plan 014 DESIGN SPIKE: Little Big Snake-style continuous movement ---
// THROWAWAY PROTOTYPE, active only behind `?move=continuous` (see
// CONTINUOUS_MOVEMENT in constants.js). Deliberately spike-quality: inline-
// styled DOM, no tests, tuning numbers straight from the family's saved notes
// (docs/history/grok_tips.md §1-2). If the scheme is adopted, a real plan
// replaces this module; if rejected, delete it plus the CONTINUOUS_MOVEMENT
// branches.
//
// Behavior:
// - Desktop: the player moves continuously at actualPlayerSpeed toward the
//   mouse cursor (raycast onto the y=0 ground plane), steering the current
//   heading with a per-second lerp (1 - e^(-6*dt)).
// - Mobile: the plan-012 drag vector is the heading source; on finger lift
//   the LAST heading persists (the snake never stops).
// - Boost: hold Space (desktop) or the on-screen BOOST button (touch):
//   x1.5 speed while energy > 0; energy 100 max, -10/s boosting, +5/s regen.
// - Wrapping, collisions, camera: untouched — this module only changes how
//   the per-frame position delta is produced.
import * as THREE from 'three';
import { state } from './state.js';
import { spawnBurst } from './effects.js';
import { gamepadVector, gamepadBoostHeld } from './input.js';

// Tuning (grok_tips numbers; tune in playtest, not here-first)
const TURN_RATE = 6; // per-second steering stiffness: lerp t = 1 - e^(-6*dt)
const BOOST_MULTIPLIER = 1.5;
const ENERGY_MAX = 100;
const ENERGY_DRAIN_PER_S = 10;
const ENERGY_REGEN_PER_S = 5;
const CURSOR_DEADZONE = 0.5; // world units: inside this, hold current heading
const TRAIL_INTERVAL = 0.09; // seconds between boost-trail particle bursts

const heading = new THREE.Vector3(0, 0, -1); // default: "up-screen"
const targetDir = new THREE.Vector3();
const mouseNDC = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();

let hasMouse = false; // no steering target until the mouse first moves
let boostHeld = false;
let energy = ENERGY_MAX;
let trailClock = 0;
let barFill = null;

function onMouseMove(e) {
    if (!state.renderer) return;
    const rect = state.renderer.domElement.getBoundingClientRect();
    mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    hasMouse = true;
}

function onBoostKeyDown(e) {
    if (e.code !== 'Space') return;
    // The start overlay / death screen own Space (start / restart) — only a
    // live run reads it as boost.
    if (!state.gameActive || state.onStartScreen) return;
    boostHeld = true;
}

function onBoostKeyUp(e) {
    if (e.code === 'Space') boostHeld = false;
}

// One-time setup: input listeners + the (deliberately ugly) energy bar and
// touch boost button. Only ever called when CONTINUOUS_MOVEMENT is true.
export function initContinuousMovement() {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('keydown', onBoostKeyDown);
    document.addEventListener('keyup', onBoostKeyUp);

    // Bare-div energy bar, top-center over the canvas (spike quality)
    const bar = document.createElement('div');
    bar.id = 'energy-bar';
    bar.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);'
        + 'width:180px;height:12px;background:rgba(0,0,0,0.55);'
        + 'border:2px solid #fff;border-radius:6px;z-index:20;pointer-events:none;';
    barFill = document.createElement('div');
    barFill.style.cssText = 'height:100%;width:100%;background:#00E5FF;border-radius:4px;';
    bar.appendChild(barFill);
    state.gameContainer.appendChild(bar);

    // Rough on-screen boost button for touch devices. input.js already
    // ignores touches on <button> elements for movement, so holding it can
    // never hijack the steering drag.
    if (state.isMobile) {
        const btn = document.createElement('button');
        btn.id = 'boost-button';
        btn.textContent = 'BOOST';
        btn.style.cssText = 'position:absolute;bottom:18px;right:18px;width:88px;height:88px;'
            + 'border-radius:50%;border:3px solid #fff;background:rgba(0,229,255,0.35);'
            + 'color:#fff;font-weight:bold;z-index:20;touch-action:none;user-select:none;';
        const press = (e) => { e.preventDefault(); boostHeld = true; };
        const release = () => { boostHeld = false; };
        btn.addEventListener('pointerdown', press);
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
        btn.addEventListener('pointerleave', release);
        state.gameContainer.appendChild(btn);
    }
}

// Called from setupNewGame(): every run starts with full energy and the
// default up-screen heading.
export function resetContinuousMovement() {
    energy = ENERGY_MAX;
    heading.set(0, 0, -1);
    boostHeld = false;
    trailClock = 0;
    if (barFill) barFill.style.width = '100%';
}

// Per-frame movement (replaces the classic arrow/drag block in update()).
// dt in seconds; all speeds are units/second.
export function updateContinuousMovement(dt) {
    const player = state.player;
    if (!player) return;

    // 1. Pick the steering target
    const gp = gamepadVector();
    if (gp.x !== 0 || gp.z !== 0) {
        // Stick/D-pad: same screen-space mapping as touch drag
        targetDir.set(gp.x, 0, gp.z).normalize();
    } else if (state.touchActive && (state.movementVector.x !== 0 || state.movementVector.y !== 0)) {
        // Drag vector is screen-space (x right, y down) which maps straight
        // onto world (x, z) under this straight-down-behind camera.
        targetDir.set(state.movementVector.x, 0, state.movementVector.y).normalize();
    } else if (hasMouse && state.camera && !state.isMobile) {
        raycaster.setFromCamera(mouseNDC, state.camera);
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
            targetDir.set(hitPoint.x - player.position.x, 0, hitPoint.z - player.position.z);
            // Near-cursor deadzone: hold course instead of spinning in place
            if (targetDir.length() > CURSOR_DEADZONE) targetDir.normalize();
            else targetDir.copy(heading);
        } else {
            targetDir.copy(heading);
        }
    } else {
        // No input yet (or finger lifted on mobile): heading persists
        targetDir.copy(heading);
    }

    // 2. Steer: per-second exponential lerp (framerate-independent)
    heading.lerp(targetDir, 1 - Math.exp(-TURN_RATE * dt));
    if (heading.lengthSq() < 1e-8) heading.copy(targetDir); // lerp through zero (180° flip)
    heading.normalize();

    // 3. Boost + energy bookkeeping (Space, on-screen BOOST, or pad A / RT)
    const boosting = (boostHeld || gamepadBoostHeld()) && energy > 0;
    energy += (boosting ? -ENERGY_DRAIN_PER_S : ENERGY_REGEN_PER_S) * dt;
    energy = Math.min(ENERGY_MAX, Math.max(0, energy));
    if (barFill) barFill.style.width = `${energy}%`;

    // 4. Move at constant speed along the heading; face it. The mesh face is
    // on local +Z, and rotation.y = atan2(x, z) turns local +Z onto the
    // heading — face leads, no +PI correction needed.
    const speed = state.actualPlayerSpeed * (boosting ? BOOST_MULTIPLIER : 1);
    player.position.x += heading.x * speed * dt;
    player.position.z += heading.z * speed * dt;
    player.rotation.y = Math.atan2(heading.x, heading.z);

    // 5. Optional juice: a faint cyan trail while boosting (reuses the
    // plan-015 particle pool — zero new resources)
    if (boosting) {
        trailClock += dt;
        if (trailClock >= TRAIL_INTERVAL) {
            trailClock = 0;
            spawnBurst(player.position, { count: 3, speed: 1.5, upBias: 1, life: 0.3, gravity: 2, colorFrom: 0x00E5FF, colorTo: 0x004D40 });
        }
    } else {
        trailClock = 0;
    }
}

// Read-only introspection for manual/scripted verification (window.__game).
export function movementDebug() {
    return { energy, boostHeld, heading: { x: heading.x, z: heading.z }, hasMouse };
}
