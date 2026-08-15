// Local storage owner (plan 009 + endless mode). The ONLY module (besides
// src/audio.js) allowed to touch localStorage. Every storage access is
// wrapped in try/catch — Safari private mode, blocked storage, or corrupt
// JSON must degrade to "nothing persists", never to a crash.
// Keys are versioned: any future schema change (names, per-mode boards)
// bumps to .v2 with a migration read of .v1.

import {
    dailySeed, WORLD_SEED,
    SKIN_UNLOCK_DISTANCE_1, SKIN_UNLOCK_DISTANCE_2, SKIN_UNLOCK_SCORE
} from './constants.js';

const KEY = 'blocky.hiscores.v1'; // Classic board — untouched by endless runs
const KEY_ENDLESS = 'blocky.hiscores.endless.v1'; // Endless board — its own ladder
const KEY_DAILY = 'blocky.hiscores.daily.v1'; // TODAY'S WORLD board — seed-stamped rows; stale worlds prune on read
const KEY_COOP = 'blocky.hiscores.coop.v1'; // 2P team board (plan 026) — its own ladder; 2P runs record ONLY here
const MAX = 5;

// --- Coop (2P) board (plan 026) ---
// Entry: { p1Score, p2Score, teamScore, maxDistance, date } ranked by
// teamScore (a TEAM run is the two of them together), maxDistance breaking
// ties. Separate shape and key — coop never mixes with the solo ladders.
function sortCoopBoard(list) {
    list.sort((a, b) => (b.teamScore ?? 0) - (a.teamScore ?? 0) || (b.maxDistance ?? 0) - (a.maxDistance ?? 0));
    return list;
}

export function loadCoopScores() {
    try {
        const raw = localStorage.getItem(KEY_COOP);
        const arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) return [];
        const list = arr.filter((e) => Number.isFinite(e.teamScore));
        for (const e of list) {
            e.maxDistance = Number.isFinite(e.maxDistance) ? Math.floor(e.maxDistance) : 0;
        }
        return sortCoopBoard(list);
    } catch { return []; /* private mode / corrupt JSON / disabled storage */ }
}

export function recordCoopScore(p1Score, p2Score, maxDistance, ascCount = 0) {
    const list = loadCoopScores();
    const entry = {
        p1Score,
        p2Score,
        teamScore: p1Score + p2Score,
        maxDistance: Math.max(0, Math.floor(maxDistance)),
        date: new Date().toISOString().slice(0, 10)
    };
    // Ascension mark (plan 029): additive optional field — loaders filter on
    // teamScore only, so old rows and old readers are untouched. No key bump.
    if (ascCount > 0) entry.ascCount = ascCount;
    list.push(entry);
    sortCoopBoard(list);
    const trimmed = list.slice(0, MAX);
    const rank = trimmed.indexOf(entry);
    try { localStorage.setItem(KEY_COOP, JSON.stringify(trimmed)); }
    catch { /* storage may be unavailable; still return the in-memory result */ }
    return { list: trimmed, rank };
}

function keyForMode(mode) {
    if (mode === 'daily') return KEY_DAILY;
    return mode === 'endless' ? KEY_ENDLESS : KEY;
}

// Per-mode ranking (QA-flagged, coordinator-approved): the ENDLESS board
// ranks by DISTANCE — the mode's real currency — with score breaking ties
// (and still shown per row, ui.js). Classic stays score-ranked, untouched.
// Sorting on READ migrates any board stored under the old score ordering;
// the entry shape is unchanged (distance was always stored), so the key
// stays v1 — no bump, no migration read.
function sortBoard(list, mode) {
    if (mode === 'endless' || mode === 'daily') {
        // The daily ladder IS an endless ladder — same currency (distance),
        // just scoped to one day's world.
        list.sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0) || b.score - a.score);
    } else {
        list.sort((a, b) => b.score - a.score);
    }
    return list;
}

// Default mode is ENDLESS — the live product board (audit D-5). A caller
// that forgets to pass the mode must hit the board players actually see;
// the classic key + sort branch stay only because real scores exist there.
export function loadHiscores(mode = 'endless') {
    try {
        const raw = localStorage.getItem(keyForMode(mode));
        const arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) return [];
        let list = arr.filter(e => Number.isFinite(e.score));
        if (mode === 'daily') {
            // Stale worlds evaporate (plan 025): only rows stamped with
            // TODAY'S seed rank or render — yesterday's board was a
            // different map, so comparing distances would be a lie. The
            // pruned list persists at the next write (recordScore).
            const today = dailySeed();
            list = list.filter(e => e.seed === today);
        }
        if (mode === 'endless' || mode === 'daily') {
            // Defensive normalize: every distance-ranked row renders (and
            // ranks by) its distance — a malformed one reads as 0, never NaN.
            for (const e of list) {
                e.distance = Number.isFinite(e.distance) ? Math.floor(e.distance) : 0;
            }
        }
        return sortBoard(list, mode);
    } catch { return []; /* private mode / corrupt JSON / disabled storage */ }
}

// Returns { list, rank } — rank is the 0-based position of the new entry
// in the trimmed top-5 list, or -1 if it didn't place. Each mode has its
// own board AND its own ladder rule (sortBoard): a monster endless run must
// not bury the classic ladder, and endless NEW BEST means furthest, not
// richest.
export function recordScore(score, mode = 'endless', distance = 0, asc = false) {
    const list = loadHiscores(mode);
    const entry = { score, date: new Date().toISOString().slice(0, 10) };
    if (mode === 'endless' || mode === 'daily') entry.distance = Math.max(0, Math.floor(distance));
    // Ascension mark (plan 029): additive optional field, ranking untouched.
    if (asc) entry.asc = true;
    // Daily rows carry the world they were RUN ON (the resolved seed), not
    // the clock at death time: a run finishing just past midnight stamps
    // yesterday's world and the read-side prune correctly retires it from
    // the new day's board.
    if (mode === 'daily') entry.seed = WORLD_SEED;
    list.push(entry);
    sortBoard(list, mode);
    const trimmed = list.slice(0, MAX);
    const rank = trimmed.indexOf(entry);
    try { localStorage.setItem(keyForMode(mode), JSON.stringify(trimmed)); }
    catch { /* storage may be unavailable; still return the in-memory result */ }
    return { list: trimmed, rank };
}

// --- Hero skins (plan 035) ---
// Selection persists under one key; UNLOCKS are DERIVED live from the solo
// board rows (endless + daily — the boards this household actually plays),
// so there is no unlock storage to corrupt or migrate.
const KEY_SKIN = 'blocky.skin.v1';

export function loadSelectedSkin() {
    try {
        const id = localStorage.getItem(KEY_SKIN);
        return typeof id === 'string' && id.length > 0 && id.length < 32 ? id : null;
    } catch { return null; /* private mode — default skin */ }
}

export function saveSelectedSkin(id) {
    try { localStorage.setItem(KEY_SKIN, id); }
    catch { /* storage unavailable — the pick still applies this session */ }
}

// Ordered unlocked skin ids (always starts with ember). Order matches
// characters.js SKIN_PALETTES so the cycle button walks it stably.
export function computeUnlockedSkins() {
    const rows = [...loadHiscores('endless'), ...loadHiscores('daily')];
    let bestDistance = 0;
    let bestScore = 0;
    let anyAscended = false;
    for (const r of rows) {
        if (Number.isFinite(r.distance) && r.distance > bestDistance) bestDistance = r.distance;
        if (Number.isFinite(r.score) && r.score > bestScore) bestScore = r.score;
        if (r.asc === true) anyAscended = true;
    }
    const unlocked = ['ember'];
    if (bestDistance >= SKIN_UNLOCK_DISTANCE_1) unlocked.push('lime');
    if (bestDistance >= SKIN_UNLOCK_DISTANCE_2) unlocked.push('midnight');
    if (bestScore >= SKIN_UNLOCK_SCORE) unlocked.push('gold');
    if (anyAscended) unlocked.push('celestial');
    return unlocked;
}

// --- Ghost runs (plan 034) ---
// One stored ghost per seed: { v: 1, seed, distance, score, date, interval,
// asc, points: [x0,z0,s0, x1,z1,s1, ...] } (TRUE coordinates, quantized).
// Best DISTANCE wins; ties keep the incumbent. This module owns the
// localStorage I/O (the storage-owner law) — ghost.js owns the machinery.
function ghostKey(seed) {
    return `blocky.ghost.${seed}.v1`;
}

export function loadGhost(seed) {
    try {
        const raw = localStorage.getItem(ghostKey(seed));
        if (!raw) return null;
        const g = JSON.parse(raw);
        if (!g || g.v !== 1 || !Number.isFinite(g.distance) ||
            !Number.isFinite(g.interval) || g.interval <= 0 ||
            !Array.isArray(g.points) || g.points.length % 3 !== 0 ||
            g.points.length < 6 || !g.points.every(Number.isFinite)) {
            return null; // Tampered/corrupt ghost: no replay, never a crash
        }
        return g;
    } catch { return null; /* private mode / corrupt JSON / disabled storage */ }
}

// Persists only when strictly BETTER (distance); returns whether it saved.
export function saveGhost(seed, ghost) {
    const incumbent = loadGhost(seed);
    if (incumbent && incumbent.distance >= ghost.distance) return false;
    try {
        localStorage.setItem(ghostKey(seed), JSON.stringify(ghost));
        return true;
    } catch { return false; /* storage unavailable — the run still counted */ }
}

// --- World-mode preference ---
// Product is endless-only: load always returns endless. The old saveWorldMode
// 'blocky.worldMode' write is deleted (audit D-5) — nothing ever read it back
// (this function ignores storage entirely), so it only planted a stale key.
export function loadWorldMode() {
    return 'endless';
}
