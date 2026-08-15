import * as THREE from 'three';
import {
    GHOST_SAMPLE_INTERVAL, GHOST_MAX_SAMPLES, GHOST_OPACITY,
    WORLD_SEED, CONTINUOUS_MOVEMENT
} from './constants.js';
import { state } from './state.js';
import { createCharacter } from './characters.js';
import { groundHeightAt, applyWorldBend } from './terrain.js';
import { spawnTextPopup } from './effects.js';
import { loadGhost, saveGhost } from './hiscores.js';

// --- Ghost runs (plan 034) ---
// The world is deterministic per seed and the boards rank DISTANCE on it —
// but racing was asynchronous: you chased a number. The ghost replays the
// stored best run for the CURRENT seed as a translucent spectral hero, so
// a family member races DAD, visibly, on the exact terrain where he ran.
//
// Contracts: recording samples TRUE coordinates (position + worldOrigin) so
// floating-origin rebases need zero handling; storage I/O lives in
// hiscores.js (the storage owner); the ghost has ZERO gameplay surface
// (never in state.players/enemies, never collides, never targeted, no
// arrows, no dread); game.js is the only module importer (main.js reaches
// ghostInfo through game.js's re-export). Replay runs against state.runTime
// — the game clock — so pause freezes the race like everything else.

// `?ghost=0` hides the replay for a session (the URL-param precedent).
const GHOST_DISABLED = typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('ghost') === '0';

// Recording state (solo seat 0, endless, non-spike runs only).
let recInterval = GHOST_SAMPLE_INTERVAL;
let recClock = 0;
let recPoints = []; // Flat [trueX, trueZ, scale, ...] — compact JSON
let recFinalized = false;

// Replay state.
let ghostMesh = null; // Built ONCE, parked visible=false (foodArrows law)
let ghostMaterial = null;
let replay = null; // { points, interval, distance, asc, count } while racing
let replayDone = false;
let fadeLeft = 0;
const popupOrigin = { x: 0, y: 0, z: 0 }; // Scratch — never allocated per beat

function q(v) {
    return Math.round(v * 100) / 100; // Centimeter grid — plenty for a replay
}

function recordingEligible() {
    return state.gameActive && state.worldMode === 'endless' &&
        !CONTINUOUS_MOVEMENT && state.players.length === 1 &&
        state.players[0].alive && state.players[0].mesh;
}

// New run (setupNewGame): empty buffer, base cadence, fresh finalize latch.
export function resetGhostRecording() {
    recInterval = GHOST_SAMPLE_INTERVAL;
    recClock = 0;
    recPoints = [];
    recFinalized = false;
}

// Per-frame recorder (update(), behind the pause gate): cheap — one push
// every ~9 frames, interval-doubling at the cap so ten-minute runs still
// fit a few dozen KB with full path shape.
export function tickGhostRecording(dt) {
    if (!recordingEligible()) return;
    recClock += dt;
    if (recClock < recInterval) return;
    recClock -= recInterval;
    const p = state.players[0];
    recPoints.push(
        q(p.mesh.position.x + state.worldOrigin.x),
        q(p.mesh.position.z + state.worldOrigin.z),
        q(p.scale)
    );
    if (recPoints.length >= GHOST_MAX_SAMPLES * 3) {
        // Decimate: keep every SECOND sample, double the cadence.
        const kept = [];
        for (let i = 0; i < recPoints.length; i += 6) {
            kept.push(recPoints[i], recPoints[i + 1], recPoints[i + 2]);
        }
        recPoints = kept;
        recInterval *= 2;
    }
}

// Run over (game.js animate consumes ui.js's state.runEnded signal): keep
// the ghost only when it BEAT the stored one — saveGhost owns that rule.
export function finalizeGhostRecording() {
    if (recFinalized || recPoints.length < 6) return;
    recFinalized = true;
    saveGhost(WORLD_SEED, {
        v: 1,
        seed: WORLD_SEED,
        distance: Math.floor(state.furthestDistance),
        score: state.players[0].score,
        date: new Date().toISOString().slice(0, 10),
        interval: recInterval,
        asc: state.players[0].ascended === true,
        points: recPoints
    });
}

// Lazy one-time mesh: the hero rig re-skinned as pure spirit — every part
// wears ONE shared additive spectral material (no per-part identity: a
// ghost must read as a ghost, not as somebody's skin), no shadows, no blob.
function ensureGhostMesh() {
    if (ghostMesh) return;
    ghostMaterial = new THREE.MeshBasicMaterial({
        color: 0x80DEEA,
        transparent: true,
        opacity: GHOST_OPACITY,
        depthWrite: false
    });
    applyWorldBend(ghostMaterial);
    ghostMesh = createCharacter({ baseSize: 1, bodyColor: 0x80DEEA, faceColor: 0x222222 });
    ghostMesh.traverse((node) => {
        if (node.isMesh) {
            node.material = ghostMaterial;
            node.castShadow = false;
        }
    });
    if (ghostMesh.userData.shadowQuad) ghostMesh.userData.shadowQuad.visible = false;
    ghostMesh.visible = false;
    state.scene.add(ghostMesh);
}

// startRun hook: race the stored best when one exists for this seed.
export function startGhostReplay() {
    replay = null;
    replayDone = false;
    fadeLeft = 0;
    if (GHOST_DISABLED || state.players.length !== 1 ||
        state.worldMode !== 'endless' || CONTINUOUS_MOVEMENT) return;
    const g = loadGhost(WORLD_SEED);
    if (!g) return;
    ensureGhostMesh();
    ghostMaterial.opacity = GHOST_OPACITY;
    ghostMesh.visible = true;
    replay = { points: g.points, interval: g.interval, distance: g.distance, asc: g.asc === true, count: g.points.length / 3 };
}

// setupNewGame hook: the race ends with the run.
export function hideGhost() {
    replay = null;
    replayDone = false;
    fadeLeft = 0;
    if (ghostMesh) ghostMesh.visible = false;
}

// Per-frame replay (update(), behind the pause gate): interpolate the path
// against the run clock; local frame = true coords − worldOrigin, so a
// rebase mid-race is automatically correct.
export function updateGhostReplay(dt) {
    if (!replay || !ghostMesh) return;
    if (replayDone) {
        if (fadeLeft > 0) {
            fadeLeft -= dt;
            ghostMaterial.opacity = Math.max(0, GHOST_OPACITY * (fadeLeft / 1));
            if (fadeLeft <= 0) ghostMesh.visible = false;
        }
        return;
    }
    const t = state.runTime / replay.interval;
    const i = Math.floor(t);
    if (i >= replay.count - 1) {
        // The stored run ends HERE: mark the spot and fade the spirit out.
        replayDone = true;
        fadeLeft = 1;
        popupOrigin.x = ghostMesh.position.x;
        popupOrigin.y = ghostMesh.position.y + 1.6;
        popupOrigin.z = ghostMesh.position.z;
        spawnTextPopup(popupOrigin,
            replay.asc ? 'GHOST ASCENDED HERE' : `GHOST FELL HERE — ${replay.distance}u`,
            '#80DEEA', state.players[0]);
        return;
    }
    const k = t - i;
    const a = i * 3;
    const b = a + 3;
    const trueX = replay.points[a] + (replay.points[b] - replay.points[a]) * k;
    const trueZ = replay.points[a + 1] + (replay.points[b + 1] - replay.points[a + 1]) * k;
    const scale = replay.points[a + 2] + (replay.points[b + 2] - replay.points[a + 2]) * k;
    const x = trueX - state.worldOrigin.x;
    const z = trueZ - state.worldOrigin.z;
    ghostMesh.position.set(x, groundHeightAt(x, z), z);
    ghostMesh.scale.set(scale, scale, scale);
}

// Debug/test introspection — plain data only (main.js exposes it via
// game.js's re-export, keeping this module's importer count at one).
export function ghostInfo() {
    return {
        recording: recPoints.length / 3,
        interval: recInterval,
        replaying: !!replay && !replayDone,
        done: replayDone,
        disabled: GHOST_DISABLED,
        x: ghostMesh && ghostMesh.visible ? ghostMesh.position.x : null,
        z: ghostMesh && ghostMesh.visible ? ghostMesh.position.z : null
    };
}
