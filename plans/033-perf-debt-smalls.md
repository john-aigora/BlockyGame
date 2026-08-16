# Plan 033: Small-fix bundle — 2P input allocations, audio scheduler clamp, camera anchor order, warn-ring clamp, knob extraction, cycle break, stale comments

> **Executor instructions**: Follow this plan step by step; every step is
> independent and individually verifiable — commit each one separately so a
> problem child can be reverted alone. On any STOP condition, stop and
> report. When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c1ffd13..HEAD -- src/input.js src/clouds.js src/ui.js src/audio.js src/game.js src/enemies.js src/terrain.js src/effects.js src/constants.js src/timers.js src/state.js`
> Plan 031 is EXPECTED to have touched game.js/enemies.js/ui.js/input.js —
> reconcile against its landed state; for everything else, a mismatch with
> the excerpts below = STOP.

## Status

- **Priority**: P3
- **Effort**: M (nine S-sized items)
- **Risk**: LOW-MED (each item is small; the risk is sloppiness across many files)
- **Depends on**: plans/031 (touches `applySpeedMultiplier` and input.js first)
- **Category**: perf / tech-debt / bug
- **Planned at**: commit `c1ffd13`, 2026-08-14

## Why this matters

Nine verified small defects: per-frame allocations and a cache bypass in the
2P input path (regressing a prior perf fix), a per-cloud closure that
survived its own fix plan, a hidden-element forced reflow on every coop
scoring event, a music scheduler that dumps its backlog after stalls (title
screen is a live trigger), a restart camera that anchors to the previous
run's terrain, a spawn warn ring that becomes a 60u+ underground polygon at
late-game scale, five gameplay knobs living outside the GAME BALANCE block,
a new import cycle through the entry module, and four comments that
actively lie about which code path owns a behavior.

## Current state (all excerpts verified by direct read at `c1ffd13`)

1. **[P-14] 2P pad-cache bypass + allocations** — `src/input.js:319-328`:
   `seatPadVector` calls `navigator.getGamepads()` directly, bypassing the
   plan-020 per-frame cache at `src/input.js:117-125` (`padPollCounter` /
   `activeGamepad()`); it runs once per seat per frame via `moveVector`.
   `src/input.js:513-518` (`pollGamepadSeats`): `speedUpSeats`,
   `speedDownSeats`, `jumpSeats` arrays allocated fresh every frame.
   `src/input.js:635-641` (`updatePadHud`): `mode`/`short`
   (`gp.id.split('(')`)/`live`/`text` strings rebuilt per frame before the
   change-detect at `:642`.
2. **[P-15] Cloud closure** — `src/clouds.js:198-201`: `const smooth01 =
   (t) => {…}` declared INSIDE `animateCloud` (per cloud per frame; ~20
   clouds solo, ~39 in 2P; runs on the title screen and through pause).
3. **[P-16] Hidden-element reflow** — `src/ui.js:825-848`
   (`updateScoreDisplay`): the solo branch (read `textContent`, write, `void
   el.score.offsetWidth`) runs unconditionally; in coop `#score-display` is
   `display:none` (`ui.js:145`) yet every P1 point still pays the forced
   reflow, then the per-seat loop runs too.
4. **[C-20] Music scheduler backlog** — `src/audio.js:238-245`:
   `while (nextStepTime < ctx.currentTime + LOOKAHEAD_S)` with no floor at
   `ctx.currentTime`; a throttled background tab on the START OVERLAY (music
   bed playing, auto-pause doesn't fire because `state.isPaused` is already
   true — `src/game.js:130-135`) replays every missed 16th at once on
   return. Companion (prior C-8): `togglePause`'s resume calls
   `music.start()` (`src/game.js:1015`) with no `unlockAudio()`/ctx-state
   guard, and `music.start` (`src/audio.js:248-249`) doesn't check
   `ctx.state`.
5. **[C-21] Restart camera anchor** — `src/game.js:212` calls
   `resetCameraZoom()` (which snapshots `player.camAnchorY =
   player.mesh.position.y`, `src/world.js:426`) BEFORE the heroes are
   repositioned (`:236-240`) and grounded on fresh terrain (`:262-271`) —
   so the attract camera opens drifting from the PREVIOUS run's terrain
   height, exactly what the "no lerp-in" comment promises not to do.
6. **[C-22] Unbounded warn ring** — `src/enemies.js:238`: `const r =
   SPAWN_WARN_RADIUS * Math.max(0.85, scaleFactor)` with `scaleFactor`
   unbounded; at playerScale 9 / ramp 6 a giant's disc is ~33 scale (a ~67u
   ring) pinned flat at ONE `groundHeightAt` sample across ±3.75u terrain —
   mostly underground/floating, covering the player's own position.
   Reachable BEFORE the plan-029 ascension cap.
7. **[C-23] Stray knobs** — `src/enemies.js:977` `const avoidRadius = 7;`
   `src/enemies.js:565` `const maxSpeed = speciesSpeed * 1.25;`
   `src/terrain.js:685` `if (h < WATER_LEVEL + 0.35) continue;` (rock
   shoreline clearance); `src/terrain.js:901` `const rr = c.r + 0.6;`
   (food-vs-rock clearance); `src/effects.js:774` `<= 8100) { // 90²` (food
   animation cull, hardcoding "fog far ≈ 86" which is only true at scale 1).
   The law: `src/constants.js:9` "GAME BALANCE (tune here, nowhere else)".
8. **[D-15] Import cycle through the entry module** — `src/ui.js:15`
   `import { applySpeedMultiplier } from './game.js';` (called at `ui.js:529`
   in `killPlayer`) while `game.js:28` imports 21 symbols from ui.js. New
   cycle since the July audit; the four grandfathered cycles are leaf-leaf.
9. **[D-17] Lying comments** — `src/timers.js:11-12` and `:81-82` say the
   per-seat HUD/chip split is "until Stage E" (Stage E landed; the code
   below both comments IS per-seat); `src/state.js:33` documents
   `heartbeatClock` as per-player ("THEIR next danger heartbeat") but only
   seat 0's is ever read (`src/ui.js:746-756` — one world heart by design);
   `src/constants.js:12` `MAX_ENEMIES = 8; // hard population cap` sits in
   GAME BALANCE but its only live read is the classic (test/debug-only)
   branch (`src/enemies.js:723-725`) — the shipped caps are
   `ENDLESS_ENEMY_CAP`/`_COOP`.

## Commands

Every shell first: `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"`

| Purpose | Command | Expected |
|---|---|---|
| Lint | `npm run lint` | exit 0 |
| Targeted specs | `npx playwright test tests/<file>` | pass |
| Full suite | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope:** `src/input.js`, `src/clouds.js`, `src/ui.js`, `src/audio.js`,
`src/game.js`, `src/enemies.js`, `src/terrain.js`, `src/effects.js`,
`src/constants.js`, `src/timers.js`, `src/state.js`, `plans/README.md`.
Tests: only if an assertion pins a changed literal (verify with the
targeted runs per step — none is expected to).

**Out of scope:** behavior changes beyond the ones specified (every
extraction keeps values byte-identical); `hiscores.js` consolidation
(deferred — do it when the next board lands); the `ui.js` tension-block
extraction to `tension.js` (recorded as the next debt slice, own plan);
renaming `MAX_ENEMIES` (annotate only — a rename risks test/plan references
for zero behavior gain).

## Git workflow

Branch `chore/033-smalls` off `main` (after 031 merges); ONE COMMIT PER
NUMBERED STEP below; do NOT push unless instructed.

## Steps

### Step 1 [P-15]: hoist `smooth01`

Move the function to module scope in `clouds.js` (next to the other
module-level helpers), delete the inner declaration.
**Verify**: `npx playwright test tests/toys.spec.js tests/worldfun.spec.js` → pass.

### Step 2 [P-14]: 2P input hygiene

1. Add a cached pad LIST beside the selection cache: `let cachedPadList =
   null; let padListCounter = -1;` and `function padList() { if
   (padListCounter !== padPollCounter) { padListCounter = padPollCounter;
   cachedPadList = navigator.getGamepads ? navigator.getGamepads() : null; }
   return cachedPadList; }`. Use it in `seatPadVector` (`:326`) AND in
   `scanActiveGamepad`/`pollGamepadSeats`'s own list reads so the whole
   frame shares one snapshot. CAUTION: `tests/gamepad.spec.js` mocks
   `navigator.getGamepads` with per-call arrays whose pad objects mutate in
   place — a per-frame (counter-keyed) refresh preserves its semantics;
   verify the whole gamepad spec after.
2. Convert `speedUpSeats`/`speedDownSeats`/`jumpSeats` to module-scope
   arrays with `length = 0` at the top of `pollGamepadSeats` (the
   `threatCountScratch` pattern in enemies.js).
3. `updatePadHud`: memoize the `short`/`mode` derivation keyed on `gp.id` +
   `gp.mapping` (two module-level cache vars) so the split/trim/slice runs
   only when the pad identity changes; keep the existing `lastPadHudText`
   write gate.
**Verify**: `npx playwright test tests/gamepad.spec.js tests/coop.spec.js` → pass.

### Step 3 [P-16]: guard the hidden solo score dance

In `updateScoreDisplay`, branch: in coop, write `el.score.textContent =
state.score` WITHOUT the read-compare/reflow dance (keeps the element
truthful for a roster flip back to solo), then run the per-seat loop; solo
keeps the exact current path.
**Verify**: `npx playwright test tests/balance.spec.js tests/coop.spec.js` → pass.

### Step 4 [C-20]: clamp the scheduler; guard the resume

1. `audio.js` `schedulerTick`, first line inside the function after the
   guard: `if (nextStepTime < ctx.currentTime) nextStepTime =
   ctx.currentTime + 0.02; // Stall recovery: drop the backlog, never replay it`.
2. `music.start()`: after the `if (!ctx || muted || musicTimer) return;`
   guard add `if (ctx.state !== 'running') return; // Suspended context: a
   scheduler on a dead clock burst-fires on resume`.
3. `game.js` `togglePause` resume branch: call `unlockAudio()` before
   `music.start()` (the resume click/keypress IS a user gesture).
**Verify**: `npx playwright test tests/audio.spec.js` → pass.

### Step 5 [C-21]: anchor the camera after grounding

Move the `resetCameraZoom()` call in `setupNewGame` from `game.js:212` to
immediately AFTER the endless grounding block (after the
`resetRegionTracking()` call at `:275` is fine — anywhere after `:271`),
keeping its comment. Nothing between the two sites reads camera state
(verified: the block in between is mesh/terrain setup only).
**Verify**: `npx playwright test tests/camera.spec.js tests/endless.spec.js` → pass.

### Step 6 [C-22]: clamp the warn ring

`constants.js` GAME BALANCE block: `export const SPAWN_WARN_RADIUS_MAX = 12;
// Warn disc scale ceiling — past this a flat one-sample ring reads as
// underground geometry, not a telegraph (plan 033; late-game giants)`.
`enemies.js:238` and the throb at `:334`: wrap the scale factor:
`Math.min(SPAWN_WARN_RADIUS_MAX, SPAWN_WARN_RADIUS * Math.max(0.85, p.scaleFactor))`
(compute once per entry where practical). Bosses keep their 2× TIME, not
extra radius.
**Verify**: `npx playwright test tests/spawnwarn.spec.js` → pass (its specs
run at small scales, under the clamp).

### Step 7 [C-23]: move the knobs home (values byte-identical)

Add to constants.js GAME BALANCE with rationale comments, then replace the
literals: `ENEMY_AVOID_RADIUS = 7` (enemies.js:977),
`ENEMY_SEPARATION_HEADROOM = 1.25` (enemies.js:565),
`ROCK_WATER_CLEARANCE = 0.35` (terrain.js:685 — used as
`WATER_LEVEL + ROCK_WATER_CLEARANCE`), `FOOD_ROCK_CLEARANCE = 0.6`
(terrain.js:901), `FOOD_ANIM_CULL_RADIUS = 90` (effects.js:774 — replace
`8100` with `FOOD_ANIM_CULL_RADIUS * FOOD_ANIM_CULL_RADIUS`; keep the
comment noting it approximates scale-1 fog range).
**Verify**: `npm run lint` → 0; `npx playwright test tests/resources.spec.js
tests/effects.spec.js tests/endless.spec.js` → pass; then
`grep -n "avoidRadius = 7\|\* 1.25;\|+ 0.35\|+ 0.6\|8100" src/enemies.js src/terrain.js src/effects.js`
→ only the terrain `+ 0.35`/`+ 0.6` hits that are NOT these two sites (check
context of any hit).

### Step 8 [D-15]: break the ui→game cycle with a dirty flag

1. `state.js`: add `enemyPaceDirty: false, // killPlayer defers the speed
   recompute to the next update() frame — breaks the ui→game import cycle (plan 033)`.
2. `ui.js` `killPlayer`: replace the `applySpeedMultiplier()` call (`:529`)
   with `state.enemyPaceDirty = true;` and DELETE the
   `import { applySpeedMultiplier } from './game.js';` line (`:15`) — if
   plan 029 landed first, `settleAscendedPlayer` gets the same flag
   treatment (it lives in ui.js too).
3. `game.js` `update()`, immediately after `state.runTime += dt;`:
   `if (state.enemyPaceDirty) { state.enemyPaceDirty = false; applySpeedMultiplier(); }`.
   One-frame latency on the pace drop is imperceptible and spec-invisible
   (the coop spec asserts after `advance` calls that tick frames).
**Verify**: `npx playwright test tests/coop.spec.js` → pass;
`grep -n "from './game.js'" src/ui.js` → no matches.

### Step 9 [D-17]: truth in comments

- `timers.js:11-12` and `:81-82`: rewrite to describe the LIVE per-seat
  behavior (Stage E landed with plan 026).
- `state.js:33`: `heartbeatClock` comment → "seat 0's clock IS the world
  heart (one audible heartbeat, ui.js updateDangerPulse); other seats'
  fields exist for the reset sweep only".
- `constants.js:12`: extend the `MAX_ENEMIES` comment: "CLASSIC/debug-only
  cap (the retired torus arena via forceWorldMode); the shipping endless
  caps are ENDLESS_ENEMY_CAP / ENDLESS_ENEMY_CAP_COOP below".
**Verify**: `npm run lint` → 0.

### Step 10: Full gate

`npm test` (alone) → all pass; `npm run build` → 0.

## Done criteria (ALL must hold)

- [ ] `npm test` exits 0; `npm run lint` exits 0; `npm run build` exits 0
- [ ] `grep -c "navigator.getGamepads" src/input.js` → exactly 1 (the
      cached list helper) — connect/disconnect listeners and rumble.js keep
      their own event-driven reads (those are not per-frame; rumble.js is
      out of scope)
- [ ] `grep -n "smooth01" src/clouds.js` → module scope only
- [ ] `grep -n "applySpeedMultiplier" src/ui.js` → no matches
- [ ] The five knob literals exist only in `src/constants.js`
- [ ] Ten commits (or nine if squashing 9+10), each passing its own verify
- [ ] `plans/README.md` row 033 updated

## STOP conditions

- `tests/gamepad.spec.js` fails after Step 2 — the mock's per-call-array
  semantics broke under the list cache; report the failing case, do not
  weaken the mock.
- Any knob extraction changes a numeric value — the diff for Step 7 must
  show literals moving, never changing.
- `killPlayer`'s flag deferral (Step 8) fails a coop assertion that
  demanded same-frame recompute — report; the fix is to also consume the
  flag at the top of `updateEnemies`, not to reinstate the import.
- Plan 031 turns out NOT to be landed — STOP (this plan assumes its
  `applySpeedMultiplier` shape).

## Maintenance notes

- The next debt slice (recorded, not planned): extract ui.js's tension
  block (`updateDangerPulse` + survival beats + heartbeat, ~190 lines) into
  `src/tension.js` — ui.js doubled since July and now owns eight
  subsystems; `tests/tension.spec.js` already characterizes the block.
- `hiscores.js` read/write duplication: consolidate ONLY when the next
  board or a `.v2` schema bump lands (the shapes must stay byte-stable).
- Deferred giant-scale findings (revive ONLY if plan 029's
  `ASCENSION_SCALE` is ever raised past ~12): spawn-clearance overlap at
  S≳12.6 (titan) / S≳17 (giants at high ramp), bubble placement deadlock at
  S≳21, shadow-frustum inversion at S≳19.5, fog/window-edge exposure at
  high camera pullback. Thresholds and sites in the 2026-08-14 audit
  section of `plans/README.md`.
