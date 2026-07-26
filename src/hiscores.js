// Local storage owner (plan 009 + endless mode). The ONLY module (besides
// src/audio.js) allowed to touch localStorage — the world-mode preference
// lives here for that reason. Every storage access is wrapped in try/catch —
// Safari private mode, blocked storage, or corrupt JSON must degrade to
// "nothing persists", never to a crash.
// Keys are versioned: any future schema change (names, per-mode boards)
// bumps to .v2 with a migration read of .v1.

const KEY = 'blocky.hiscores.v1'; // Classic board — untouched by endless runs
const KEY_ENDLESS = 'blocky.hiscores.endless.v1'; // Endless board — its own ladder
const MODE_KEY = 'blocky.worldMode';
const MAX = 5;

function keyForMode(mode) {
    return mode === 'endless' ? KEY_ENDLESS : KEY;
}

export function loadHiscores(mode = 'classic') {
    try {
        const raw = localStorage.getItem(keyForMode(mode));
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter(e => Number.isFinite(e.score)) : [];
    } catch { return []; /* private mode / corrupt JSON / disabled storage */ }
}

// Returns { list, rank } — rank is the 0-based position of the new entry
// in the trimmed top-5 list, or -1 if it didn't place. Each mode has its
// own board: a monster endless run must not bury the classic ladder.
// Endless entries carry the run's furthest distance (shown per row); the
// board stays SCORE-ranked — distance is the story, score is the ladder.
export function recordScore(score, mode = 'classic', distance = 0) {
    const list = loadHiscores(mode);
    const entry = { score, date: new Date().toISOString().slice(0, 10) };
    if (mode === 'endless') entry.distance = Math.max(0, Math.floor(distance));
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const trimmed = list.slice(0, MAX);
    const rank = trimmed.indexOf(entry);
    try { localStorage.setItem(keyForMode(mode), JSON.stringify(trimmed)); }
    catch { /* storage may be unavailable; still return the in-memory result */ }
    return { list: trimmed, rank };
}

// --- World-mode preference (start-overlay picker) ---
// Anything unrecognized (or unavailable storage) falls back to classic.
export function loadWorldMode() {
    try { return localStorage.getItem(MODE_KEY) === 'endless' ? 'endless' : 'classic'; }
    catch { return 'classic'; }
}

export function saveWorldMode(mode) {
    try { localStorage.setItem(MODE_KEY, mode); }
    catch { /* preference just doesn't persist */ }
}
