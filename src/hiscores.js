// Local high-score storage (plan 009). The ONLY module (besides
// src/audio.js) allowed to touch localStorage. Every storage access is
// wrapped in try/catch — Safari private mode, blocked storage, or corrupt
// JSON must degrade to "scores just don't persist", never to a crash.
// Key is versioned: any future schema change (names, per-mode boards)
// bumps to .v2 with a migration read of .v1.

const KEY = 'blocky.hiscores.v1';
const MAX = 5;

export function loadHiscores() {
    try {
        const raw = localStorage.getItem(KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter(e => Number.isFinite(e.score)) : [];
    } catch { return []; /* private mode / corrupt JSON / disabled storage */ }
}

// Returns { list, rank } — rank is the 0-based position of the new entry
// in the trimmed top-5 list, or -1 if it didn't place.
export function recordScore(score) {
    const list = loadHiscores();
    const entry = { score, date: new Date().toISOString().slice(0, 10) };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const trimmed = list.slice(0, MAX);
    const rank = trimmed.indexOf(entry);
    try { localStorage.setItem(KEY, JSON.stringify(trimmed)); }
    catch { /* storage may be unavailable; still return the in-memory result */ }
    return { list: trimmed, rank };
}
