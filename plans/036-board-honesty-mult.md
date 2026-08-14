# Plan 036: Board honesty — record the run's speed multiplier on every row

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. On
> any STOP condition, stop and report. When done, update the status row in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c1ffd13..HEAD -- src/hiscores.js src/ui.js src/game.js src/state.js tests/hiscores.spec.js`
> Plan 029 adds `asc` to the same rows and the same renderer — reconcile
> with its landed shape (the `✦ ` prefix); plan 031 reshapes
> `applySpeedMultiplier` adjacently. Unexplained mismatch = STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (additive row field; ranking untouched)
- **Depends on**: none hard (merge-adjacent to 029/031 — see drift check)
- **Category**: direction (July audit DT-3, catalog bonus #12)
- **Planned at**: commit `c1ffd13`, 2026-08-14

## Why this matters

The speed multiplier is simultaneously a difficulty dial, an accessibility
setting, and an unlabeled leaderboard multiplier (July audit DT-3): a 5×
run covers ~5× the distance per real minute, yet its board row is
indistinguishable from a 1× run's. The family board is the game's real
economy — the row should say how it was earned. This plan marks rows with
the run's highest multiplier; it deliberately does NOT change ranking
(whether 5× runs should rank separately is an owner call the marked data
will inform).

## Design (locked)

- Track a per-run high-water mark: `state.runMaxMult`, updated inside
  `applySpeedMultiplier` (which every multiplier change already routes
  through) as the max over LIVING seats' `seatMult`, reset to the current
  value in `setupNewGame`. The MOBILE device boost (1.75×) is a device
  class, not a chosen toy — excluded on purpose (documented in the field's
  comment).
- Rows gain `mult` only when it is > 1 (`entry.mult = state.runMaxMult`) —
  solo endless, daily, AND coop (`recordCoopScore` takes the same value:
  the team's fastest seat). Loaders are already permissive (verified —
  `Number.isFinite` filters on other keys only), so NO key version bump.
- Render: append ` · <mult>x` to the row text when `entry.mult` exists
  (after plan 029's `✦ ` prefix if present). Examples:
  `843u — 112 pts — 2026-08-14 · 5x` and `✦ 512u — 730 pts — 2026-08-15`.
- Ranking rules in `sortBoard`/`sortCoopBoard`: UNTOUCHED.

## Current state (verified excerpts, at `c1ffd13`)

- `applySpeedMultiplier` computes `seatMult` per seat and already excludes
  dead seats from the enemy mult (`src/game.js:1032-1046`); called on init,
  every collect, ramp changes, death, roster change, speed toys.
- `setupNewGame` per-run resets (`src/game.js:189-210`).
- `recordScore(score, mode, distance)` builds `{ score, date [, distance,
  seed] }` (`src/hiscores.js:111-127`); `recordCoopScore(p1, p2,
  maxDistance)` (`:38-54`); loaders filter permissively (`:29-35, 86-101`)
  — extra fields round-trip.
- Renderer rows: `src/ui.js:440-451` (three text branches: coop
  `teamScore`, endless `distance`, classic `score`).
- Callers of the recorders: `endGame` only (`src/ui.js:566-579`).
- `tests/hiscores.spec.js` seeds and asserts row text (`:72` also pins the
  GAME OVER title) — extend, don't break.

## Repo conventions

Additive storage fields, no version bump when loaders tolerate them
(established by `seed` on daily rows and plan 029's `asc`); ranking changes
are owner decisions; specs via `debug.advance`; suite runs alone.

## Commands

Every shell first: `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"`
Lint `npm run lint` → 0 · targeted `npx playwright test
tests/hiscores.spec.js tests/coop.spec.js` → pass · full `npm test` → all
pass.

## Scope

**In scope:** `src/state.js` (one field), `src/game.js`
(`applySpeedMultiplier` high-water + `setupNewGame` reset),
`src/hiscores.js` (two recorder signatures), `src/ui.js` (`endGame` passes
the value; `renderHiscores` suffix), `tests/hiscores.spec.js`,
`tests/coop.spec.js` (one assertion), `readme.md` (one sentence),
`plans/README.md`.

**Out of scope:** ranking rules, per-multiplier boards, the HUD, mobile
boost accounting, any retro-marking of existing rows (old rows simply have
no suffix).

## Steps

1. **Field + high-water.** `state.js`: `runMaxMult: 1, // Highest chosen
   speed multiplier any living seat used this run — recorded on board rows
   (plan 036); device (mobile) boost excluded by design`. `game.js`
   `applySpeedMultiplier`: inside the per-player loop, after `seatMult` is
   known and the living-seat exclusion has passed, `if (seatMult >
   state.runMaxMult) state.runMaxMult = seatMult;`. `setupNewGame`: reset
   `state.runMaxMult` to the CURRENT max living `seatMult` right after the
   `applySpeedMultiplier()` call at `game.js:208` (a run started at 2× is a
   2× run from second zero).
   **Verify**: `npm run lint` → 0.
2. **Record.** `hiscores.js`: `recordScore(score, mode, distance, asc,
   mult = 1)` → `if (mult > 1) entry.mult = mult;` (position the new param
   AFTER 029's `asc` if landed, else as the 4th — match the live
   signature); `recordCoopScore(p1, p2, maxDistance, ascCount, mult = 1)`
   likewise. `ui.js` `endGame`: pass `state.runMaxMult` at every recorder
   call site (solo, daily re-record, coop).
   **Verify**: `npx playwright test tests/hiscores.spec.js` → pass
   (existing rows unaffected).
3. **Render.** `renderHiscores`: compute `const multSuffix = entry.mult > 1
   ? \` · ${entry.mult}x\` : '';` and append to all three branches.
   **Verify**: `npx playwright test tests/hiscores.spec.js` → pass.
4. **Specs.** hiscores.spec: (a) run a death at 2× (set
   `players[0].speedMultiplierIndex` via the debug cycle, advance to
   death) → the highlighted row text matches `/· 2x$/`; (b) an untouched
   run's row has NO `· ` suffix; (c) a seeded legacy row (no `mult`)
   renders unchanged. coop.spec: one assertion that a team row records the
   faster seat's mult.
   **Verify**: targeted specs pass; then `npm test` → all pass.
5. **Docs.** readme "Die" bullet gains: rows note the speed multiplier the
   run used (`· 2x`) so family bests compare honestly. `plans/README.md`
   row.

## Done criteria

- [ ] `npm test` exits 0 (baseline + ≥4 new assertions)
- [ ] A 5× death's row ends `· 5x`; a 1× row has no suffix; legacy rows
      render unchanged
- [ ] `sortBoard`/`sortCoopBoard` diffs are EMPTY (`git diff src/hiscores.js`
      shows no sort changes)
- [ ] `plans/README.md` row 036 updated

## STOP conditions

- Any existing hiscores assertion fails on row TEXT you did not intend to
  change — the suffix leaked onto mult-1 rows; stop.
- The live recorder signatures differ from both shapes anticipated in
  Step 2 (029 landed differently) — stop and report the actual signature.

## Maintenance notes

- If the owner later wants multiplier-aware RANKING (or separate 5×
  ladders), the data is already on the rows — that future plan changes
  `sortBoard` only.
- Plan 031's per-target enemy pace does not alter `seatMult` semantics;
  the high-water reads the same values either way.
