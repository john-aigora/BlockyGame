import * as THREE from 'three';
import {
    worldSize,
    DUST_PARTICLES_PER_STEP, DUST_LIFE, DUST_SPEED, DUST_COLOR_FROM, DUST_COLOR_TO
} from './constants.js';
import { state } from './state.js';
import { COLLECTIBLE_MATERIAL } from './collectibles.js';
import { HERO_GLOW_MATERIAL, ENEMY_PUPIL_HUNT_MATERIAL, ENEMY_PUPIL_SCARED_MATERIAL } from './characters.js';

// --- Visual "juice" (plan 015) ---
// All effects here are procedural and pooled: ONE THREE.Points + ONE
// geometry + ONE material for every burst in the game (plan 007's
// shared-resource law extended to particles). Nothing in this module
// allocates GPU resources after initEffects().

// Honors the OS accessibility setting for SCREEN-SPACE motion (squash-
// stretch of the player you're staring at). Object motion (particles,
// leg swings) is allowed per WCAG guidance and the plan.
let reducedMotion = false;

// --- Particle pool ---
const MAX_PARTICLES = 512;
const positions = new Float32Array(MAX_PARTICLES * 3);
const velocities = new Float32Array(MAX_PARTICLES * 3);
const colors = new Float32Array(MAX_PARTICLES * 3);
const colorFrom = new Float32Array(MAX_PARTICLES * 3);
const colorTo = new Float32Array(MAX_PARTICLES * 3);
const life = new Float32Array(MAX_PARTICLES); // seconds remaining; <=0 = dead
const maxLife = new Float32Array(MAX_PARTICLES);
const gravity = new Float32Array(MAX_PARTICLES);
let cursor = 0; // Ring allocator — oldest particles are overwritten first
let activeParticles = 0;

const PARKED_Y = -9999; // Dead particles live far below the world

let points = null;
let posAttr = null;
let colAttr = null;

// Scratch colors — reused, never allocated in the frame loop.
const scratchColorA = new THREE.Color();
const scratchColorB = new THREE.Color();

// Global clock for pulses (food glow, aura, wobble). Advances with game dt,
// so pausing freezes every pulse along with the world.
let clock = 0;

// Player squash-and-stretch timer (seconds remaining; 0 = at rest).
const SQUASH_DURATION = 0.3;
let squashTime = 0;

export function initEffects() {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (points) return; // Idempotent — resources live for the app's lifetime

    for (let i = 0; i < MAX_PARTICLES; i++) {
        positions[i * 3 + 1] = PARKED_Y;
    }
    const geometry = new THREE.BufferGeometry();
    posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    colAttr = new THREE.BufferAttribute(colors, 3);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('color', colAttr);

    const material = new THREE.PointsMaterial({
        size: 0.38,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending, // Colors fading to black = sparks fading out
        depthWrite: false,
        sizeAttenuation: true
    });
    points = new THREE.Points(geometry, material);
    points.frustumCulled = false; // Parked particles would wreck the bounding sphere
    state.scene.add(points);

    // Food reads as a glowing pickup: shared material, so ALL food pulses
    // in sync — one uniform update per frame, zero per-item cost.
    COLLECTIBLE_MATERIAL.emissive.setHex(0x76FF03);
    COLLECTIBLE_MATERIAL.emissiveIntensity = 0.3;
}

// Spawns a radial burst of pooled particles at `origin`.
// Colors lerp from → to over the first 55% of life, then fade to black
// (which, under additive blending, IS the fade-out).
export function spawnBurst(origin, opts = {}) {
    if (!points) return;
    const count = opts.count ?? 14;
    const speed = opts.speed ?? 4.5;
    const upBias = opts.upBias ?? 2.5;
    const lifeSpan = opts.life ?? 0.45;
    const grav = opts.gravity ?? 9;
    scratchColorA.setHex(opts.colorFrom ?? 0x76FF03);
    scratchColorB.setHex(opts.colorTo ?? opts.colorFrom ?? 0x76FF03);

    for (let n = 0; n < count; n++) {
        const i = cursor;
        cursor = (cursor + 1) % MAX_PARTICLES;
        const i3 = i * 3;
        positions[i3] = origin.x;
        positions[i3 + 1] = origin.y;
        positions[i3 + 2] = origin.z;
        // Random direction on a flattened sphere with an upward kick
        const angle = Math.random() * Math.PI * 2;
        const mag = speed * (0.35 + Math.random() * 0.65);
        velocities[i3] = Math.cos(angle) * mag;
        velocities[i3 + 1] = upBias * (0.4 + Math.random() * 0.6) + Math.random() * speed * 0.4;
        velocities[i3 + 2] = Math.sin(angle) * mag;
        colorFrom[i3] = scratchColorA.r;
        colorFrom[i3 + 1] = scratchColorA.g;
        colorFrom[i3 + 2] = scratchColorA.b;
        colorTo[i3] = scratchColorB.r;
        colorTo[i3 + 1] = scratchColorB.g;
        colorTo[i3 + 2] = scratchColorB.b;
        colors[i3] = scratchColorA.r;
        colors[i3 + 1] = scratchColorA.g;
        colors[i3 + 2] = scratchColorA.b;
        life[i] = lifeSpan * (0.7 + Math.random() * 0.3);
        maxLife[i] = life[i];
        gravity[i] = grav;
    }
}

// --- Event hooks (called from game.js / enemies.js) ---

// Food collected: lime sparks from the food's spot + player squash-stretch.
export function onCollect(position) {
    spawnBurst(position, {
        count: 16,
        colorFrom: 0xCCFF66, // Bright lime-white pop...
        colorTo: 0x76FF03, // ...settling into food lime
        speed: 4.5,
        upBias: 3,
        life: 0.45
    });
    if (!reducedMotion) squashTime = SQUASH_DURATION;
}

// Enemy defeated: a bigger burst in the enemy's body color that transitions
// to food-lime — selling "the enemy became food".
export function onEnemyKilled(position, bodyColorHex, enemyScale) {
    spawnBurst(position, {
        count: 42,
        colorFrom: bodyColorHex,
        colorTo: 0x76FF03,
        speed: 5.5 + enemyScale,
        upBias: 3.5,
        life: 0.7,
        gravity: 7
    });
}

// New run: park every particle and reset transient animation state.
export function resetEffects() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
        life[i] = 0;
        positions[i * 3 + 1] = PARKED_Y;
    }
    activeParticles = 0;
    squashTime = 0;
    if (posAttr) posAttr.needsUpdate = true;
    if (state.player) resetWalk(state.player);
}

// --- Per-frame update (dt in seconds, from the game clock) ---
export function updateEffects(dt) {
    clock += dt;
    updateParticles(dt);
    updateSquash(dt);
    updateFoodGlow();
    // Hero glow accents (antenna tip + scarf) breathe at a gentle 0.5Hz —
    // one shared material, one uniform write per frame.
    HERO_GLOW_MATERIAL.emissiveIntensity = 0.6 + 0.25 * Math.sin(clock * Math.PI);
    if (state.player) {
        updateWalk(state.player, dt);
        updateBlink(state.player, dt);
    }
    for (const enemy of state.enemies) {
        updateWalk(enemy, dt);
        updateEnemyAura(enemy); // Sets the scared flag updateBlink reads
        updateBlink(enemy, dt);
    }
}

function updateParticles(dt) {
    let active = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        const i3 = i * 3;
        if (life[i] <= 0) {
            positions[i3 + 1] = PARKED_Y;
            colors[i3] = colors[i3 + 1] = colors[i3 + 2] = 0;
        } else {
            active++;
            velocities[i3 + 1] -= gravity[i] * dt;
            positions[i3] += velocities[i3] * dt;
            positions[i3 + 1] += velocities[i3 + 1] * dt;
            positions[i3 + 2] += velocities[i3 + 2] * dt;
            if (positions[i3 + 1] < 0.05) { // Sparks bounce softly off the ground
                positions[i3 + 1] = 0.05;
                velocities[i3 + 1] *= -0.35;
            }
            // Color timeline: from → to over the first 55% of life, then
            // to → black (the additive fade-out) over the rest.
            const t = 1 - life[i] / maxLife[i];
            if (t < 0.55) {
                const k = t / 0.55;
                colors[i3] = colorFrom[i3] + (colorTo[i3] - colorFrom[i3]) * k;
                colors[i3 + 1] = colorFrom[i3 + 1] + (colorTo[i3 + 1] - colorFrom[i3 + 1]) * k;
                colors[i3 + 2] = colorFrom[i3 + 2] + (colorTo[i3 + 2] - colorFrom[i3 + 2]) * k;
            } else {
                const k = 1 - (t - 0.55) / 0.45;
                colors[i3] = colorTo[i3] * k;
                colors[i3 + 1] = colorTo[i3 + 1] * k;
                colors[i3 + 2] = colorTo[i3 + 2] * k;
            }
        }
    }
    if (active > 0 || activeParticles > 0) {
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
    }
    activeParticles = active;
}

// Player squash-and-stretch: a single damped bounce (squash → overshoot →
// rest) layered ON TOP of playerScale. Restores the exact base scale when
// done, so gameplay height checks are untouched between pulses.
function updateSquash(dt) {
    if (!state.player) return;
    if (squashTime <= 0) return;
    squashTime -= dt;
    const base = state.playerScale;
    if (squashTime <= 0) {
        state.player.scale.set(base, base, base);
        return;
    }
    const t = 1 - squashTime / SQUASH_DURATION;
    const wave = Math.sin(t * Math.PI * 2) * (1 - t) * 0.22;
    const yf = 1 - wave; // Squash first (down), rebound second (up)
    const xzf = 1 + wave * 0.6; // Roughly volume-preserving
    state.player.scale.set(base * xzf, base * yf, base * xzf);
}

// All food pulses in sync via the ONE shared material — deliberate and cheap.
function updateFoodGlow() {
    COLLECTIBLE_MATERIAL.emissiveIntensity = 0.3 + 0.22 * Math.sin(clock * 3);
    for (const c of state.collectibles) {
        const phase = c.userData.phase ?? 0;
        c.rotation.y = clock * 1.4 + phase;
        c.position.y = 0.45 + Math.sin(clock * 2.5 + phase) * 0.08;
    }
}

// --- Distance-driven walk animation ---
// Leg swing phase advances with distance traveled (not wall time), so legs
// stride exactly as fast as the character moves and settle when idle.
// Legs are tagged at build time (characters.js → group.userData.legs).
const LEG_SIGNS = [1, -1, -1, 1]; // Diagonal pairs: FL+BR vs FR+BL
const walkScratch = { dx: 0, dz: 0 };

function seamDelta(a, b) {
    // Per-axis toroidal delta: the wrap seam must not read as a 200-unit sprint
    let d = a - b;
    if (d > worldSize / 2) d -= worldSize;
    else if (d < -worldSize / 2) d += worldSize;
    return d;
}

function updateWalk(group, dt) {
    const legs = group.userData.legs;
    if (!legs) return;
    let w = group.userData.walk;
    if (!w) {
        w = group.userData.walk = { phase: 0, swing: 0, step: 0, lastX: group.position.x, lastZ: group.position.z };
    }
    walkScratch.dx = seamDelta(group.position.x, w.lastX);
    walkScratch.dz = seamDelta(group.position.z, w.lastZ);
    w.lastX = group.position.x;
    w.lastZ = group.position.z;
    const dist = Math.hypot(walkScratch.dx, walkScratch.dz);
    const moving = dist > 0.0005;
    if (moving) {
        // Stride length scales with character size: big blocks lumber, small ones scurry
        w.phase += (dist / Math.max(group.scale.y, 0.001)) * 7;
        // Footstep dust: legs plant each half-cycle of the stride phase (the
        // diagonal pairs alternate), so a puff fires every π of phase — at
        // most one per frame, even if a teleport skips several strides.
        // Object motion → deliberately kept under prefers-reduced-motion.
        const step = Math.floor(w.phase / Math.PI);
        if (step !== w.step) {
            w.step = step;
            if (w.swing > 0.35) spawnFootstepDust(group);
        }
    }
    // Swing amplitude eases in when moving, out when idle (legs settle to rest)
    const target = moving ? 1 : 0;
    const ease = 1 - Math.exp(-12 * dt);
    w.swing += (target - w.swing) * ease;
    if (w.swing < 0.01 && !moving) {
        if (w.swing !== 0) {
            w.swing = 0;
            for (const leg of legs) leg.rotation.x = 0;
            if (group.userData.tailMesh) group.userData.tailMesh.rotation.y = 0;
            if (group.userData.earMeshes) {
                for (const ear of group.userData.earMeshes) ear.position.y = ear.userData.baseY;
            }
            if (group.userData.scarfSegs) {
                for (const seg of group.userData.scarfSegs) seg.rotation.x = seg.userData.restRotX;
            }
        }
        return;
    }
    const amp = 0.55 * w.swing;
    for (let i = 0; i < legs.length; i++) {
        legs[i].rotation.x = Math.sin(w.phase) * amp * LEG_SIGNS[i];
    }
    // A tiny body bounce on each stride — pure charm, barely-there amplitude
    const body = group.userData.bodyMesh;
    if (body && group.userData.bodyBaseY !== undefined) {
        body.position.y = group.userData.bodyBaseY + Math.abs(Math.sin(w.phase)) * 0.05 * w.swing;
    }
    // Glow-up flourishes: the enemy tail wags and ears bounce subtly on the
    // same stride phase. Tagged at build time (characters.js), like the legs.
    // Feet are parented to the legs and swing for free.
    const tail = group.userData.tailMesh;
    if (tail) tail.rotation.y = Math.sin(w.phase) * 0.35 * w.swing;
    const ears = group.userData.earMeshes;
    if (ears) {
        const bounce = Math.abs(Math.sin(w.phase + Math.PI / 2)) * 0.06 * w.swing;
        for (const ear of ears) ear.position.y = ear.userData.baseY + bounce;
    }
    // The hero scarf streams back (slightly up) and flutters on the stride
    // phase, easing back to its rest droop as the player settles. Segments
    // are chained, so each rotation compounds down the tail.
    const scarf = group.userData.scarfSegs;
    if (scarf) {
        for (let i = 0; i < scarf.length; i++) {
            const seg = scarf[i];
            const flutter = Math.sin(w.phase * 1.6 + i * 1.1) * 0.16;
            seg.rotation.x = seg.userData.restRotX * (1 - w.swing) + (0.3 + flutter) * w.swing;
        }
    }
}

// Footstep dust: a tiny, soft puff at ground level under the character on
// each stride plant. Uses the ONE pooled burst engine — 3-5 particles, pale
// teal-white, low velocity, gone in ~0.3s. Dust, not smoke.
const dustOrigin = { x: 0, y: 0, z: 0 }; // Scratch — never allocated per step
function spawnFootstepDust(group) {
    dustOrigin.x = group.position.x;
    dustOrigin.y = 0.06; // Just above the ground-bounce plane
    dustOrigin.z = group.position.z;
    spawnBurst(dustOrigin, {
        count: DUST_PARTICLES_PER_STEP,
        colorFrom: DUST_COLOR_FROM,
        colorTo: DUST_COLOR_TO,
        speed: DUST_SPEED,
        upBias: 0.5, // Barely lifts — settles right back down
        life: DUST_LIFE,
        gravity: 2
    });
}

function resetWalk(group) {
    const w = group.userData.walk;
    if (!w) return;
    w.phase = 0;
    w.swing = 0;
    w.step = 0;
    w.lastX = group.position.x;
    w.lastZ = group.position.z;
    if (group.userData.legs) for (const leg of group.userData.legs) leg.rotation.x = 0;
    const body = group.userData.bodyMesh;
    if (body && group.userData.bodyBaseY !== undefined) body.position.y = group.userData.bodyBaseY;
    if (group.userData.tailMesh) group.userData.tailMesh.rotation.y = 0;
    if (group.userData.earMeshes) {
        for (const ear of group.userData.earMeshes) ear.position.y = ear.userData.baseY;
    }
    if (group.userData.scarfSegs) {
        for (const seg of group.userData.scarfSegs) seg.rotation.x = seg.userData.restRotX;
    }
}

// --- Blinks + scared eyes ---
// Every character blinks on its own randomized timer (object motion —
// allowed under reduced motion; at ~1 blink per 3-6s it is nowhere near a
// strobe). A killable enemy is too scared to blink: eyes locked wide open,
// pupils huge and white (updateEnemyAura swaps the materials; the SCALE
// lives here so blink and scare can never fight over it).
const BLINK_DURATION = 0.14;

function updateBlink(group, dt) {
    const eyes = group.userData.eyeWhites;
    if (!eyes) return;
    let f = group.userData.face;
    if (!f) {
        // Random first blink = per-character phase; nobody blinks in lockstep
        f = group.userData.face = { nextBlink: 1 + Math.random() * 4, blinkT: 0 };
    }
    const scared = group.userData.scared === true;
    if (scared) {
        f.blinkT = 0;
    } else {
        f.nextBlink -= dt;
        if (f.nextBlink <= 0) {
            f.blinkT = BLINK_DURATION;
            f.nextBlink = 3 + Math.random() * 3;
        }
    }
    let lid = 1;
    if (f.blinkT > 0) {
        f.blinkT = Math.max(0, f.blinkT - dt);
        // Half-sine lid profile: open → nearly shut → open over one blink
        lid = 1 - 0.85 * Math.sin((1 - f.blinkT / BLINK_DURATION) * Math.PI);
    }
    const eyeWide = scared ? 1.3 : 1;
    const pupilWide = scared ? 1.9 : 1;
    for (const eye of eyes) eye.scale.set(eyeWide, eyeWide * lid, 1);
    const pupils = group.userData.pupils;
    if (pupils) {
        for (const pupil of pupils) pupil.scale.set(pupilWide, pupilWide * lid, 1);
    }
}

// --- Kill-mode aura + panic wobble ---
// Killable enemies get a pulsing yellow emissive ramp (reads as "lit up,
// vulnerable") and a panicked side-to-side wobble as they flee. The pulse
// is a smooth ~0.6Hz sine — nowhere near a strobe. Enemies own their body
// material (per-instance, plan 007), so this repaints nothing else.
function updateEnemyAura(enemyGroup) {
    const body = enemyGroup.userData.bodyMesh;
    if (!body) return;
    // Role-reversal face: glowing-red hunter pupils become huge white scared
    // ones (and the heavy brows flip to worried) the moment the enemy turns
    // killable — the flip is by REFERENCE to shared materials, nothing owned.
    // updateBlink handles the pupil/eye scale off the same scared flag.
    const scared = enemyGroup.userData.killable === true;
    if (scared !== enemyGroup.userData.scared) {
        enemyGroup.userData.scared = scared;
        const pupils = enemyGroup.userData.pupils;
        if (pupils) {
            for (const pupil of pupils) {
                pupil.material = scared ? ENEMY_PUPIL_SCARED_MATERIAL : ENEMY_PUPIL_HUNT_MATERIAL;
            }
        }
        const brows = enemyGroup.userData.brows;
        if (brows) {
            for (const brow of brows) {
                brow.rotation.z = scared ? brow.userData.scaredRotZ : brow.userData.baseRotZ;
                brow.position.y = scared ? brow.userData.scaredY : brow.userData.baseY;
            }
        }
    }
    if (enemyGroup.userData.killable) {
        body.material.emissive.setHex(0xFFEB3B);
        body.material.emissiveIntensity = 0.35 + 0.25 * Math.sin(clock * 4);
        let phase = enemyGroup.userData.wobblePhase;
        if (phase === undefined) {
            phase = enemyGroup.userData.wobblePhase = Math.random() * Math.PI * 2;
        }
        enemyGroup.rotation.z = Math.sin(clock * 9 + phase) * 0.07;
    } else {
        if (body.material.emissiveIntensity !== 0) {
            body.material.emissiveIntensity = 0;
            body.material.emissive.setHex(0x000000);
        }
        if (enemyGroup.rotation.z !== 0) {
            enemyGroup.rotation.z *= 0.8;
            if (Math.abs(enemyGroup.rotation.z) < 0.005) enemyGroup.rotation.z = 0;
        }
    }
}

// Debug/test introspection (read-only) — wired into window.__game by main.js.
export function effectsInfo() {
    return { reducedMotion, activeParticles, poolSize: MAX_PARTICLES };
}
