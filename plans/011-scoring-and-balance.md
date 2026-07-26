# Plan 011: Score the hunt, cap the horde — kill points and a survivable difficulty curve

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: plans 003-005 must be DONE per `plans/README.md`
> (units are per-second and the kill path is `killEnemy(...)`). If the kill
> path or constants module can't be found as described, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (game feel — bounded by explicit numbers and a manual playtest checklist)
- **Depends on**: plans/005-toroidal-world-correctness.md
- **Category**: direction (game design) / bug (doc-vs-code contradiction)
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

The README promises scoring for "collecting food **and strategically defeating enemies**" — but kills award **zero points** (the only `score++` is the food-collect branch, originally `game.js:807`). Defeating an enemy is high-risk and currently pays out only indirectly (4 food + 2 tougher enemies), so the optimal strategy is to never hunt — the opposite of the game's own pitch. Separately, every kill spawns two enemies 1.5× the player's height with **no cap**: the enemy count grows monotonically and the late game becomes a wall. Small, explicit numbers fix both.

## Current state

- Scoring: `state.score++` only in the collect branch (`src/game.js`, originally `game.js:807-808`).
- Kill path: `killEnemy(enemyGroup, i)` in `src/enemies.js` (plan 004) — removes enemy, spawns 4 food + `spawnNewEnemies()`.
- `spawnNewEnemies()` (originally `game.js:890-915`) always spawns exactly 2, each `1.5 × player height`, at `spawnDistance` (capped by plan 005 at `worldBoundary * 0.8`).
- Enemy speed: 50% of player base × shared multiplier (`applySpeedMultiplier`, originally `game.js:964-975`).
- Instructions text (`index.html:33-41`) says "Defeating an enemy spawns two new, larger foes." — stays true.
- HUD: score element `#score`; death screen shows `#final-score` (plan 008); hi-scores store raw score (plan 009 — no change needed, but magnitudes grow).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |

## Scope

**In scope**: `src/constants.js`, `src/enemies.js`, `src/game.js`, `index.html` (instructions line), `tests/balance.spec.js` (create), `readme.md` (one sentence — the scoring description).

**Out of scope**: new enemy types, power-ups, boost (future work; see plan 014 and todo.md), changing food growth (`growthFactor`), the speed-multiplier button semantics.

## Git workflow

- Branch: `improve/011-scoring-balance`
- Commit style: `Feat: ...` / `Balance: ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Named tuning block

In `src/constants.js` add one clearly-labeled section (single source of truth for designers-in-training — i.e. the kid):

```js
// --- GAME BALANCE (tune here, nowhere else) ---
export const FOOD_POINTS = 1;              // per block (today's behavior)
export const KILL_POINTS = 25;             // flat bounty per defeated enemy
export const MAX_ENEMIES = 8;              // hard population cap
export const ENEMIES_PER_KILL = 2;         // spawned per kill, subject to the cap
export const ENEMY_HEIGHT_FACTOR = 1.5;    // new-enemy height vs player (existing value, now named)
```

Replace the inline `1.5` in `spawnNewEnemies`/`setupNewGame` first-enemy sizing with `ENEMY_HEIGHT_FACTOR`, the `score++` with `state.score += FOOD_POINTS`.

### Step 2: Kill bounty

In `killEnemy(...)`: `state.score += KILL_POINTS;` and update the score display through the existing UI path. Nothing else changes — food burst and respawn stay.

### Step 3: Population cap

In `spawnNewEnemies()`:
```js
const slots = Math.max(0, MAX_ENEMIES - state.enemies.length);
const count = Math.min(ENEMIES_PER_KILL, slots);
```
Spawn `count` enemies using the existing angle logic (first random, second opposite ± deviation — if `count === 1`, only the first). If `count === 0`, spawn none (the horde is full; killing still pays points and food — that's the relief valve the difficulty curve needs).

### Step 4: Tell the player

- `index.html` instructions: change "Defeating an enemy spawns two new, larger foes." → "Defeat YELLOW enemies: +25 points... but two larger foes appear!"
- `readme.md`: in the Gameplay/UI section, one sentence stating food = 1 pt, kills = 25 pts, max 8 enemies. (Full README rewrite is plan 013 — keep this to the one factual line so the docs never contradict shipped behavior.)

**Verify (manual playtest checklist — record answers in the PR/report)**:
1. Kill 1 enemy → score jumps by 25 (plus any food collected).
2. Kill repeatedly → alive-enemy count never exceeds 8 (watch the indicator arrows; or `window.__game.state.enemies.length` in the console).
3. A 5-minute session by someone who didn't write the code: does hunting now feel worth it? (Yes/no + one sentence.)

## Test plan

Create `tests/balance.spec.js` (uses `window.__game.state` + debug hooks):

1. **Kill pays**: boot, unpause, evaluate: force-kill an enemy through the real path — set `state.playerScale = 20; state.player.scale.set(20,20,20);` then teleport player onto the enemy's position and wait ≤ 2s for the collision branch → `state.score` ≥ 25.
2. **Cap holds**: evaluate a loop that calls the exported `spawnNewEnemies()` 10 times (expose on `window.__game.debug`) → `state.enemies.length` ≤ 8.
3. **Score display syncs**: after test 1, `#score` text equals `String(state.score)`.

**Verify**: `npm test` → all pass.

## Done criteria

- [ ] `grep -rn "score++" src/` → no matches (all scoring goes through named constants)
- [ ] `grep -rn "MAX_ENEMIES" src/enemies.js` → present in the spawn path
- [ ] `npm run lint` / `npm test` exit 0 (incl. balance.spec.js)
- [ ] Manual playtest checklist recorded
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plans 003-005 not DONE (per-frame units or forEach kill path still present — this plan's numbers assume per-second units and `killEnemy`).
- Test 1 cannot trigger the collision branch deterministically — report the flake; do not score via a synthetic `state.score +=` (that would test nothing).
- You're tempted to add difficulty ramps (speed scaling over time, shrinking timer). Not this plan — record the idea in `todo.md` and stop at the four constants.

## Maintenance notes

- All future balance knobs go in the GAME BALANCE block — that block is deliberately the kid-friendly "game designer console".
- `KILL_POINTS = 25` and `MAX_ENEMIES = 8` are first guesses; the family playtest (manual step 3) is the real gate — expect a tuning commit after a weekend of play, and that's healthy.
- If a future enemy type spawns differently, it must still respect `MAX_ENEMIES`.
