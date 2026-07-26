# Plan 003: Make simulation frame-rate independent and move the collect timer onto the game clock

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: plans 001 and 002 must be DONE per
> `plans/README.md`. Line references below cite the ORIGINAL `game.js` at
> commit `f4d3ecc`; after plan 002 the same logic lives in the `src/` modules
> named in each step. Locate code by the quoted excerpt text, not line number.
> If an excerpt cannot be found anywhere in `src/`, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches every movement constant; behavior at 60fps must be preserved)
- **Depends on**: plans/002-modularize-and-dedupe.md
- **Category**: bug
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

The simulation advances a fixed amount **per rendered frame**, not per second: on a 120Hz display (most current iPhones/iPads and many monitors) the entire game runs exactly twice as fast; on a slow device it runs slow. Meanwhile the 15-second collect timer runs on wall-clock `setInterval`, so the two clocks disagree: in a throttled/background tab the world freezes while the timer keeps counting — verified live during the audit: the player dies at Score 0 behind a frozen world after switching tabs. This same mismatch powers a cheat: pausing and resuming resets the collect timer to 15s (`togglePause` → `startCollectTimer()` → `collectTimerValue = initialCollectTime`). One fix covers all three: a delta-time simulation clock that the collect timer also runs on.

## Current state

(Original-line citations; post-002 module locations in parentheses.)

- `game.js:824-830` (src/game.js) — the loop has no time source:
  ```js
  function animate() {
      animationFrameId = requestAnimationFrame(animate);
      if (!isPaused) {
          update();
      }
      renderer.render(scene, camera);
  }
  ```
- Per-frame movement everywhere, e.g. player (`game.js:769-772`, src/game.js): `if (keys['arrowup']) player.position.z -= actualPlayerSpeed;` and enemies (`game.js:704`, src/enemies.js): `combinedMovement.copy(fleeDirection).multiplyScalar(actualEnemySpeed);`
- Hardcoded 60fps assumption (`game.js:689`, src/enemies.js):
  ```js
  enemyGroup.timeToChangeRandomVelocity -= (1 / 60);
  ```
- Speed constants are per-frame (`game.js:32`, src/constants.js): `const BASE_PLAYER_SPEED = 0.05;` — i.e. 3.0 units/second at 60fps.
- Avoidance shove is per-frame (`game.js:919`, src/enemies.js): `const avoidForce = 0.35;` (plan 005 retunes it; this plan only converts units).
- Wall-clock timer (`game.js:543-557`, src/timers.js): `setInterval(() => { ... collectTimerValue--; ... }, 1000)`; started by `togglePause`'s unpause branch (`game.js:869-876`) via `startCollectTimer()`, which resets `collectTimerValue = initialCollectTime` — the pause exploit.
- Kill-indicator flash toggles per frame (`game.js:617-619`, src/ui.js) — converted to a time accumulator here, retuned visually in plan 007.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Smoke tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**: `src/game.js`, `src/enemies.js`, `src/constants.js`, `src/state.js`, `src/timers.js`, `src/ui.js`, `src/input.js` (only if touch/keyboard movement code lives there post-002), `tests/smoke.spec.js` (one test update), `tests/timing.spec.js` (create).

**Out of scope**:
- Retuning game FEEL (avoidance strength, orbit factor, spawn distances) — plans 005/011. Convert units 1:1 so 60fps behavior is identical.
- The enemy-loop structural bugs (game-over gate, splice-during-iteration) — plan 004.
- Fog/zoom (plan 006). Kill-flash rate choice (plan 007).

## Git workflow

- Branch: `improve/003-frame-rate-independence`
- Commit style: `Fix: ...` (e.g. `Fix: Drive simulation and collect timer from delta time`)
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Introduce the clock

In `src/game.js`:

```js
let lastFrameTime = null;
const MAX_DELTA = 0.05; // seconds; clamps tab-switch gaps and GC hitches

function animate(now) {
    state.animationFrameId = requestAnimationFrame(animate);
    if (lastFrameTime === null) lastFrameTime = now;
    const dt = Math.min((now - lastFrameTime) / 1000, MAX_DELTA);
    lastFrameTime = now;
    if (!state.isPaused) {
        update(dt);
    }
    renderer.render(scene, camera);
}
```

`update(dt)` threads `dt` (seconds) into the enemy update and any other extracted per-frame code. On unpause (`togglePause`), set `lastFrameTime = null` so the paused gap is not integrated.

**Verify**: `npm run lint` → 0; game runs in dev server at normal speed.

### Step 2: Convert constants to per-second units (×60, exactly)

In `src/constants.js` — multiply every per-frame magnitude by 60 and rename to make the unit explicit:

| Old (per frame) | New (per second) |
|---|---|
| `BASE_PLAYER_SPEED = 0.05` | `BASE_PLAYER_SPEED = 3.0` (units/s) |
| enemy base = 50% of player (`applySpeedMultiplier`, game.js:967) | unchanged ratio — becomes 1.5 units/s at 1x |
| `avoidForce = 0.35` | `AVOID_FORCE = 21.0` (units/s — intentionally preserving today's excessive value; plan 005 retunes) |

Every application site multiplies by `dt`:
- Player: `player.position.z -= state.actualPlayerSpeed * dt;` (all four arrows + touch vector)
- Enemies: after `combinedMovement` is assembled and capped **as a velocity** (cap length at `actualEnemySpeed`, unchanged logic), apply `enemyGroup.position.addScaledVector(combinedMovement, dt);`
- Drift magnitudes (`enemyRandomDriftFactor` term) are ratios of enemy speed — no constant change, they inherit the ×dt.
- Avoidance: `enemyGroup.position.addScaledVector(avoidDirection, AVOID_FORCE * dt);`
- `enemyGroup.timeToChangeRandomVelocity -= dt;` (replaces `1/60`)
- Kill-indicator flash: replace the per-frame toggle with `state.killFlashClock += dt` and toggle when it exceeds `0.5` (reset to 0). Plan 007 owns the final look.

**Verify**: dev server at 1x speed feels identical to before this plan (player crosses the visible area in the same wall-clock time). `npm test` → all pass.

### Step 3: Move the collect timer onto the game clock

- Delete `setInterval`/`clearInterval` usage and `startCollectTimer`/`resetCollectTimer` from `src/timers.js`; replace with:
  ```js
  export function resetCollectClock() { state.collectTimeLeft = initialCollectTime; }
  export function tickCollectClock(dt) {
      if (!state.gameActive) return;
      state.collectTimeLeft -= dt;
      // DOM write: ceil, and only when the displayed integer changes
      const shown = Math.max(0, Math.ceil(state.collectTimeLeft));
      if (shown !== state.lastShownCollectTime) {
          state.lastShownCollectTime = shown;
          document.getElementById('collect-time').textContent = shown;
      }
      if (state.collectTimeLeft <= 0) { /* trigger the existing game-over path with the existing "Failed to collect" message */ }
  }
  ```
- `update(dt)` calls `tickCollectClock(dt)` once per frame (before the enemy loop).
- Collecting food calls `resetCollectClock()` (same reset semantics as today).
- `setupNewGame` calls `resetCollectClock()` and renders "15".
- `togglePause` loses ALL timer bookkeeping — pausing now inherently freezes the countdown, and resuming does NOT reset it (this closes the exploit).
- Remove `collectTimerInterval` from state; `grep -rn "setInterval" src/` must come back empty.

**Verify**: `grep -rn "setInterval\|clearInterval" src/` → no matches.

### Step 4: Auto-pause on tab hide

In `src/game.js` `init()`:
```js
document.addEventListener('visibilitychange', () => {
    if (document.hidden && !state.isPaused && state.gameActive) togglePause();
});
```
(The dt clamp already prevents catch-up jumps; auto-pause additionally puts the player in a fair, deliberate resume state.)

**Verify**: manual (dev server): hide/show the tab mid-run → game is paused, timer unchanged, pause button reads "Resume".

### Step 5: Update tests

- `tests/smoke.spec.js`: no changes should be needed (DOM behavior identical) — run and confirm.
- Create `tests/timing.spec.js`:
  1. **Pause does not refill the countdown** (regression for the exploit): unpause, poll until `#collect-time` ≤ 12, pause, resume, assert `#collect-time` is still ≤ 12 (it must NOT jump back to 15).
  2. **Hidden tab does not kill the player**: unpause, `page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))` won't flip `document.hidden` — instead assert the auto-pause wiring via `window.__game.state`: set up by simulating `togglePause()` … keep it simple and robust: `page.evaluate(() => window.__game.state.isPaused)` after emulating visibility with CDP (`context.newCDPSession` + `Page.setWebLifecycleState`) **if straightforward**; otherwise assert the exploit test only and note the manual check. Do not burn more than 30 minutes on CDP plumbing — the exploit regression is the must-have.
  3. **Speed sanity**: with the game unpaused and arrows held via `page.keyboard.down('ArrowUp')` for 1000ms, `window.__game.state.player.position.z` decreases by roughly `actualPlayerSpeed * 1s` ± 30% (verifies dt integration is wired, catching double-integration or missing-dt bugs).

**Verify**: `npm test` → all pass (including new file).

## Test plan

See step 5 — the pause-exploit regression and the speed-integration sanity test are the required additions; model their structure on `tests/smoke.spec.js`.

## Done criteria

- [ ] `grep -rn "1 / 60\|1/60" src/` → no matches
- [ ] `grep -rn "setInterval" src/` → no matches
- [ ] `npm run lint` exits 0; `npm test` exits 0 with the new timing tests
- [ ] Manual dev-server check: 1x gameplay speed feels unchanged (60Hz display)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plans 001/002 not DONE, or excerpts unlocatable in `src/`.
- After conversion the game is visibly faster/slower at 60Hz — you likely double-applied dt (e.g. multiplied a constant by 60 AND kept a per-frame magnitude). Diff your constant table against Step 2 and report if it doesn't reconcile.
- The timing tests are flaky after two attempts — report with the flake details.

## Maintenance notes

- ALL future movement/ability code must be written in units/second × dt — reviewers should reject any new per-frame magic number (this is the exact bug class this plan removes).
- Plan 005 deliberately retunes `AVOID_FORCE` down; do not "pre-fix" it here.
- The dt clamp (`MAX_DELTA = 0.05`) means a sub-20fps device slows down rather than teleporting — that is the intended trade.
