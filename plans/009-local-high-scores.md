# Plan 009: Local high scores on the death screen

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: plan 008 must be DONE per `plans/README.md`
> (`#hiscore-slot` must exist in `index.html`). If it doesn't, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/008-start-and-death-screens.md
- **Category**: direction (feature)
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

Both the maintainers' `todo.md` ("Track and display personal high scores (local storage)... Display leaderboard on game-over screen") and their saved advisory notes (`grok_tips.md` §6) ask for this. For a father/son game the local top-5 IS the multiplayer: beating each other's scores on the same device. It also gives every death a reason to replay.

## Current state

- `#hiscore-slot` is an empty div inside `#message-box` (created by plan 008).
- `endGame(reason)` → `showDeathScreen(reason)` renders `#final-score` from `state.score` (plan 008).
- Score lives in `state.score`, set on food collect (`game.js:807-808` originally; post-plans in `src/game.js` collect path) and (after plan 011) on kills.
- No storage layer exists anywhere in the codebase. No third-party dependencies beyond three.
- Test hook `window.__game.state` exists (plan 002).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |

## Scope

**In scope**: `src/hiscores.js` (create), `src/ui.js` (render into `#hiscore-slot`), `src/game.js` (record on `endGame`), `style.css` (list styling), `tests/hiscores.spec.js` (create).

**Out of scope**: usernames/initials entry (todo lists a "Username System" — deliberately deferred; scores are anonymous rows), server/global leaderboards, any change to scoring values (plan 011).

## Git workflow

- Branch: `improve/009-local-high-scores`
- Commit style: `Feat: ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Storage module

Create `src/hiscores.js`:

```js
const KEY = 'blocky.hiscores.v1';
const MAX = 5;

export function loadHiscores() {
    try {
        const raw = localStorage.getItem(KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter(e => Number.isFinite(e.score)) : [];
    } catch { return []; }   // private mode / corrupt JSON / disabled storage
}

export function recordScore(score) {
    // returns { list, rank } — rank is 0-based position of the new entry, or -1 if it didn't place
    const list = loadHiscores();
    const entry = { score, date: new Date().toISOString().slice(0, 10) };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const trimmed = list.slice(0, MAX);
    const rank = trimmed.indexOf(entry);
    try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch { /* storage may be unavailable; still return in-memory result */ }
    return { list: trimmed, rank };
}
```

Every storage touch is wrapped — Safari private mode and blocked storage must degrade to "scores just don't persist", never to a crash.

### Step 2: Record + render on death

- In `endGame` (post-004 single path): `const { list, rank } = recordScore(state.score);` then pass both to the death-screen renderer.
- In `src/ui.js`, render into `#hiscore-slot`:
  ```html
  <p class="hiscore-title">BEST RUNS</p>
  <ol class="hiscore-list">
      <li class="is-new">120 — 2026-07-25</li>
      ...
  </ol>
  ```
  The new run's row (by `rank`) gets class `is-new`; if `rank === 0` also show a `NEW BEST!` badge line above the list. If the list is empty (storage unavailable AND first run failed to record) hide the slot.
- `style.css`: `.hiscore-list` compact (0.6em font — Press Start 2P is wide), `.is-new` in the bright yellow already used by `#collect-timer-display` (#FFEB3B), `NEW BEST!` in orange-red (#FF4500). Match the existing palette; introduce no new colors.

**Verify (manual)**: die twice with different scores → both listed, newest highlighted, order descending; reload page → list persists.

## Test plan

Create `tests/hiscores.spec.js` (pattern: smoke spec + `startGame` helper from plan 008):

1. **Records and ranks**: seed via `page.addInitScript(() => localStorage.setItem('blocky.hiscores.v1', JSON.stringify([{score: 50, date: '2026-01-01'}])))`; play to death with score 0 (idle run); assert list shows 50 then 0, and the `0` row has `.is-new`.
2. **NEW BEST badge**: seed empty storage; idle-death (score 0 places rank 0); assert badge visible. (Score 0 being "best" is fine for the test's purpose.)
3. **Top-5 trim**: seed 5 entries scored 10..50; idle-death; `page.evaluate(() => JSON.parse(localStorage.getItem('blocky.hiscores.v1')).length)` → 5, and 0 did not displace 10 unless it tied-sorted below (assert the stored MIN is 10).
4. **Storage-poisoned resilience**: seed `localStorage.setItem('blocky.hiscores.v1', '{corrupt')`; play to death → no page error (the `pageerror` trap in the shared beforeEach covers this), death screen renders.

**Verify**: `npm test` → all pass.

## Done criteria

- [ ] `grep -rn "localStorage" src/` → only inside `src/hiscores.js`
- [ ] `npm run lint` / `npm test` exit 0 (incl. hiscores.spec.js)
- [ ] Manual: scores persist across reload; corrupt storage does not break the game
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plan 008 not DONE / `#hiscore-slot` missing.
- You feel the need to prompt for a player name — that is explicitly deferred scope; report if the death-screen layout can't work without it.

## Maintenance notes

- Key is versioned (`.v1`); any future schema change (names, per-mode boards) bumps to `.v2` with a migration read of `.v1`.
- Plan 011 changes score magnitudes (kill points); no change needed here, but reviewers should sanity-check the list still lays out with 4-digit scores.
- If a future settings screen adds "clear scores", it belongs in `src/hiscores.js` as `clearHiscores()`.
