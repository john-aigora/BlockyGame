# Plan 031: 2P fairness — per-target enemy pace, honest indicator geometry, and coverage for the per-seat speed feature

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c1ffd13..HEAD -- src/game.js src/enemies.js src/input.js src/world.js src/state.js tests/coop.spec.js tests/gamepad.spec.js tests/helpers.js`
> On any drift, compare the excerpts below against live code; mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (changes a 2P balance rule and a shared layout cache; solo must stay byte-stable)
- **Depends on**: none (land BEFORE plan 033, which touches `applySpeedMultiplier` adjacently)
- **Category**: bug
- **Planned at**: commit `c1ffd13`, 2026-08-14

## Why this matters

Two real defects shipped with the per-player speed feature (PR #5), plus its
test coverage is thin exactly where it historically breaks:

1. **One seat's speed toy makes enemies uncatchable for the other seat.**
   `applySpeedMultiplier` feeds enemies the MAX of the living seats'
   multipliers. With P1 on 5× and P2 on 1×, grunts move at `1.5 × 5 = 7.5 u/s`
   (sprinters `16.5`) while P2 tops out at `6 u/s` — P2 cannot escape a pack
   they never sped up. This contradicts the repo's oldest enemy-pace law
   (`RAMP_SPEED_MAX` comment: "always outrunnable") even though the max rule
   itself is comment-documented. The fix that honors BOTH intents: each
   enemy paces off the seat of the player it is CURRENTLY hunting.
2. **Every 1P↔2P layout flip leaves the off-screen-arrow geometry stale.**
   The `coop-wide` class flip (800→1600 px) never dispatches a window
   `resize`, and `state.gameCanvasRect` is updated ONLY by the window resize
   listener — so 2P runs place every arrow (seam, clamps, bearings) with
   solo-width numbers until the user happens to resize the window. Two
   independent audit passes found this; it also lets us delete a per-frame
   forced layout read in the 2P render path.
3. **Commit 58e3262's actual behavior ("recompute on death and roster
   drop") has zero test coverage**, and no spec ever presses pad Y/X — the
   per-seat routing that is the feature's real interface.

## Current state (verified excerpts, at `c1ffd13`)

### The max-of-living rule — `src/game.js:1028-1075`

```js
// game.js:1032-1046 (inside applySpeedMultiplier)
    let enemyMult = 0;
    let foundEnemySeat = false;
    for (const p of state.players) {
        const idx = Number.isInteger(p.speedMultiplierIndex) ? p.speedMultiplierIndex : 0;
        const safeIdx = ((idx % speedMultipliers.length) + speedMultipliers.length) % speedMultipliers.length;
        if (safeIdx !== p.speedMultiplierIndex) p.speedMultiplierIndex = safeIdx;
        const seatMult = speedMultipliers[safeIdx];
        const sizeFactor = Math.min(1 + (p.scale - 1) * SPEED_GROWTH_FACTOR, SPEED_GROWTH_CAP);
        p.actualSpeed = baseSpeedForDevice * seatMult * sizeFactor;
        if (state.players.length >= 2 && state.gameActive && !p.alive) continue;
        if (!foundEnemySeat || seatMult > enemyMult) enemyMult = seatMult;
        foundEnemySeat = true;
    }
    ...
    state.actualEnemySpeed = BASE_ENEMY_SPEED
        * (state.isMobile ? MOBILE_SPEED_MULTIPLIER : 1)
        * enemyMult;
    if (state.worldMode === 'endless') {
        state.actualEnemySpeed *= Math.min(1 + state.endlessRampLevel * RAMP_SPEED_STEP, RAMP_SPEED_MAX);
    }
```

### The single consumer that must become per-target — `src/enemies.js:504-512`

```js
// enemies.js:505-512 — target resolved per enemy; speciesSpeed derives from
// the GLOBAL actualEnemySpeed
        const target = nearestLivingPlayer(enemyGroup.position);
        if (!target) return;
        ...
        const speciesSpeed = state.actualEnemySpeed * ud.species.speedFactor;
```

Random drift (`enemies.js:517`) and separation (`enemies.js:559`) read
`state.actualEnemySpeed` DELIBERATELY (plan 024: only the four species-speed
sites thread the factor) — leave both on the global.

### The stale rect — `src/input.js:972-979` (sole writer) and `src/world.js:222-243`

```js
// input.js:972-979 (inside setupTouchControls)
        const updateGameCanvasBounds = () => { // Renamed for clarity
            const rect = state.gameContainer.getBoundingClientRect();
            state.gameCanvasRect = rect; // Store the whole rect
            state.gameCanvasCenterX = rect.left + rect.width / 2;
            state.gameCanvasCenterY = rect.top + rect.height / 2;
        };
        updateGameCanvasBounds(); // Initial calculation
        window.addEventListener('resize', updateGameCanvasBounds); // Update on window resize
```

```js
// world.js:229-243 — the class flip that changes width WITHOUT a resize event,
// called directly from game.js:304 (setupNewGame), :327 (startRun), :843 (setPlayerCount)
    const wide = state.players.length >= 2 && !state.onStartScreen;
    state.gameContainer.classList.toggle('coop-wide', wide);
    document.body.classList.toggle('coop-wide', wide);
    const newWidth = state.gameContainer.clientWidth;
    const newHeight = state.gameContainer.clientHeight;
    ...
    state.renderer.setSize(newWidth, newHeight);
```

Readers of the cached rect: `src/ui.js:949-1033` (indicator seam `halfW`,
per-half rects, clamps, bearings — all from `state.gameCanvasRect`).

### The per-frame layout read to delete with the same touch — `src/world.js:393-394`

```js
// world.js:393-394 (renderFrame, split path — every 2P frame)
    const w = state.gameContainer.clientWidth;
    const h = state.gameContainer.clientHeight;
```

### Coverage gaps (verified against the spec files)

- `tests/coop.spec.js:236-238` — `setPlayerCount(1)` asserts only HUD
  visibility; no enemy-pace or speed-label assertion.
- `tests/coop.spec.js:241+` — the spectator test kills P2 and never asserts
  the enemy pace dropped.
- No spec anywhere presses pad buttons 2 (X) or 3 (Y) — grep `setButton`
  across `tests/`: only 0, 1, 8, 9, 12. The per-seat dispatch lives at
  `src/input.js:566-575` (`seatForPadIndex` → `speedUpSeats.push(seat)`).
- `tests/coop.spec.js:437,454-456` re-hardcode `6 *` / `1.5 *` instead of
  importing `BASE_PLAYER_SPEED` / `BASE_ENEMY_SPEED` from
  `../src/constants.js` (the pattern `tests/fairness.spec.js:3` uses).
- `coop-wide` exit path untested: entry transitions are pinned
  (`tests/coop.spec.js:358-395`), the restart→overlay narrow-back is not.
- The mock-pad harness to reuse: `tests/gamepad.spec.js` (`installMockPads`,
  `pressEdge` around line 251) — extract `pressEdge` into `tests/helpers.js`
  rather than copying.

## Repo conventions that bind this plan

- **Solo byte-stable**: every change here must be inert with
  `players.length === 1`. `state.actualEnemySpeed` keeps its exact solo
  semantics; the per-seat pace is an ADDITIVE array consulted only in coop.
- Specs are DOM-level or `__game`-level; time via `debug.advance`.
- Balance knobs live in constants.js — this plan adds none (the per-target
  rule reuses existing knobs).
- Never run two Playwright suites at once.

## Commands you will need

Every shell first: `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"`

| Purpose | Command | Expected |
|---|---|---|
| Lint | `npm run lint` | exit 0 |
| Coop+gamepad specs | `npx playwright test tests/coop.spec.js tests/gamepad.spec.js` | pass |
| Full suite | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope:** `src/game.js` (applySpeedMultiplier only), `src/enemies.js`
(the `speciesSpeed` line only), `src/state.js` (one new field),
`src/world.js` (`onWindowResize` + `renderFrame` reads), `src/input.js`
(delete the now-redundant bounds updater + listener), `tests/coop.spec.js`,
`tests/gamepad.spec.js` (extract helper), `tests/helpers.js`,
`plans/README.md`.

**Out of scope:** the warn-time scaling (`scheduleEnemySpawn` — fastest
living hero rule stays), random-drift/separation globals, HUD label format,
`applySpeedMultiplier`'s HUD block, everything else in the listed files.

## Git workflow

Branch `fix/031-coop-fairness` off `main`; commit per step; do NOT push
unless instructed.

## Steps

### Step 1: Per-seat enemy pace (additive)

`src/state.js`: add to the `state` object (near `actualEnemySpeed`):
`enemyPaceForSeat: [undefined, undefined], // Coop: per-seat enemy pace — an enemy runs at its TARGET's seat pace (plan 031); solo never reads this`.

`src/game.js` `applySpeedMultiplier`: inside the existing per-player loop,
after `p.actualSpeed = ...`, add
`state.enemyPaceForSeat[p.seat] = BASE_ENEMY_SPEED * (state.isMobile ? MOBILE_SPEED_MULTIPLIER : 1) * seatMult;`
and after the ramp block, apply the same ramp factor to both array slots
(compute `const rampFactor = Math.min(1 + state.endlessRampLevel * RAMP_SPEED_STEP, RAMP_SPEED_MAX)`
once, use it for both `state.actualEnemySpeed` and the array; classic mode
leaves the array at the unramped values, mirroring today's branch). Leave
the existing `enemyMult`/max computation and `state.actualEnemySpeed`
EXACTLY as they are (solo byte-stability + any legacy reader).

`src/enemies.js:512`: replace the one line with:

```js
        const paceBase = state.players.length >= 2 && state.enemyPaceForSeat[target.seat] !== undefined
            ? state.enemyPaceForSeat[target.seat]
            : state.actualEnemySpeed;
        const speciesSpeed = paceBase * ud.species.speedFactor;
```

(Comment it: per-target pace — a hunter runs at the pace its OWN target's
speed toy sets, so no seat's toy can make another seat's hunters
unoutrunnable; solo reads the classic global. Plan 031, audit C-15.)

**Verify**: `npm run lint` → 0; `npx playwright test tests/species.spec.js
tests/balance.spec.js` → pass (solo pace untouched).

### Step 2: Re-pin the coop pace assertions to the new rule

`tests/coop.spec.js`: import `{ BASE_PLAYER_SPEED, BASE_ENEMY_SPEED,
speedMultipliers }` from `../src/constants.js`; replace the hardcoded `6 *`
/ `1.5 *` at lines ~437/454-456 and index literals with derived values
(`speedMultipliers.indexOf(5)` etc.). Update the existing "enemy mult"
assertions to the per-target rule: with P1 on 5× and P2 on 1×, assert
`state.enemyPaceForSeat[1] === BASE_ENEMY_SPEED * 1 * rampFactor` and
`state.enemyPaceForSeat[0] === BASE_ENEMY_SPEED * 5 * rampFactor` (read the
ramp factor from `state.endlessRampLevel` at assert time; at run start it is
0 → factor 1). Add a KINEMATIC assertion modeled on the species spec: spawn
a grunt near P2 (far from P1) via `debug.spawnSpecies`, `debug.advance(2)`,
and assert its displacement is ≤ `BASE_ENEMY_SPEED * 1.25 * 2 + tolerance`
(the 1× pace bound), NOT the 5× bound.

**Verify**: `npx playwright test tests/coop.spec.js` → pass.

### Step 3: Cover death + roster-drop recompute (T-12)

In the existing spectator test (P2 dies, run continues): before killing P2,
set `players[1].speedMultiplierIndex = speedMultipliers.indexOf(5)` and
`debug.applySpeedMultiplier()`; after P2's death assert
`state.actualEnemySpeed` equals the seat-0-only value (the max rule now has
one living seat) AND `enemyPaceForSeat[0]` is seat 0's pace. In the
back-to-solo test (~line 236): set P2 to 5× first, then `setPlayerCount(1)`
and assert the speed button text matches `/^Speed: [\d.]+x$/` (solo form)
and `state.actualEnemySpeed` is back to the solo value.

**Verify**: `npx playwright test tests/coop.spec.js` → pass.

### Step 4: Drive pad Y/X per seat (T-13)

Extract `pressEdge` (and any small mock helpers it needs) from
`tests/gamepad.spec.js` into `tests/helpers.js` (export; update
gamepad.spec.js imports — behavior identical). New coop.spec.js test:
install two mock pads, claim seats (wiggle each), edge button 3 (Y) on the
pad claiming seat 1 → assert `players[1].speedMultiplierIndex` advanced and
`players[0].speedMultiplierIndex` unchanged; mirror with button 2 (X).

**Verify**: `npx playwright test tests/gamepad.spec.js tests/coop.spec.js`
→ pass.

### Step 5: Single-owner canvas geometry (C-16/D-14) + kill the per-frame layout read (P-13)

1. `src/world.js` `onWindowResize`: after `state.renderer.setSize(newWidth,
   newHeight)`, add the bounds write (this makes onWindowResize the single
   owner of canvas geometry — every caller, including the class flip,
   refreshes it):

```js
    // Canvas geometry cache (plan 031): the coop-wide class flip changes
    // the container size WITHOUT a window resize event, so the indicator
    // rect must refresh here — the one function every layout change calls.
    const rect = state.gameContainer.getBoundingClientRect();
    state.gameCanvasRect = rect;
    state.gameCanvasCenterX = rect.left + rect.width / 2;
    state.gameCanvasCenterY = rect.top + rect.height / 2;
```

2. `src/input.js:972-979`: delete `updateGameCanvasBounds`, its initial
   call, and its resize listener (game.js already binds `window resize` →
   `onWindowResize` at `game.js:91`, which now does this work). Confirm
   nothing else in input.js referenced the function.
3. `src/world.js` `renderFrame` split path (393-394): replace the two
   `clientWidth/clientHeight` reads with the cached values:
   `const w = state.gameCanvasRect.width; const h = state.gameCanvasRect.height;`
   (the cache is refreshed by every path that can change them). Leave the
   `scissorActive` restore branch (388) as-is — it runs once per mode
   change, not per frame.
4. New coop.spec.js assertions: after `startTwoPlayerGame`, assert
   `state.gameCanvasRect.width === document.getElementById('game-container').clientWidth`
   (catches the stale cache); after clicking `#restart-game-button` and the
   overlay returning, assert the container does NOT have class `coop-wide`
   and the rect narrowed to match (covers T-16's exit path).

**Verify**: `npx playwright test tests/coop.spec.js tests/touch.spec.js`
→ pass (touch drag math reads the same rect — must stay correct in solo).

### Step 6: Full gate

`npm test` → ALL pass. `npm run build` → 0.

## Test plan (summary)

All in `tests/coop.spec.js` (+ helper extraction): per-target pace pinned
arithmetically AND kinematically; death-recompute; roster-drop recompute;
pad Y/X per-seat routing; canvas-rect truth on entry and exit of coop-wide.
Solo regression = the whole untouched baseline.

## Done criteria (ALL must hold)

- [ ] `npm test` exits 0 (baseline + new cases)
- [ ] `grep -n "getGamepads\|clientWidth" src/world.js` shows NO
      clientWidth read inside the split-frame path of `renderFrame`
- [ ] `grep -c "updateGameCanvasBounds" src/input.js` → 0
- [ ] `grep -n "enemyPaceForSeat" src/enemies.js` → exactly the one
      paceBase site
- [ ] `tests/coop.spec.js` imports constants from `../src/constants.js`
      (no hardcoded 6/1.5 speed literals: `grep -nE "= 6 \*|1\.5 \*" tests/coop.spec.js` → 0)
- [ ] `plans/README.md` row 031 updated

## STOP conditions

- Any SOLO spec fails after Step 1 — the additive rule leaked into the solo
  path; stop.
- `tests/touch.spec.js` fails after Step 5 — the rect ownership move broke
  the touch-drag origin math; stop and report (do not hack offsets).
- The kinematic assertion is flaky across two runs — tolerance is wrong or
  the enemy's random drift dominates at 1×; report with the measured
  displacements instead of loosening the bound past the 5×-pace value.
- You find `applySpeedMultiplier` already restructured (plan 033 landed
  first) — reconcile with its state before editing; if unclear, stop.

## Maintenance notes

- Plan 033 breaks the `ui.js → game.js` recompute cycle around this same
  function — land THIS plan first; 033's dirty-flag consume must recompute
  the pace array too (it calls the same function, so it does).
- If a third seat ever exists, `enemyPaceForSeat` sizes with the roster —
  it is indexed by seat, and `makePlayerState` is the construction path.
- Reviewer: check the classic-mode branch of the array fill (unramped), and
  that the deleted input.js listener didn't also serve another purpose
  (it did not — verified single-purpose at planning time).
