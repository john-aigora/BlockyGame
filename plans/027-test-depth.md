# Plan 027: Test depth — time control, scoring/pause/warn coverage, wall-clock retirement

> **Executor instructions**: Step-by-step; verify each. STOP conditions binding.
> Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 128d18e..HEAD -- src/main.js src/game.js tests/`
> Drift from plans 017-026 is EXPECTED — adjust to landed names; STOP only if a
> target subsystem is unrecognizable.

## Status

- **Priority**: P2 · **Effort**: M · **Risk**: MED (the time-stepper can desync
  the loop if rAF isn't paused)
- **Depends on**: 017; AFTER 026 (so new coop systems get covered too)
- **Category**: tests
- **Planned at**: commit `128d18e`, 2026-07-31

## Why this matters

Time-dependent behavior (combo expiry, warn pipeline, pause invariants,
milestones) is either untested or tested with 150-second wall ceilings, because
nothing can advance game time deterministically. 16 `waitForTimeout` calls
violate the suite's own game-clock law (`tests/helpers.js:62-64`,
`docs/elves/learnings.md:38`). Findings T-3..T-9 in `plans/audit-2026-07-31.md`.

## Current state

- `src/main.js:17-51` — debug handle; no time control. `src/game.js` — the rAF
  loop `animate()` with `MAX_DELTA = 0.05` clamp; `update(dt)` is the sim step.
- Wall-clock waits: `tests/effects.spec.js` (7 incl. `waitForTimeout(5000)` at
  `:94`), `tests/gameover.spec.js:21,38`, `tests/resources.spec.js:15,21,27`,
  `tests/touch.spec.js:26,63`, `tests/audio.spec.js:58,64` (these two are
  GENUINELY wall-clock — Web Audio time — keep with a comment).
- Coverage gaps (post-017 baseline): combo expiry at 4s + x5 cap; exact size
  bounty; SPAWN pattern exact order; pause freezing combo/music/spawn-cooldown;
  warn→materialize end-to-end incl. disc-pool stability; gamepad binds beyond
  the 3 covered (Start+Select restart, Select mute, LB/RB zoom, X/Y speed —
  extended by 018 but re-check the bind list); size-scaled jump ratios
  (apex/airtime formulas `src/game.js:418-425`); rumble call sites.

## Commands

`export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` · `npm test` ·
per-spec runs `--workers=1`.

## Scope

**In scope**: `src/main.js`, `src/game.js` (advance support only), all of
`tests/`. **Out of scope**: any gameplay change — if a test exposes a real bug,
STOP and report it as a finding instead of fixing game code here.

## Git workflow

Run branch; `[<branch> · Batch N/M] <verb> <what>`; NEVER push.

## Steps

### Step 1: `debug.advance(seconds)`

In `src/game.js` export `advanceGameTime(seconds)`: assert-paused pattern —
cancel the rAF (`state.animationFrameId`), then loop `update(1/60)`
`ceil(seconds*60)` times, then resume rAF. Expose as `debug.advance`. It must
go through the REAL `update` so timers/spawns/combos/effects all tick.
Guard: throw if called while `!state.gameActive` unless `{allowMenu:true}`.
**Verify**: scratch spec — `advance(4.5)` moves `state.runTime` by ~4.5 ±0.05
and a scheduled spawn materializes.

### Step 2: Scoring exactness

`tests/balance.spec.js`: (a) isolated kill with a FIXED enemy scale — assert
`score delta === 25 + 5*floor(1.2*scale.y)` exactly; (b) combo expiry —
kill, `advance(4.5)`, assert `comboCount === 0` and chip hidden; (c) x5 cap —
seed `comboCount=5, comboTimeLeft=4`, kill, assert stays 5 and payout
`bounty*5`. `tests/endless-stream.spec.js`: pin the full rotation order
prey→giant→peer→giant (post-024: the extended 8-slot pattern) by height-band
classification of 8 consecutive scheduled spawns.
**Verify**: those specs green.

### Step 3: Pause invariants

New cases in `tests/timing.spec.js`: pause freezes (a) `comboTimeLeft` (kill →
pause → wall-wait 1s → resume → barely moved), (b) music (`musicActive()`
false while paused, true after), (c) endless spawn cooldown (pause 5s → resume
→ no burst: enemy count unchanged next frame, and ≤1 new spawn within the next
`ENDLESS_SPAWN_INTERVAL`).
**Verify**: timing spec green.

### Step 4: Warn pipeline end-to-end

New `tests/spawnwarn.spec.js`: (a) schedule → warn disc visible, zero enemies
during the window, exactly one after; (b) disc pool: 10 spawn cycles →
`renderer.info.memory.geometries` unchanged after warm-up; (c) death mid-warn →
disc cleared on the death frame (plan 019's guard); (d) speed-scaled warn time
(plan 024) sanity at 5×.
**Verify**: new spec green.

### Step 5: Jump scaling + rumble + binds sweep

(a) jump: at scale 1 vs 3, sample max `jumpOffset` — ratio matches
`(1.55 + 0.75*(3-1)) / 1.55` ±5%; gravity locked mid-air (mutate scale
mid-jump, assert `state.jump.gravity` unchanged — post-026 field name).
(b) rumble: mock pad with a spy `vibrationActuator`; assert `playEffect` fires
on kill and death, never while muted-irrelevant (rumble ignores mute — assert
current behavior, whatever it is, with a comment).
(c) binds: assert every documented bind in `src/input.js:19-20`'s comment has a
spec (write the missing ones — post-018 most exist; fill gaps).
**Verify**: gamepad + new cases green.

### Step 6: Wall-clock retirement

Convert the non-audio `waitForTimeout` sites to `waitGameSeconds`/
`advance`/condition waits (each conversion keeps the original intent — read the
surrounding comment first). Annotate the two audio waits as intentionally
wall-clock. Add an eslint rule for `tests/`: restrict
`page.waitForTimeout` via `no-restricted-syntax` with message "use
waitGameSeconds/advance (game clock ≠ wall clock)" — allow via eslint-disable
comment at the two audio sites.
**Verify**: `npm run lint` 0; `npm test` 0 failed ×2 (this step is the flake
crucible — run the full suite a third time if either run wobbles).

## Test plan

This plan IS tests. Net-new: ~15 cases + 1 new spec file + the lint rule.

## Done criteria

- [ ] `npm test` 0 failed ×2 · lint 0
- [ ] `debug.advance` exists and is used by ≥5 specs
- [ ] `grep -rn "waitForTimeout" tests/ | grep -v audio.spec` → only
      eslint-disabled or zero matches
- [ ] `plans/README.md` updated

## STOP conditions

- Step 1's stepper leaves rAF double-running (frame counter jumps) after one
  fix attempt.
- Any new exact assertion FAILS against live code — that is a real bug: report
  as a finding (with values), do not adjust game code.
- A conversion in Step 6 exposes a race that two focused attempts don't settle
  — leave that site with a TODO comment + report.

## Maintenance notes

- `advance` must never ship to players beyond the debug handle (same policy as
  the rest of `__game`).
- Future specs default to `advance` over wall waits; CI (017) now enforces the
  suite on every push.
