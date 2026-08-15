import * as THREE from 'three';
import {
    ASCENSION_SCALE, ASCENSION_FORESHADOW_SCALE, ASCENSION_BONUS,
    ASCENSION_RISE_HEIGHT, ASCENSION_LIFT_TIME, ASCENSION_RISE_TIME,
    ASCENSION_BURST_TIME, CONTINUOUS_MOVEMENT
} from './constants.js';
import { state } from './state.js';
import { spawnBurst, spawnRing, spawnTextPopup } from './effects.js';
import { groundHeightAt, applyWorldBend } from './terrain.js';
import { clearPendingSpawns } from './enemies.js';
import { sfx } from './audio.js';

// --- Ascension (plan 029, audit DT-7/DT-8) ---
// Growth's destination: at ASCENSION_SCALE the hero has outgrown the world
// and ascends — a scripted ceremony (beam of light, golden rings, a spinning
// rise into the cloud band, a shrink-to-star burst) that ends that hero's
// run as a WIN. This module owns the ceremony state machine and its meshes;
// game.js is the ONLY importer (other modules read the player.ascension
// FIELD, never this module — keeps the import graph from growing cycles).
// The ceremony ticks on the game clock inside update(), so pause freezes it
// for free, and per-player state means it composes with 2P (one hero
// ascends while the partner plays on).

// GOLD palette: distinct from food lime, kill yellow, and titan crown use —
// pale gold reads "holy", not "edible".
const ASCEND_GOLD = 0xFFD54F;
const ASCEND_WHITE = 0xFFF8E1;

// Shared GPU resources (pool law): ONE halo geometry + material and ONE
// beam geometry + material, two meshes each (one per seat), built ONCE in
// initAscensionFx and parked with visible = false — the foodArrows pattern
// (effects.js). Beams are SCENE children, never mesh children: the
// shrink-to-star scales the hero group, and a parented beam would shrink
// with it. Positions are re-copied from the hero every frame, which also
// makes floating-origin rebases automatic.
const HALO_GEO = new THREE.TorusGeometry(0.55, 0.09, 8, 24);
const BEAM_GEO = new THREE.CylinderGeometry(1.4, 1.8, 1, 16, 1, true);
let haloMaterial = null;
let beamMaterial = null;
const halos = [null, null];
const beams = [null, null];
const foreshadowShown = [false, false]; // One THE SKY AWAITS... per seat per run
let reducedMotion = false;
let fxClock = 0; // Local pulse clock (game dt) — halo bob/spin phase

const BEAM_HEIGHT = ASCENSION_RISE_HEIGHT + 4;
const CEREMONY_TOTAL = ASCENSION_LIFT_TIME + ASCENSION_RISE_TIME + ASCENSION_BURST_TIME;

// Scratch origins — never allocated per beat (house no-alloc law).
const fxOrigin = { x: 0, y: 0, z: 0 };
const settledScratch = []; // updateAscension's per-frame result — reused

export function initAscensionFx() {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (haloMaterial) return; // Idempotent — resources live for the app's lifetime
    haloMaterial = new THREE.MeshBasicMaterial({
        color: ASCEND_GOLD,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
    });
    applyWorldBend(haloMaterial);
    beamMaterial = new THREE.MeshBasicMaterial({
        color: ASCEND_WHITE,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    applyWorldBend(beamMaterial);
    for (let seat = 0; seat < 2; seat++) {
        const halo = new THREE.Mesh(HALO_GEO, haloMaterial);
        halo.rotation.x = Math.PI / 2; // Flat ring hovering over the head
        halo.visible = false;
        state.scene.add(halo);
        halos[seat] = halo;
        const beam = new THREE.Mesh(BEAM_GEO, beamMaterial);
        beam.visible = false;
        state.scene.add(beam);
        beams[seat] = beam;
    }
}

// New run: park everything and re-arm the foreshadow (setupNewGame).
export function resetAscension() {
    for (const p of state.players) {
        p.ascension = null;
        p.ascended = false;
    }
    foreshadowShown[0] = false;
    foreshadowShown[1] = false;
    for (const halo of halos) {
        if (halo) halo.visible = false;
    }
    for (const beam of beams) {
        if (beam) beam.visible = false;
    }
}

// Shared trigger guards: ascension is an ENDLESS-mode feature (classic is
// the retired test arena) and never fires under the movement spike.
function ascensionEligible(player) {
    return state.worldMode === 'endless' && !CONTINUOUS_MOVEMENT &&
        player.alive && player.mesh && !player.ascension && !player.ascended;
}

// Crossing the foreshadow scale attaches the halo and warns the crown is
// near — called from the collect handler with the pre-growth scale.
export function maybeForeshadow(player, prevScale) {
    if (!ascensionEligible(player) || foreshadowShown[player.seat]) return;
    if (player.scale < ASCENSION_FORESHADOW_SCALE || prevScale >= ASCENSION_FORESHADOW_SCALE) return;
    foreshadowShown[player.seat] = true;
    const halo = halos[player.seat];
    if (halo) halo.visible = true;
    const p = player.mesh.position;
    fxOrigin.x = p.x;
    fxOrigin.y = p.y + player.scale + 0.6; // Above the head (milestone pattern)
    fxOrigin.z = p.z;
    spawnTextPopup(fxOrigin, 'THE SKY AWAITS...', '#FFD54F', player);
    sfx.milestone();
}

// The trigger: called from the collect handler after growth applied.
export function maybeBeginAscension(player) {
    if (!ascensionEligible(player) || player.scale < ASCENSION_SCALE) return;
    const p = player.mesh.position;
    player.ascension = {
        phase: 'lift',
        t: 0,
        baseY: groundHeightAt(p.x, p.z),
        rise: 0,
        spin: 0,
        trailClock: 0
    };
    // The ceremony owns this hero's presentation from here: no residual
    // squash/pulse, no lingering dread on their channel.
    player.squashTime = 0;
    player.pulseTime = 0;
    player.dangerOpacity = 0;
    player.dangerPeak = 0;
    // The world stands down for the LAST active hero: no monster may
    // materialize through the holy beat (2P partners keep their warns —
    // their fight is still on).
    let othersActive = 0;
    for (const q of state.players) {
        if (q !== player && q.alive && !q.ascension) othersActive++;
    }
    if (othersActive === 0) clearPendingSpawns();
    // Beat 1: the ring, the banner, the biggest jingle in the game.
    const beam = beams[player.seat];
    if (beam) {
        beam.visible = true;
        beam.scale.set(0.01, BEAM_HEIGHT, 0.01); // Scales in over the lift
        beam.position.set(p.x, player.ascension.baseY + BEAM_HEIGHT / 2, p.z);
    }
    const halo = halos[player.seat];
    if (halo) halo.visible = true; // A sub-9 debug trigger still gets its halo
    fxOrigin.x = p.x;
    fxOrigin.y = player.ascension.baseY + 0.1;
    fxOrigin.z = p.z;
    spawnRing(fxOrigin, {
        count: 34,
        radius: 0.8 * player.scale,
        speed: 6 + player.scale * 0.4,
        colorFrom: ASCEND_WHITE,
        colorTo: ASCEND_GOLD,
        life: 0.7
    });
    fxOrigin.y = p.y + player.scale + 0.6;
    spawnTextPopup(fxOrigin, 'ASCENSION!', '#FFD54F', player);
    sfx.ascend();
}

// Per-frame ceremony tick (game.js update(), behind the pause gate).
// Returns the players whose ceremony COMPLETED this frame — game.js owns
// the settle (score bonus, spectator/endGame routing) so this module never
// imports ui.js.
export function updateAscension(dt) {
    fxClock += dt;
    settledScratch.length = 0;
    for (const player of state.players) {
        // Foreshadow halo follow (no ceremony yet): hover over the head.
        const halo = halos[player.seat];
        if (halo && halo.visible && !player.ascension && player.mesh && player.alive) {
            const hp = player.mesh.position;
            halo.position.set(
                hp.x,
                hp.y + player.scale + 0.75 + 0.1 * Math.sin(fxClock * 2),
                hp.z
            );
            halo.rotation.z = fxClock * 0.8;
            halo.scale.setScalar(0.9 * player.scale);
        }
        const a = player.ascension;
        if (!a || !player.mesh) continue;
        a.t += dt;
        const mesh = player.mesh;
        const liftEnd = ASCENSION_LIFT_TIME;
        const riseEnd = ASCENSION_LIFT_TIME + ASCENSION_RISE_TIME;
        // --- Phase + rise curve ---
        if (a.t < liftEnd) {
            a.phase = 'lift';
            const k = a.t / ASCENSION_LIFT_TIME;
            a.rise = ASCENSION_RISE_HEIGHT * 0.15 * k * k; // Slow first inches
            a.spin += dt * 0.8;
            const beam = beams[player.seat];
            if (beam) {
                // Beam scales in over the first 20% of the lift.
                const g = Math.min(1, a.t / (ASCENSION_LIFT_TIME * 0.2));
                beam.scale.set(g, BEAM_HEIGHT, g);
            }
        } else if (a.t < riseEnd) {
            a.phase = 'rise';
            const k = (a.t - liftEnd) / ASCENSION_RISE_TIME;
            a.rise = ASCENSION_RISE_HEIGHT * (0.15 + 0.85 * k * k); // Ease-in climb
            a.spin += dt * (0.8 + 1.7 * k);
            // Gold sparkle trail every 0.25s of the climb (pooled bursts).
            a.trailClock += dt;
            if (a.trailClock >= 0.25) {
                a.trailClock -= 0.25;
                fxOrigin.x = mesh.position.x;
                fxOrigin.y = mesh.position.y + player.scale * mesh.scale.y * 0.5;
                fxOrigin.z = mesh.position.z;
                spawnBurst(fxOrigin, {
                    count: 10,
                    colorFrom: ASCEND_WHITE,
                    colorTo: ASCEND_GOLD,
                    speed: 2.2,
                    upBias: 0.4,
                    life: 0.6,
                    gravity: 1.5
                });
            }
        } else {
            a.phase = 'burst';
            a.rise = ASCENSION_RISE_HEIGHT;
            a.spin += dt * 2.5;
            // Shrink into a star: render scale eases toward a point. Avoids
            // shared-material opacity entirely (the hero's materials are
            // cached/shared — characters.js).
            const k = Math.min(1, (a.t - riseEnd) / ASCENSION_BURST_TIME);
            const shrink = 1 - 0.95 * k * k;
            mesh.scale.set(player.scale * shrink, player.scale * shrink, player.scale * shrink);
        }
        // --- Presentation writes (every ceremony frame) ---
        mesh.position.y = a.baseY + a.rise;
        mesh.rotation.y = a.spin;
        const beam = beams[player.seat];
        if (beam) {
            beam.position.set(mesh.position.x, a.baseY + BEAM_HEIGHT / 2, mesh.position.z);
        }
        if (halo && halo.visible) {
            halo.position.set(
                mesh.position.x,
                mesh.position.y + player.scale * mesh.scale.y + 0.75,
                mesh.position.z
            );
            halo.rotation.z = fxClock * 0.8;
            halo.scale.setScalar(Math.max(0.15, 0.9 * player.scale * mesh.scale.y));
        }
        // --- Completion ---
        if (a.t >= CEREMONY_TOTAL) {
            // The starburst: ONE bloom (photosensitivity: a single flash,
            // nowhere near the 3/sec limit), then the hero is light.
            fxOrigin.x = mesh.position.x;
            fxOrigin.y = mesh.position.y + 0.4;
            fxOrigin.z = mesh.position.z;
            spawnBurst(fxOrigin, {
                count: 72,
                colorFrom: 0xFFFFFF,
                colorTo: ASCEND_GOLD,
                speed: 7,
                upBias: 3,
                life: 1.1,
                gravity: 3
            });
            spawnTextPopup(fxOrigin, `+${ASCENSION_BONUS} ASCENDED!`, '#FFD54F', player);
            sfx.ascendBurst();
            if (beam) beam.visible = false;
            if (halo) halo.visible = false;
            mesh.visible = false;
            mesh.rotation.y = 0;
            // Restore the render scale (invisible) so nothing downstream —
            // or the next run's setup — inherits a star-sized hero.
            mesh.scale.set(player.scale, player.scale, player.scale);
            player.ascension = null;
            player.ascended = true;
            settledScratch.push(player);
        }
    }
    return settledScratch;
}

// True while this player's ceremony wants the camera lift (world.js reads
// the FIELD player.ascension directly; this helper is for game.js/tests).
export function isAscending(player) {
    return player.ascension !== null && player.ascension !== undefined;
}

// Debug/test introspection (main.js) — plain data only, never THREE objects.
export function ascensionInfo() {
    return {
        seats: state.players.map((p) => ({
            seat: p.seat,
            active: !!p.ascension,
            phase: p.ascension ? p.ascension.phase : null,
            rise: p.ascension ? p.ascension.rise : 0,
            ascended: p.ascended,
            foreshadowShown: foreshadowShown[p.seat] === true,
            haloVisible: !!(halos[p.seat] && halos[p.seat].visible),
            reducedMotion
        }))
    };
}
