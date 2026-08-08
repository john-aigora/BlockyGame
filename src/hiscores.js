// Local storage owner (plan 009 + endless mode). The ONLY module (besides
// src/audio.js) allowed to touch localStorage. Every storage access is
// wrapped in try/catch — Safari private mode, blocked storage, or corrupt
// JSON must degrade to "nothing persists", never to a crash.
// Keys are versioned: any future schema change (names, per-mode boards)
// bumps to .v2 with a migration read of .v1.

const KEY = 'blocky.hiscores.v1'; // Classic board — untouched by endless runs
const KEY_ENDLESS = 'blocky.hiscores.endless.v1'; // Endless board — its own ladder
const MAX = 5;

function keyForMode(mode) {
    return mode === 'endless' ? KEY_ENDLESS : KEY;
}

// Per-mode ranking (QA-flagged, coordinator-approved): the ENDLESS board
// ranks by DISTANCE — the mode's real currency — with score breaking ties
// (and still shown per row, ui.js). Classic stays score-ranked, untouched.
// Sorting on READ migrates any board stored under the old score ordering;
// the entry shape is unchanged (distance was always stored), so the key
// stays v1 — no bump, no migration read.
function sortBoard(list, mode) {
    if (mode === 'endless') {
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
        const list = arr.filter(e => Number.isFinite(e.score));
        if (mode === 'endless') {
            // Defensive normalize: every endless row renders (and ranks by)
            // its distance — a malformed one reads as 0, never NaN.
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
export function recordScore(score, mode = 'endless', distance = 0) {
    const list = loadHiscores(mode);
    const entry = { score, date: new Date().toISOString().slice(0, 10) };
    if (mode === 'endless') entry.distance = Math.max(0, Math.floor(distance));
    list.push(entry);
    sortBoard(list, mode);
    const trimmed = list.slice(0, MAX);
    const rank = trimmed.indexOf(entry);
    try { localStorage.setItem(keyForMode(mode), JSON.stringify(trimmed)); }
    catch { /* storage may be unavailable; still return the in-memory result */ }
    return { list: trimmed, rank };
}

// --- World-mode preference ---
// Product is endless-only: load always returns endless. The old saveWorldMode
// 'blocky.worldMode' write is deleted (audit D-5) — nothing ever read it back
// (this function ignores storage entirely), so it only planted a stale key.
export function loadWorldMode() {
    return 'endless';
}
