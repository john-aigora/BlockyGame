import * as THREE from 'three';
import {
    worldSize,
    DUST_PARTICLES_PER_STEP, DUST_LIFE, DUST_SPEED, DUST_COLOR_FROM, DUST_COLOR_TO,
    POPUP_RISE, POPUP_LIFE, GROWTH_FRAME_FACTOR, PANIC_TIME, DEATH_SQUASH_TIME
} from './constants.js';
import { state } from './state.js';
import { torusDelta, torusDistance } from './worldmath.js';
import { groundHeightAt } from './terrain.js';
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
// Per-particle ground plane: classic is always 0.05 (the original constant);
// endless samples the terrain under the burst so sparks bounce on hills
// instead of raining through them into the lakebed.
const floors = new Float32Array(MAX_PARTICLES).fill(0.05);
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

// Growth-milestone scale pulse (seconds remaining; 0 = at rest). Combines
// multiplicatively with the squash in updatePlayerScaleFx, so a milestone
// landing on a collect (it always does) never fights the squash for scale.
const PULSE_DURATION = 0.35;
let pulseTime = 0;

// --- Floating score popup pool (score-juice pass) ---
// "+N" text sprites that rise and fade at the kill position. POOLED like
// everything else here: POPUP_POOL_SIZE sprites, each with its own small
// canvas + CanvasTexture created ONCE in initEffects. Spawning redraws the
// text on an existing canvas (a texture re-upload, not an allocation), so
// repeated kills hold the renderer's geometry/texture counts flat.
// THREE.Sprite shares one internal geometry across all instances (r128).
const POPUP_POOL_SIZE = 8;
const popups = []; // { sprite, texture, ctx2d, life, baseY }
let popupCursor = 0; // Ring allocator, same policy as the particle pool

// --- Panic food arrow (tension pass) ---
// ONE shared blocky pyramid floating above the player during the collect
// countdown's last PANIC_TIME seconds, pointing (torus-aware) at the
// nearest food. Hidden whenever inactive; zero per-frame allocation.
let foodArrow = null;
const arrowDelta = new THREE.Vector3(); // Scratch for the torus direction

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

    // Score popup pool: all GPU-side resources exist from here on.
    for (let i = 0; i < POPUP_POOL_SIZE; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx2d = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false // Always readable, even inside a burst or a body
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.renderOrder = 10; // On top of particles
        sprite.visible = false;
        state.scene.add(sprite);
        popups.push({ sprite, texture, ctx2d, life: 0, baseY: 0 });
    }

    // Panic food arrow: a 4-sided cone reads as a blocky pyramid — on-theme.
    // The tip is pre-rotated to +Z so a single rotation.y aims it. It wears
    // the hero's breathing lime glow material: same visual language as the
    // scarf/antenna, zero new materials. Created once here (boot), so the
    // resource-pin tests never see it as growth.
    const arrowGeometry = new THREE.ConeGeometry(0.34, 0.85, 4);
    arrowGeometry.rotateX(Math.PI / 2); // Tip points +Z; rotation.y steers it
    foodArrow = new THREE.Mesh(arrowGeometry, HERO_GLOW_MATERIAL);
    foodArrow.visible = false;
    state.scene.add(foodArrow);

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
    // One terrain sample per burst (not per particle) — the slope within a
    // burst radius is negligible at this world's gentle amplitudes.
    const floor = state.worldMode === 'endless'
        ? groundHeightAt(origin.x, origin.z) + 0.05
        : 0.05;

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
        floors[i] = floor;
    }
}

// Spawns a radial ring shockwave from the pool: particles placed evenly on a
// circle around `origin`, all moving straight outward with no gravity — an
// expanding ring, not a splash. Used by the growth milestone.
export function spawnRing(origin, opts = {}) {
    if (!points) return;
    const count = opts.count ?? 28;
    const radius = opts.radius ?? 0.8;
    const speed = opts.speed ?? 5;
    const lifeSpan = opts.life ?? 0.5;
    scratchColorA.setHex(opts.colorFrom ?? 0xCCFF66);
    scratchColorB.setHex(opts.colorTo ?? 0x76FF03);
    for (let n = 0; n < count; n++) {
        const i = cursor;
        cursor = (cursor + 1) % MAX_PARTICLES;
        const i3 = i * 3;
        const angle = (n / count) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        // Hugs the ground — a floor shockwave. origin.y is 0 in classic
        // (the player's y never leaves 0 there); endless passes the
        // terrain-grounded player position, so the ring rides the hill.
        positions[i3] = origin.x + cos * radius;
        positions[i3 + 1] = origin.y + 0.15;
        positions[i3 + 2] = origin.z + sin * radius;
        velocities[i3] = cos * speed;
        velocities[i3 + 1] = 0.3; // The faintest lift so the ring stays visible
        velocities[i3 + 2] = sin * speed;
        colorFrom[i3] = scratchColorA.r;
        colorFrom[i3 + 1] = scratchColorA.g;
        colorFrom[i3 + 2] = scratchColorA.b;
        colorTo[i3] = scratchColorB.r;
        colorTo[i3 + 1] = scratchColorB.g;
        colorTo[i3 + 2] = scratchColorB.b;
        colors[i3] = scratchColorA.r;
        colors[i3 + 1] = scratchColorA.g;
        colors[i3 + 2] = scratchColorA.b;
        life[i] = lifeSpan;
        maxLife[i] = lifeSpan;
        gravity[i] = 0; // Rings expand flat; they don't rain down
        floors[i] = origin.y + 0.05; // Same plane the ring rides (origin.y = 0 in classic)
    }
}

// Spawns a floating "+N" score popup at `position` (world space). Reuses the
// pooled sprite/canvas ring — the only work is a 2D text redraw + upload.
export function spawnScorePopup(position, points_) {
    if (popups.length === 0) return;
    const p = popups[popupCursor];
    popupCursor = (popupCursor + 1) % POPUP_POOL_SIZE;
    const ctx2d = p.ctx2d;
    ctx2d.clearRect(0, 0, 256, 128);
    ctx2d.font = 'bold 64px "Courier New", monospace'; // Chunky arcade digits
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.lineWidth = 10;
    ctx2d.lineJoin = 'round';
    ctx2d.strokeStyle = 'rgba(0, 0, 0, 0.9)'; // Outline first — readable on any bg
    ctx2d.strokeText(`+${points_}`, 128, 64);
    ctx2d.fillStyle = '#FFEB3B'; // Bright Yellow — the kill/bounty color
    ctx2d.fillText(`+${points_}`, 128, 64);
    p.texture.needsUpdate = true;
    // Popups scale with the camera's growth pull-back so they stay the same
    // size ON SCREEN as the player (and the framing) grows.
    const frame = 1 + (state.playerScale - 1) * GROWTH_FRAME_FACTOR;
    p.sprite.scale.set(3.0 * frame, 1.5 * frame, 1);
    p.sprite.position.set(position.x, position.y + 0.5, position.z);
    p.baseY = p.sprite.position.y;
    p.sprite.material.opacity = 1;
    p.sprite.visible = true;
    p.life = POPUP_LIFE;
}

function updatePopups(dt) {
    for (const p of popups) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) {
            p.sprite.visible = false;
            continue;
        }
        const t = 1 - p.life / POPUP_LIFE;
        p.sprite.position.y = p.baseY + POPUP_RISE * t;
        // Fully opaque for the first ~40% of life, then a linear fade-out.
        p.sprite.material.opacity = Math.min(1, p.life / (POPUP_LIFE * 0.6));
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

// --- Cinematic death (spectacle pass) ---
// On endGame the player squashes flat over DEATH_SQUASH_TIME, then bursts
// into orange-red pooled particles and vanishes; the death screen arrives
// after the beat (ui.js owns that delay). The squash is screen-space motion
// on the object you stare at — skipped under prefers-reduced-motion, where
// the block simply bursts. setupNewGame → resetEffects restores the mesh.
const deathOrigin = { x: 0, y: 0, z: 0 }; // Scratch — never allocated per death
let deathSquashTime = 0; // Seconds remaining in the squash; 0 = inactive

export function onPlayerDeath() {
    if (!state.player) return;
    // The death sequence owns the player's scale from here — a collect
    // squash or milestone pulse mid-flight must not fight it.
    squashTime = 0;
    pulseTime = 0;
    if (reducedMotion) {
        spawnDeathBurst();
        state.player.visible = false;
        return;
    }
    deathSquashTime = DEATH_SQUASH_TIME;
}

function spawnDeathBurst() {
    // Body center; endless lifts it by the terrain under the player
    // (player y is always 0 in classic).
    const baseY = state.worldMode === 'endless' ? state.player.position.y : 0;
    deathOrigin.x = state.player.position.x;
    deathOrigin.y = baseY + Math.max(0.3, state.playerScale * 0.5);
    deathOrigin.z = state.player.position.z;
    spawnBurst(deathOrigin, {
        count: 64,
        colorFrom: 0xFF8A50, // Hot orange flash...
        colorTo: 0xFF4500, // ...settling into the player's own orange-red
        speed: 6.5 + state.playerScale * 0.5,
        upBias: 4,
        life: 0.8,
        gravity: 7
    });
}

function updateDeathFx(dt) {
    if (deathSquashTime <= 0 || !state.player || !state.player.visible) return;
    deathSquashTime -= dt;
    const base = state.playerScale;
    if (deathSquashTime <= 0) {
        // Fully flat — the block bursts into sparks and is gone.
        spawnDeathBurst();
        state.player.visible = false;
        return;
    }
    const t = 1 - deathSquashTime / DEATH_SQUASH_TIME;
    const eased = t * t; // Accelerates into the floor
    state.player.scale.set(
        base * (1 + 0.7 * eased),
        base * Math.max(0.04, 1 - 0.96 * eased), // Pancaked, never inverted
        base * (1 + 0.7 * eased)
    );
}

// --- New-best celebration (spectacle pass) ---
// When the death screen announces a rank-0 NEW BEST, three staggered
// multicolor bursts (palette colors only) pop around the player's spot —
// visible behind the translucent death box. Driven by the effects clock:
// updateEffects keeps running after death, so the stagger needs no timers.
const CELEBRATION_COLORS = [0x76FF03, 0xFFEB3B, 0x03A9F4]; // Food lime, kill yellow, enemy blue
const CELEBRATION_STAGGER = 0.28; // Seconds between bursts
const celebrationOrigin = { x: 0, y: 0, z: 0 }; // Scratch
let celebrationSteps = 0; // Bursts remaining
let celebrationClock = 0; // Seconds until the next one

export function onNewBest() {
    celebrationSteps = CELEBRATION_COLORS.length;
    celebrationClock = 0; // First burst on the next effects frame
}

function updateCelebration(dt) {
    if (celebrationSteps <= 0 || !state.player) return;
    celebrationClock -= dt;
    if (celebrationClock > 0) return;
    celebrationClock = CELEBRATION_STAGGER;
    celebrationSteps--;
    const color = CELEBRATION_COLORS[celebrationSteps];
    // The bursts alternate LEFT and RIGHT of the player, pushed far enough
    // out to fountain past the edges of the centered death box (which is
    // nearly opaque). Offsets scale with the camera's growth pull-back so
    // the confetti clears the box at every player size.
    const frame = 1 + (state.playerScale - 1) * GROWTH_FRAME_FACTOR;
    const side = celebrationSteps % 2 === 0 ? 1 : -1;
    const baseY = state.worldMode === 'endless' ? state.player.position.y : 0;
    celebrationOrigin.x = state.player.position.x + side * (8 + Math.random() * 4) * frame;
    celebrationOrigin.y = baseY + (1 + Math.random() * 2) * frame;
    celebrationOrigin.z = state.player.position.z + (Math.random() - 0.5) * 5 * frame;
    spawnBurst(celebrationOrigin, {
        count: 36,
        colorFrom: 0xFFFFFF, // White flash...
        colorTo: color, // ...raining down in a palette color
        speed: 5,
        upBias: 6,
        life: 1.0,
        gravity: 6
    });
}

// Growth milestone (score-juice pass): a lime floor shockwave ring sized to
// the player, plus a brief celebratory scale pulse. The pulse is screen-
// space-adjacent motion on the object you stare at — skipped under
// prefers-reduced-motion, like the squash. The ring (object motion) stays.
export function onGrowthMilestone(position, playerScale) {
    spawnRing(position, {
        count: 30,
        radius: 0.7 * playerScale,
        speed: 5 + playerScale * 0.5,
        colorFrom: 0xCCFF66, // Bright lime-white...
        colorTo: 0x76FF03, // ...settling into food lime
        life: 0.5
    });
    if (!reducedMotion) pulseTime = PULSE_DURATION;
}

// New run: park every particle and reset transient animation state.
export function resetEffects() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
        life[i] = 0;
        positions[i * 3 + 1] = PARKED_Y;
    }
    activeParticles = 0;
    squashTime = 0;
    pulseTime = 0;
    // Cinematic-death cleanup: un-burst the player for the new run
    // (setupNewGame restores the scale right before calling this).
    deathSquashTime = 0;
    celebrationSteps = 0;
    if (state.player) state.player.visible = true;
    if (foodArrow) foodArrow.visible = false;
    for (const p of popups) {
        p.life = 0;
        p.sprite.visible = false;
    }
    if (posAttr) posAttr.needsUpdate = true;
    if (state.player) resetWalk(state.player);
}

// --- Per-frame update (dt in seconds, from the game clock) ---
export function updateEffects(dt) {
    clock += dt;
    updateParticles(dt);
    updatePopups(dt);
    updateDeathFx(dt); // Death squash owns the scale once it starts (squash/pulse zeroed)
    updateCelebration(dt);
    updatePlayerScaleFx(dt);
    updateFoodGlow();
    updateFoodArrow();
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
            if (positions[i3 + 1] < floors[i]) { // Sparks bounce softly off the ground
                positions[i3 + 1] = floors[i];
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

// Player scale FX: the collect squash-and-stretch and the milestone pulse,
// combined multiplicatively and layered ON TOP of playerScale. Restores the
// exact base scale when both timers expire, so gameplay height checks are
// untouched between pulses.
function updatePlayerScaleFx(dt) {
    if (!state.player) return;
    if (squashTime <= 0 && pulseTime <= 0) return;
    const base = state.playerScale;
    let yf = 1;
    let xzf = 1;
    if (squashTime > 0) {
        squashTime -= dt;
        if (squashTime > 0) {
            const t = 1 - squashTime / SQUASH_DURATION;
            const wave = Math.sin(t * Math.PI * 2) * (1 - t) * 0.22;
            yf *= 1 - wave; // Squash first (down), rebound second (up)
            xzf *= 1 + wave * 0.6; // Roughly volume-preserving
        }
    }
    if (pulseTime > 0) {
        pulseTime -= dt;
        if (pulseTime > 0) {
            // A single proud swell: up ~10% and back, uniform on all axes
            const t = 1 - pulseTime / PULSE_DURATION;
            const swell = 1 + Math.sin(t * Math.PI) * 0.1;
            yf *= swell;
            xzf *= swell;
        }
    }
    // When the LAST timer just expired this frame, yf/xzf are exactly 1 —
    // this write IS the base-scale restore.
    state.player.scale.set(base * xzf, base * yf, base * xzf);
}

// Panic food arrow: while the collect countdown is at or under PANIC_TIME
// (and the run is live), the shared pyramid bobs gently above the player's
// head, aimed along the shortest torus path to the NEAREST food. It scales
// with the camera's growth pull-back (like the score popups) so it stays
// the same size on screen, and vanishes the moment the timer resets or the
// run ends. The bob is object motion — allowed under reduced motion.
function updateFoodArrow() {
    if (!foodArrow || !state.player) return;
    const active = state.gameActive &&
        state.collectTimeLeft <= PANIC_TIME &&
        state.collectibles.length > 0;
    if (!active) {
        if (foodArrow.visible) foodArrow.visible = false;
        return;
    }
    let nearest = null;
    let best = Infinity;
    for (const c of state.collectibles) {
        const d = torusDistance(state.player.position, c.position);
        if (d < best) {
            best = d;
            nearest = c;
        }
    }
    torusDelta(state.player.position, nearest.position, arrowDelta);
    const frame = 1 + (state.playerScale - 1) * GROWTH_FRAME_FACTOR;
    const baseY = state.worldMode === 'endless' ? state.player.position.y : 0; // Above the head even on a hill
    foodArrow.visible = true;
    foodArrow.position.set(
        state.player.position.x,
        baseY + state.playerScale * 1.5 + (0.4 + 0.12 * Math.sin(clock * 3)) * frame,
        state.player.position.z
    );
    foodArrow.rotation.y = Math.atan2(arrowDelta.x, arrowDelta.z); // +Z tip → shortest path
    foodArrow.scale.setScalar(frame);
}

// All food pulses in sync via the ONE shared material — deliberate and cheap.
function updateFoodGlow() {
    const endless = state.worldMode === 'endless';
    COLLECTIBLE_MATERIAL.emissiveIntensity = 0.3 + 0.22 * Math.sin(clock * 3);
    for (const c of state.collectibles) {
        const phase = c.userData.phase ?? 0;
        // Endless: the bob rides the terrain under the cube (a fresh sample
        // each frame — food never moves in XZ, but rebases shift its local
        // coords, and groundHeightAt is origin-aware either way).
        const baseY = endless ? groundHeightAt(c.position.x, c.position.z) : 0;
        c.rotation.y = clock * 1.4 + phase;
        c.position.y = baseY + 0.45 + Math.sin(clock * 2.5 + phase) * 0.08;
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
            if (w.swing > 0.35) spawnFootstepDust(group, walkScratch.dx, walkScratch.dz, dist);
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

// Footstep dust: a tiny, soft puff kicked up BEHIND the character on each
// stride plant (trailing the direction of travel, so the body never occludes
// it — the verify pass caught center-spawned dust hiding inside the
// silhouette). Uses the ONE pooled burst engine. Dust, not smoke.
const dustOrigin = { x: 0, y: 0, z: 0 }; // Scratch — never allocated per step
function spawnFootstepDust(group, dx, dz, dist) {
    // Trail offset: opposite the movement heading, scaled to the character
    // so big stompers kick dust at their heels, not inside their block.
    const back = (dist > 0.0001) ? (0.62 * Math.max(group.scale.y, 0.5)) / dist : 0;
    // Endless: feet are at the group's terrain-grounded y (0 in classic).
    const baseY = state.worldMode === 'endless' ? group.position.y : 0;
    dustOrigin.x = group.position.x - dx * back;
    dustOrigin.y = baseY + 0.06; // Just above the ground-bounce plane
    dustOrigin.z = group.position.z - dz * back;
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

// --- Floating-origin rebase support (endless) ---
// Shifts every LIVE particle and score popup by (dx, dz) in one frame so
// the rebase is visually seamless. Parked particles stay parked; floors are
// terrain HEIGHTS (true-coordinate derived), which a rebase never changes.
export function shiftActiveParticles(dx, dz) {
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
        if (life[i] <= 0) continue;
        positions[i * 3] += dx;
        positions[i * 3 + 2] += dz;
        any = true;
    }
    if (any && posAttr) posAttr.needsUpdate = true;
    for (const p of popups) {
        if (p.life <= 0) continue;
        p.sprite.position.x += dx;
        p.sprite.position.z += dz;
    }
}

// Debug/test introspection (read-only) — wired into window.__game by main.js.
export function effectsInfo() {
    return { reducedMotion, activeParticles, poolSize: MAX_PARTICLES };
}
