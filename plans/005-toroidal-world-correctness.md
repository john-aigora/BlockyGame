# Plan 005: Make AI, wrapping, and spawning respect the toroidal world (fixes "shaking" and "teleporting" enemies)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: plans 001-004 must be DONE per `plans/README.md`.
> Locate code by quoted excerpts (original `game.js` lines cited; post-002 the
> logic lives in `src/enemies.js`, `src/collectibles.js`, `src/game.js`,
> `src/constants.js`). If an excerpt is missing, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (gameplay feel changes — intended, but needs the listed manual checks)
- **Depends on**: plans/004-game-over-loop-correctness.md
- **Category**: bug
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

The world wraps at ±100 on X/Z, but nothing except the wrap itself knows that. This one blind spot causes both bugs the maintainers listed in `todo.md` ("Shaking/Immobile Bug", "Teleporting Enemy Glitch") plus two quieter ones:

1. **Shaking**: enemy separation shoves 21 units/s (post-003 units) — ~14× enemy speed — directly into position after the speed cap, so two enemies within 7 units violently oscillate.
2. **Teleporting**: chase/flee direction uses the raw vector, so an enemy that wraps flips its apparent direction and can pop out right next to a player standing near the boundary; the wrap also discards overshoot (`position.x = -worldBoundary + 0.1` regardless of how far past the edge it went).
3. Enemy spawn distance `30 + 10×playerScale` (`game.js:896`) exceeds the world at playerScale ≥ 7 — spawns land out of bounds and get slammed to the far edge.
4. Food spawns are never wrapped/clamped, so food placed beyond ±100 (player near an edge, or an enemy dying near one) is **permanently uncollectable** — a slow drain on the food economy that the collect timer punishes.

## Current state

- Wrap-with-clamp, four copies for enemy (`game.js:734-737`) and player (`game.js:781-784`):
  ```js
  if (enemyGroup.position.x > worldBoundary) enemyGroup.position.x = -worldBoundary + 0.1;
  ```
- Raw-vector AI (`game.js:703`, `708`): `new THREE.Vector3().subVectors(enemyGroup.position, player.position).normalize()` (flee) and the chase equivalent; engagement test `player.position.distanceTo(enemyGroup.position)` (`game.js:685`).
- Post-cap avoidance shove (`game.js:917-935`): after `combinedMovement` is capped, `avoidOtherEnemies` runs `enemyGroup.position.addScaledVector(avoidDirection, avoidForce)` per neighbor within 7 units.
- Spawn distance (`game.js:896`): `const spawnDistance = BASE_ENEMY_SPAWN_DISTANCE + (playerScale * SPAWN_DISTANCE_SCALE_FACTOR);`
- Food spawners (post-002 all in `src/collectibles.js`): near-player box ±30 around player, scatter ±1.5 around death position — no bounds handling. `worldSize = 200`, `worldBoundary = 100` (`game.js:46-47`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |
| Unit tests only | `npx playwright test tests/world.spec.js` | pass |

## Scope

**In scope**: `src/enemies.js`, `src/collectibles.js`, `src/game.js` (player wrap), `src/constants.js`, new `src/worldmath.js`, `tests/world.spec.js` (create).

**Out of scope**:
- Camera/fog/zoom (plan 006). Difficulty/balance numbers other than `AVOID_FORCE` (plan 011). Collectible reachability UI (none planned).
- Changing `worldSize` or the wrap-around design itself.

## Git workflow

- Branch: `improve/005-toroidal-world`
- Commit style: `Fix: ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: One toroidal math module

Create `src/worldmath.js` (pure functions — unit-testable without three.js scene):

```js
import { worldSize, worldBoundary } from './constants.js';

export function wrapCoord(v) {
    // maps any value into [-worldBoundary, worldBoundary), preserving overshoot
    return ((v + worldBoundary) % worldSize + worldSize) % worldSize - worldBoundary;
}
export function wrapPosition(pos) {           // mutates a Vector3-like {x,z}
    pos.x = wrapCoord(pos.x);
    pos.z = wrapCoord(pos.z);
    return pos;
}
export function torusDeltaComponent(from, to) {
    let d = to - from;
    if (d > worldBoundary) d -= worldSize;
    else if (d < -worldBoundary) d += worldSize;
    return d;
}
export function torusDelta(fromPos, toPos, out) {
    // shortest XZ vector from→to across the wrap; writes into `out` (THREE.Vector3)
    out.set(torusDeltaComponent(fromPos.x, toPos.x), 0, torusDeltaComponent(fromPos.z, toPos.z));
    return out;
}
export function torusDistance(a, b) {
    const dx = torusDeltaComponent(a.x, b.x), dz = torusDeltaComponent(a.z, b.z);
    return Math.hypot(dx, dz);
}
```

**Verify**: `node -e "import('./src/worldmath.js').then(m => { console.log(m.wrapCoord(103), m.wrapCoord(-101), m.torusDeltaComponent(95, -95)); })"` → `-97 99 10` (103 wraps to -97; -101 wraps to 99; shortest path from 95 to -95 is +10 across the seam).

### Step 2: Replace all wrap clamps

Player and enemy wrap blocks become `wrapPosition(entity.position)`. Delete the four-line `+0.1` clamp copies in both places.

**Verify**: `grep -rn "worldBoundary + 0.1\|worldBoundary - 0.1" src/` → no matches.

### Step 3: Wrap-aware AI

In `src/enemies.js`:
- `distanceToPlayer` → `torusDistance(enemyGroup.position, state.player.position)`.
- Chase direction → `torusDelta(enemyGroup.position, state.player.position, tmpVec).normalize()`; flee = same delta negated (do not build it from raw subVectors anywhere).
- `avoidOtherEnemies`: neighbor distance and away-direction via `torusDistance` / `torusDelta`.
- Reuse a module-level `tmpVec = new THREE.Vector3()` for the delta to avoid per-frame allocation (matches the hygiene direction of plan 007).

**Verify**: `grep -rn "subVectors(.*player.position\|subVectors(.*enemyGroup.position" src/` → no remaining raw-vector chase/flee sites.

### Step 4: Fix the separation shake

Avoidance becomes a steering component, not a position shove:
- In `src/constants.js`: `AVOID_FORCE = 21.0` → `AVOID_SPEED_FACTOR = 1.2` (dimensionless multiple of enemy speed).
- In the enemy update, accumulate `avoidVec` (sum of normalized away-directions from neighbors within `avoidRadius`) BEFORE the speed cap: `combinedMovement.addScaledVector(avoidVec.normalize(), actualEnemySpeed * AVOID_SPEED_FACTOR)` (skip if `avoidVec` is zero-length), then apply the existing cap `if (combinedMovement.length() > maxSpeed) …` with `maxSpeed = actualEnemySpeed * 1.25` (allows separation to win slightly over chase without runaway speed). Then a single `position.addScaledVector(combinedMovement, dt)`.
- Delete the post-movement `avoidOtherEnemies` position mutation entirely — its logic moved into the pre-cap accumulation.

**Verify (manual, dev server)**: kill the first enemy (collect ~6 food, touch it while yellow) so two enemies exist; herd them together — they should smoothly slide apart, zero jitter. Record a 5-second observation in the PR/report.

### Step 5: Clamp spawn placement into the world

- Enemy spawn distance (`spawnNewEnemies`): `const spawnDistance = Math.min(BASE_ENEMY_SPAWN_DISTANCE + playerScale * SPAWN_DISTANCE_SCALE_FACTOR, worldBoundary * 0.8);` then `wrapPosition(enemyN.position)` after placement (belt and braces — a capped distance can still cross the seam when the player stands near an edge, and a wrapped position is now *correct* because the AI is torus-aware).
- Every food spawner (`spawnNearPlayer`, `spawnAnywhere`, `spawnAtPosition`) ends with `wrapPosition(collectible.position)` before `scene.add`.

**Verify**: `tests/world.spec.js` (below) passes.

## Test plan

Create `tests/world.spec.js`:

1. **All food in bounds even at the edge** (browser test): boot, then `page.evaluate` — teleport the player to `x=99.5, z=99.5` (`window.__game.state.player.position.set(...)`), call the exported spawners ~50 times via a debug hook (add `window.__game.debug = { spawnNearPlayer, spawnAtPosition }` in `src/main.js` as part of this plan), then assert every `state.collectibles[i].position` has `|x| <= 100 && |z| <= 100`.
2. **Wrap preserves overshoot**: `page.evaluate` — set player to `x=100.4`, run one frame (`await page.waitForTimeout(50)` with game unpaused), assert player.x ≈ -99.6 ±0.5, not -99.9.
3. **AI takes the short way across the seam**: place player at `x=-95`, one enemy at `x=95` (same z), non-killable; sample enemy x over 1s → it must *increase* toward the seam (moving +x to wrap), not decrease toward the long way. Use `window.__game.state`.
4. Keep tests deterministic: pause, set positions, unpause, sample, tolerate the random-drift component with generous bounds (drift ≤ 30% of speed).

**Verify**: `npm test` → all pass.

## Done criteria

- [ ] `grep -rn "worldBoundary + 0.1" src/` → no matches
- [ ] `grep -rn "AVOID_FORCE\b" src/` → no matches (replaced by `AVOID_SPEED_FACTOR`)
- [ ] `npm run lint` / `npm test` exit 0 (incl. `world.spec.js`)
- [ ] Manual check from step 4 recorded (two enemies separate smoothly, no jitter)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plans 001-004 not DONE; excerpts unlocatable.
- Step 1's node one-liner prints different numbers — your modulo handling of negatives is wrong; fix `wrapCoord` before touching game code, or report.
- Enemies orbit the seam or oscillate across it after step 3 (sign error in `torusDeltaComponent`) — revert and report if not resolved by re-deriving against the step 1 examples.
- The world tests require test hooks this plan didn't anticipate beyond `window.__game.debug` — report rather than exposing more internals ad hoc.

## Maintenance notes

- ALL future distance/direction logic between world entities must go through `src/worldmath.js` — raw `subVectors`/`distanceTo` on world positions is the bug class this plan eliminates (fine for screen/camera math).
- `AVOID_SPEED_FACTOR` and the 1.25 cap are the tuning knobs if separation ever feels too strong/weak; they're now safe to tune (units/second, applied via dt).
- Plan 011 (balance) may revisit spawn-distance scaling; it must keep the `worldBoundary * 0.8` cap.
