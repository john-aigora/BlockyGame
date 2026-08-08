# Plan 019: Fairness pass — honest hitboxes, truthful arrows, no phantom inputs

> **Executor instructions**: Step-by-step with verification; STOP conditions are
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 128d18e..HEAD -- src/enemies.js src/ui.js src/game.js src/input.js src/timers.js tests/`
> On mismatch with excerpts, STOP.

## Status

- **Priority**: P1 · **Effort**: M · **Risk**: MED (difficulty shifts slightly — that is the point)
- **Depends on**: 017
- **Category**: bug
- **Planned at**: commit `128d18e`, 2026-07-31

## Why this matters

Six verified bugs make the game unfair in ways players feel: deaths register on
visibly empty space, threat arrows point the wrong way, a same-frame race makes
the HUD disagree with the family leaderboard, keys latch when the window loses
focus, touch+keyboard stacks to 2× speed, and a collider mismatch lets players
walk through boulders. The repo's own design law (`src/constants.js:118-122`):
"if it looks like it fits, it fits." Full evidence: findings C-1..C-6 in
`plans/audit-2026-07-31.md`.

## Current state (excerpts)

- **C-2 hitbox** — `src/enemies.js:216` `playerBox.setFromObject(state.player);`
  and `:350` `scratchBox.setFromObject(enemyGroup);` — unions EVERY child mesh:
  outline shell ×1.06 (`src/characters.js:169-171`), enemy tail to −0.87×base
  (`:286-290`), hero scarf to z≈−0.91 (`:342-359`); collect squash scales the
  box for 0.3s (`src/effects.js:598`). Jump keeps its flatten rule:
  `src/enemies.js:218-220` stretches `playerBox.min.y` down by `jumpOffset`.
  Width constants already exist: `PLAYER_COLLIDER_HALF_WIDTH = 0.54`,
  `ENEMY_COLLIDER_HALF_WIDTH = 0.6` (`src/constants.js:127-128`).
- **C-3 arrows** — `src/ui.js:489-493`: `enemyPos.project(state.camera)` with no
  behind-camera check; negative-w projection mirrors. Enemies ≳30u "south" (+Z)
  of the player are behind the camera plane routinely.
- **C-1 race** — `src/game.js:262` `tickCollectClock(dt)` may call `endGame`;
  `updateEnemies(dt)` at `:280` still runs that frame; `killEnemy`
  (`src/enemies.js:401-410`) then adds score and schedules spawns on a dead run.
- **C-4 blur** — no `blur`/`pagehide` handler exists (grep-verified);
  `onKeyUp` (`src/input.js:533-538`) is the only key-clear.
- **C-5 stacking** — `src/input.js:434-441` clamps keys+stick to unit;
  `src/game.js:297-303` ADDS the touch vector (`state.movementVector`) on top.
- **C-6 jump grace** — `src/game.js:313`:
  `const ignoreRocks = state.jumpAirborne || !isRockFree(p.x, p.z, radius);`
  — a radius-inflated circle test, while movement probes are four radius-0
  points (`src/terrain.js:601-612`); disagreement band ≈ rocks off while
  actually clear.

## Commands

`export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` ·
`npm test` (0 failed) · `npx playwright test tests/<spec> --workers=1` · `npm run lint`

## Scope

**In scope**: `src/enemies.js`, `src/ui.js`, `src/game.js`, `src/input.js`,
`src/constants.js` (new derived consts only), `src/terrain.js` (Step 6's
`isRockWedged` helper ONLY), `tests/fairness.spec.js`, `tests/toys.spec.js`
(re-run/re-baseline), new `tests/hitbox.spec.js`.
**Out of scope**: enemy AI/balance values; species work (plan 024); terrain
generation/streaming beyond the Step 6 helper.
*(Scope corrected post-landing by the B3 review — Step 6 always required the
terrain helper; the original out-of-scope line contradicted it.)*

## Git workflow

Run branch; `[<branch> · Batch N/M] <verb> <what>`; NEVER push.

## Steps

### Step 1 (C-1): Dead-run guard

In `update()` (`src/game.js`), immediately after `tickCollectClock(dt)`:
`if (!state.gameActive) return;` and guard `updateSpawnWarnings(dt)` similarly.
Add to `setupNewGame` nothing — warn discs already clear there.
**Verify**: new test — force `collectTimeLeft=0.01` with a killable enemy
overlapping the player next frame; assert recorded board score === HUD score
(pattern: seed via `addInitScript`, read `#final-score` vs stored entry).
`npx playwright test tests/hitbox.spec.js --workers=1` → passes (put the test in
the new file; name it `same-frame death records what the HUD shows`).

### Step 2 (C-2): Honest hitboxes

Replace both `setFromObject` calls with explicit boxes:
- Player: `playerBox.setFromCenterAndSize(center, size)` where center =
  player position raised by half-height, size =
  `(2·0.54·playerScale, playerScale·1.0, 2·0.54·playerScale)` — body height base
  is 1.0 (`src/enemies.js:59` comment). PRESERVE the jump rule: after building,
  `if (state.jumpOffset > 0) playerBox.min.y -= state.jumpOffset;`.
- Enemy: size `(2·0.6·scale.y, 1.2·scale.y, 2·0.6·scale.y)` centered on the
  group position raised by half its body height (`enemyBaseHeight = 1.2`,
  `src/constants.js:3`).
Add a comment on each: `// Gameplay collides the BODY BLOCK, not the render tree`
`// (tails/scarves/outlines are decoration) — audit C-2.`
Do NOT include the collect-squash scale — that is the fix (visual squash no
longer pulses the hitbox).
**Verify**: `npx playwright test tests/toys.spec.js tests/fairness.spec.js tests/balance.spec.js tests/endless-stream.spec.js --workers=1` → all pass
(these exercise real collisions). New `tests/hitbox.spec.js` cases:
(a) an enemy placed so only its TAIL region overlaps the player does not kill;
(b) contact at body-to-body distance does. Compute positions from the constants.

### Step 3 (C-3): Truthful arrows

In `updateOffscreenIndicators` (`src/ui.js`): compute the enemy position in
VIEW space first (`scratch.copy(pos).applyMatrix4(camera.matrixWorldInverse)`);
if `scratch.z > -camera.near` (behind), derive the screen direction from the
view-space vector directly (`atan2(-scratch.x, -scratch.y)` mapped to edge
coordinates — i.e. negate the mirrored projection) instead of the raw
`project()` output. On-screen check stays as is for in-front enemies.
**Verify**: new test in `tests/fairness.spec.js`: `forceWorldMode` not needed —
place an enemy at `player + (0, 0, +60)` via `debug.spawnNewEnemies` relocation
(`state.enemies[0].position.set(...)`), render one frame, read that indicator's
`style.left/top` and assert it clamps to the BOTTOM edge of the canvas rect
(the enemy is south), not the top. Model DOM reads on the existing indicator
assertions in the suite.

### Step 4 (C-4): Clear inputs on blur

In `src/game.js` listener setup: `window.addEventListener('blur', clearTransientInput)`
and call it from the existing `visibilitychange` hidden branch too. Implement
`clearTransientInput()` in `src/input.js` (export): zero every `keys[...]`,
`state.touchActive = false`, `state.movementVector.set(0, 0)` (check the real
shape — it is a 2D vector `{x,y}` per `src/game.js:301-302`).
**Verify**: test in `tests/fairness.spec.js`: hold ArrowUp via
`page.keyboard.down`, `page.evaluate(() => window.dispatchEvent(new Event('blur')))`,
then `waitGameSeconds(0.5)` and assert the player's z-position is unchanged
(±0.01) after the blur.

### Step 5 (C-5): One clamp for all sources

Create `moveVector()` in `src/input.js` that sums keyboard+stick (existing
`keyboardVector`) AND the touch vector, then clamps once to unit length; both
movement branches in `src/game.js` consume it and DELETE the separate
`state.touchActive` addition block.
**Verify**: test: drive touch drag full-right (via `debug.touchHandlers`
fabricated events — see `tests/touch.spec.js` for the pattern) while holding
ArrowRight; sample x-travel over 1 game-second; assert ≤ `actualPlayerSpeed × 1.05`.

### Step 6 (C-6): Probe-parity rock grace

Replace the `!isRockFree(p.x, p.z, radius)` term with a check that the four
movement probe points themselves are rock-blocked at radius 0 — add
`isRockWedged(x, z, radius)` in `src/terrain.js` that evaluates
`blockedByRock` at the same four sample offsets `canMove` uses (center, ±radius
on each axis) and returns true only if ANY probe is blocked. Grace becomes
`state.jumpAirborne || isRockWedged(p.x, p.z, radius)`.
**Verify**: `npx playwright test tests/toys.spec.js --workers=1` → rock-hop and
water tests still pass. Add a case: place the player at a probe-clear but
center-inside-inflated-ring offset from a rock (compute from collider math:
rock r + 0.54·1.0 < d < rock r + 0.54 + 0.1) and assert `canMove` into the rock
is STILL blocked (no walk-through).

## Test plan

New file `tests/hitbox.spec.js` (Steps 1–2, ~4 tests) + 3 additions to
`tests/fairness.spec.js` (Steps 3–5) + 1 to `tests/toys.spec.js` (Step 6).
Pattern after existing specs; game-clock waits only. Full suite green.

## Done criteria

- [ ] `npm test` → 0 failed (incl. ~8 new tests)
- [ ] `grep -n "setFromObject" src/enemies.js` → no matches
- [ ] `grep -n "blur" src/game.js src/input.js` → listener + clear present
- [ ] `plans/README.md` updated

## STOP conditions

- Step 2 makes >2 unrelated specs fail after re-baseline attempts — the
  difficulty shift is larger than expected; report the failing assertions.
- Step 3's edge mapping still mis-points in the south test after one rework.
- Any fix requires touching enemy AI steering values.

## Maintenance notes

- The hitbox change slightly SHRINKS effective contact — kills and deaths both
  need marginally truer aim. Family playtest note: if kills feel "slippery",
  widen `ENEMY_COLLIDER_HALF_WIDTH` a touch rather than reverting to bboxes.
- Plan 026 reuses `clearTransientInput` on seat switches and the explicit box
  builder for per-player collision — keep both exported.
