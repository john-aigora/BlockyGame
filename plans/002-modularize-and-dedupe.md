# Plan 002: Split game.js into ES modules, merge duplicated factories, delete dead code

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: plan 001 must be DONE (check `plans/README.md`).
> Then `git log --oneline -5 -- src/game.js` — this plan expects `src/game.js`
> to be the file created by plan 001 (the original `game.js` moved with only
> the import/startup edits). All line references below cite the ORIGINAL
> pre-001 `game.js` line numbers, which are offset by exactly +1 in
> `src/game.js` (the added `import * as THREE from 'three';` line). If the
> cited code cannot be found by searching the quoted excerpt text, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (large mechanical move; the smoke suite is the safety net)
- **Depends on**: plans/001-tooling-baseline.md
- **Category**: tech-debt
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

`src/game.js` is a single 1000-line file of interleaved concerns (scene setup, AI, input, UI, timers). Every remaining plan touches a slice of it; without a split, each plan's diff sprawls and review is hard. Two concrete debts also live here: `createPlayer`/`createEnemy` are ~160 near-duplicate lines (`game.js:309-463`) — merging them into one parameterized factory is what later makes player/enemy skins cheap — and there are three near-identical collectible spawners (`game.js:465-532`). Dead code misleads: `targetCollectiblesOnScreen` (`game.js:48`) is written twice, never read, yet the README claims the game "maintains a target number of food items" based on it.

## Current state

- `src/game.js` — everything. Key regions by original line numbers:
  - `1-78` globals & tuning constants; `82-243 init()`; `247-305 setupNewGame()`
  - `309-385 createPlayer()` and `387-463 createEnemy()` — structurally identical (group = body cube + 4 legs + 2 eyes + mouth) differing only in: base size (`1.0` vs `enemyBaseHeight = 1.2`), body color (`0xFF4500` vs `0x03A9F4`), face color (`0x000000` vs `0x222222`), the enemy's `bodyMesh.name = 'body'`, and enemy-only AI properties:
    ```js
    enemyGroup.randomVelocity = new THREE.Vector3(0, 0, 0);
    enemyGroup.timeToChangeRandomVelocity = Math.random() * 2 + 1;
    enemyGroup.orbitDirection = Math.random() < 0.5 ? 1 : -1;   // game.js:456-458
    ```
  - `465-532` three spawners: `spawnNewCollectible()` (random box around player), `spawnCollectibleAnywhere()` (random in world), `spawnCollectibleAtPosition(position)` (scatter near a point). All three build the identical 0.7-cube lime mesh and differ only in how they pick x/z.
  - `534-563` collect-timer functions; `566-605` input handlers; `609-820 update()`; `824-830 animate()`; `834-855` message/reset; `858-877 togglePause()`; `880-935` kill-check/spawn/avoid; `938-961` touch vector; `964-1000` speed/zoom/camera.
- Dead code to delete: `enemy` in `let player, enemy, ground;` (`game.js:5`); `targetCollectiblesOnScreen` declaration and its two writes (`game.js:48`, `game.js:289`, `game.js:754` — at 289 keep the loop that uses `initialFoodCount`, only the assignment line goes).
- `eslint.config.js` has `'no-unused-vars': 'warn'` (set by plan 001 precisely because of these variables).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0, zero warnings after this plan |
| Smoke tests | `npm test` | 4 passed |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/game.js` (shrinks to a small orchestrator or disappears; keep `src/main.js` as the entry)
- New files: `src/state.js`, `src/constants.js`, `src/world.js`, `src/characters.js`, `src/collectibles.js`, `src/enemies.js`, `src/input.js`, `src/ui.js`, `src/timers.js` (adjust names only if a listed one collides with something)
- `eslint.config.js` (tighten one rule)
- `tests/helpers.js` (create, optional per step 5)

**Out of scope**:
- ANY behavior change. This plan is a refactor: same gameplay, same constants, same bugs (later plans fix them). Do not fix the frame-rate coupling, wrap logic, avoidance force, zoom, or timers even though you will be staring at them.
- `index.html`, `style.css` (no UI changes).
- Renaming user-visible ids/classes.

## Git workflow

- Branch: `improve/002-modularize`
- Suggested commits: one per step below; style `Refactor: ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract constants and mutable state

Create `src/constants.js` exporting every `const` tuning value from the top of `game.js` (lines 12-78: `growthFactor`, `enemyBaseHeight`, `speedMultipliers`, `ZOOM_OUT_FACTOR`, camera offsets, `BASE_PLAYER_SPEED`, `MOBILE_SPEED_MULTIPLIER`, `MAX_DRAG_DISTANCE`, `DEAD_ZONE_RADIUS`, `worldSize`, `worldBoundary`, `initialFoodDensityArea`, `collectibleSpawnRadius`, `minSpawnDistanceFromPlayer`, `enemyStartOffset`, `engagementRadius`, `orbitStrengthFactor`, `enemyRandomDriftFactor`, `BASE_ENEMY_SPAWN_DISTANCE`, `SPAWN_DISTANCE_SCALE_FACTOR`, `initialCollectTime`, `MAX_ENEMY_INDICATORS`).

Create `src/state.js` exporting a single mutable object so cross-module mutation stays simple (this repo pattern is deliberate — plain shared-state arcade game, not a framework):

```js
export const state = {
  scene: null, camera: null, renderer: null,
  player: null, ground: null,
  collectibles: [], enemies: [],
  score: 0, gameActive: false, isPaused: false,
  playerScale: 1, canKillEnemy: false,
  // ...every remaining `let` from game.js:1-78 becomes a property
};
```

Convert reads/writes mechanically (`score` → `state.score`). Do it module by module as you extract them in the later steps rather than all at once, so the game never breaks between commits.

**Verify**: `npm test` → 4 passed (run after each extraction step, not only at the end).

### Step 2: Extract the character factory (deduplicate)

Create `src/characters.js` with ONE builder:

```js
export function createCharacter({ baseSize, bodyColor, faceColor }) {
  // the exact geometry recipe currently duplicated at game.js:309-385 and 387-463:
  // group; body cube (side = baseSize) with bodyMesh.name = 'body';
  // 4 legs (h = baseSize*0.3, w = baseSize*0.15); 2 eyes (baseSize*0.1);
  // mouth (baseSize*0.4 x 0.08 x 0.05); all castShadow = true.
  // Return the THREE.Group. Do NOT add it to the scene here.
}
```

Port the *player* proportions (they are the same ratios; the only geometric difference between the two current functions is `baseSize`). Give the player's body the `name = 'body'` too — it is harmless and makes the factory uniform. Preserve one visual quirk exactly: the current player positions eyes/mouth using `bodyMesh.position.z + offset` (`game.js:361`, `375`) while the enemy uses plain `offset` (`game.js:435`, `449`). `bodyMesh.position.z` is `0`, so both produce identical geometry — the factory should use the enemy's simpler form.

Then:
- `createPlayer()` (stays in `src/characters.js`, exported) = `createCharacter({ baseSize: 1.0, bodyColor: 0xFF4500, faceColor: 0x000000 })` plus the existing player group setup (`game.js:379-384`: assign to `state.player`, position/scale, add to scene).
- `createEnemy()` (move to `src/enemies.js`, exported) = `createCharacter({ baseSize: 1.2, bodyColor: 0x03A9F4, faceColor: 0x222222 })` plus the AI properties (`randomVelocity`, `timeToChangeRandomVelocity`, `orbitDirection` — excerpt in Current state), add to scene, push to `state.enemies`, return it.

**Verify**: `npm test` → 4 passed. Visually (dev server): player is orange with black face, enemies blue with dark-grey face, both have legs/eyes/mouth, enemy turns yellow when the player outgrows it.

### Step 3: Extract collectibles with a single spawner

In `src/collectibles.js`, replace the three spawners with:

```js
function buildCollectible() { /* the shared 0.7 lime cube mesh, castShadow/receiveShadow */ }
export function spawnCollectible(pickPosition) {
  // pickPosition: () => ({x, z}) — caller supplies placement strategy
}
export function spawnNearPlayer() { /* current do/while from game.js:475-480 */ }
export function spawnAnywhere() { /* current do/while from game.js:500-505 */ }
export function spawnAtPosition(position) { /* current scatter from game.js:521-526 */ }
```

Callers keep their current placement semantics exactly (including the current lack of world-boundary clamping — plan 005 fixes that in ONE place, which is the point of this consolidation).

**Verify**: `npm test` → 4 passed.

### Step 4: Extract the rest along seam lines

- `src/world.js`: scene/camera/renderer/lights/ground creation (from `init`, `game.js:106-149`), `onWindowResize`, `updateCameraPosition`, `zoomOutCamera`.
- `src/input.js`: `onKeyDown`, `onKeyUp`, `keys`, touch listeners and `updateMovementVector` (`game.js:168-220`, `566-593`, `938-961`).
- `src/ui.js`: `showMessage`, `hideMessage`, indicator pool creation + per-frame indicator update (extracted from `update()`, `game.js:625-673`), kill-indicator update (`game.js:612-623`), score/timer DOM writes.
- `src/timers.js`: `startCollectTimer`, `resetCollectTimer` (`game.js:534-563`).
- `src/enemies.js`: enemy AI block from `update()` (`game.js:675-764`), `spawnNewEnemies`, `avoidOtherEnemies`, `canKillSpecificEnemy`.
- `src/game.js` keeps: `init`, `setupNewGame`, `update`, `animate`, `resetGame`, `togglePause`, `cycleSpeed`, `applySpeedMultiplier`, and the startup listener — importing everything else.

Keep `update()`'s internal ORDER identical: kill-indicator visuals → off-screen indicators → enemy loop → player movement/wrap → ground/light follow → collectible collisions → camera. (Later plans depend on this documented order.)

**Verify**: after each file extraction, `npm test` → 4 passed.

### Step 5: Delete dead code and tighten lint

- Delete the `enemy` binding from `let player, enemy, ground;` (state object equivalent).
- Delete `targetCollectiblesOnScreen` (declaration + the assignment at old 289 + the increment at old 754). Keep `initialFoodCount` and its spawn loop intact.
- Delete the commented-out `window.onload` block if it survived plan 001, and the two stale `// REMOVED:` comment lines (`game.js:98-99`, `102-104`).
- In `eslint.config.js`, change `'no-unused-vars': 'warn'` → `'error'`.
- Expose a read-only debug/test handle at the end of `src/main.js` (used by later plans' tests):
  ```js
  import { state } from './state.js';
  window.__game = { state };
  ```

**Verify**: `npm run lint` → exit 0 with **zero warnings**; `npm test` → 4 passed; `npm run build` → exit 0.

## Test plan

No new test files. The existing 4 smoke tests are the harness — run them after every step. Additionally add ONE new assertion to `tests/smoke.spec.js` boot test: `await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1)` (proves the module split still spawns the first enemy and the debug handle works).

## Done criteria

- [ ] `wc -l src/game.js` ≤ 300 (orchestrator only)
- [ ] `grep -rn "targetCollectiblesOnScreen\|spawnCollectibleAnywhere\|spawnNewCollectible(" src/` → no matches (old names gone; new module API in use)
- [ ] Exactly one place in `src/` builds character geometry: `grep -rln "BoxGeometry(baseSize" src/` (or equivalent) → `src/characters.js` only
- [ ] `npm run lint` exits 0 with zero warnings
- [ ] `npm test` exits 0 (5 tests: 4 smoke + upgraded boot assertion)
- [ ] `npm run build` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plan 001 is not DONE.
- Any smoke test fails after an extraction and the cause isn't an obvious missed import/rename — report rather than rewriting logic.
- You find yourself "improving" behavior (fixing wrap math, retuning forces, changing timers). That is scope creep into plans 003-007 — revert the improvement and continue mechanically.
- The quoted excerpts (factory duplication, AI properties) can't be located.

## Maintenance notes

- The `state` object is the single source of mutable truth; later plans (003 deltaTime, 004 game-over gate) assume it.
- Skins (a wishlist feature) are now `createCharacter` parameter variants — reviewers should reject any new per-character geometry copies.
- `window.__game` is a test/debug handle; production code must never read it.
