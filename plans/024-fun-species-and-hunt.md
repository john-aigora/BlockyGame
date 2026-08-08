# Plan 024: Fun batch 2 — enemy species, prey supply, reachable combos, fair telegraphs

> **Executor instructions**: Step-by-step; verify each. Balance changes carry
> explicit before/after notes for the family playtest. STOP conditions binding.
>
> **Drift check (run first)**: `git diff --stat 128d18e..HEAD -- src/enemies.js src/constants.js src/characters.js src/game.js tests/balance.spec.js tests/endless-stream.spec.js`

## Status

- **Priority**: P2 · **Effort**: M-L · **Risk**: MED (balance-sensitive — every
  change is a constant with a recorded rationale)
- **Depends on**: 017, 019 (honest hitboxes first), 022 item 1 (naming), 023 (popup/sfx reuse)
- **Category**: direction (gameplay depth)
- **Planned at**: commit `128d18e`, 2026-07-31

## Why this matters

Four verified design tensions cap the hunt (findings DT-2/4/5/9 in
`plans/audit-2026-07-31.md`): the combo window is arithmetically unreachable at
1× speed; hunting suspends its own prey supply (the fix for the owner's
"I never get to eat anybody" switches off when you eat somebody); enemies cannot
threaten a moving player (and the owner rule "doubling the player must NOT speed
enemies up" — `src/constants.js:13-15` — forbids raw speed-ups); and the
0.95-second warn ring loses its protective value exactly at high speed
multipliers. The capability audit (CAP-2) found species are one data table away.

## Current state

- `src/enemies.js:41-56` `createEnemy(scaleFactor)` — per-instance userData has
  drift/orbit fields only; NO species/speedFactor.
- Speed reads (all global): `src/enemies.js:299` (flee), `:309` (orbit), `:312`
  (chase), `:328-331` (total-speed cap `1.25 × actualEnemySpeed`).
- Contact death: `src/enemies.js:352-356` — non-killable contact calls
  `endGame('The enemy caught you.')`.
- Spawn bands: `SPAWN_SIZE_PATTERN = ['prey','giant','peer','giant']`
  (`src/constants.js:151`), consumed at `src/enemies.js:558-566`;
  `bubbleSpawnCounter` advances only on successful schedule (`:575`); the top-up
  early-returns while `enemies.length + pendingSpawns.length >= target` (`:551`).
- Kill replacements: `spawnNewEnemies()` (`:424-478`) — up to 2, ALWAYS giants
  (`currentEnemyScaleFactor()`, `:416-421`), distance `min(30 + scale×10, 50)`.
- Warn timing: `SPAWN_WARN_TIME = 0.95` (`src/constants.js:30`), fixed seconds;
  disc lifetime is a single field (`src/enemies.js:143`).
- Combo: `COMBO_WINDOW = 4`, `COMBO_MAX = 5` (`src/constants.js:18-19`); spawn
  latency 1.45s; closing speed on prey at 1×/scale 1 = 4.5 u/s → 18u reach vs
  35-50u spawn distance.
- Character factory: `createCharacter({baseSize, bodyColor, faceColor,
  perInstanceBodyMaterial, menacing})` (`src/characters.js:122`); killable
  color flip writes body+cap hex (`src/enemies.js:229-237`).
- GAME BALANCE block: all new constants go in `src/constants.js`'s labeled block
  with a one-line rationale comment each (house law).

## Commands

`export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` · `npm test` ·
`npx playwright test tests/balance.spec.js tests/endless-stream.spec.js --workers=1`

## Scope

**In scope**: `src/enemies.js`, `src/constants.js`, `src/characters.js`
(species colors only), `src/game.js` (kill hook only), `src/main.js` (debug),
`tests/balance.spec.js`, `tests/endless-stream.spec.js`, new `tests/species.spec.js`,
`readme.md` (How to play: one short paragraph).
**Out of scope**: player movement/speed; the enemy-speed owner rule (NEVER raise
`BASE_ENEMY_SPEED`/`RAMP_SPEED_MAX`); bosses (plan 025); AI rewrites.

## Git workflow

Run branch; `[<branch> · Batch N/M] <verb> <what>`; NEVER push.

## Steps

### Step 1: Species stats bag

`src/constants.js` GAME BALANCE block:

```js
export const ENEMY_SPECIES = {
    // speedFactor multiplies actualEnemySpeed for THIS enemy only. The owner
    // rule (see line ~13) binds the GLOBAL enemy speed to the multiplier, not
    // per-species character: sprinters are fast BUT small and always edible.
    grunt:    { speedFactor: 1.0, bodyColor: null,      harmless: false, foodDrop: 4 },
    sprinter: { speedFactor: 2.2, bodyColor: 0xFF7043,  harmless: false, foodDrop: 4 },
    juja:     { speedFactor: 2.6, bodyColor: 0x66BB6A,  harmless: true,  foodDrop: 2 },
};
```

`createEnemy(scaleFactor, speciesKey = 'grunt')`: store
`ud.species = ENEMY_SPECIES[speciesKey]`, pass `bodyColor` override to
`createCharacter` when non-null. Thread speed: at the four read sites use
`state.actualEnemySpeed * ud.species.speedFactor`, INCLUDING the cap line
(`1.25 × actualEnemySpeed × ud.species.speedFactor`) so a species can't outrun
its own separation steering.
**Verify**: suite green (all existing enemies default grunt; zero behavior change).
`debug` gains `spawnSpecies(key, x, z)` for tests.

### Step 2: Sprinter + juja in the rotation

Extend `SPAWN_SIZE_PATTERN` to
`['prey','giant','peer','giant','sprinter','giant','juja','peer']` with band
handling at `src/enemies.js:558-566`: `sprinter` → height range `[0.5, 0.7] ×
playerScale` (ALWAYS edible — fast but killable: the danger is it reaches you,
the answer is you eat it), species `sprinter`; `juja` → height `0.35 ×
playerScale` fixed, species `juja`. Juja contact rule at `:352-356`: when
`ud.species.harmless`, non-killable contact does NOT endGame (juja is always
smaller so in practice always killable; guard anyway). Juja kill drops
`ud.species.foodDrop` food (wire the existing 4-food drop at `:406-408` through
the species field).
**Verify**: new `tests/species.spec.js` — (a) sprinter closes distance faster
than a grunt over 2 game-seconds (spawn both via `debug.spawnSpecies`,
measure); (b) juja contact never ends the game (place overlapping, wait, assert
`gameActive`); (c) juja kill drops exactly 2 food.

### Step 3: Prey supply fix (DT-4)

At `src/enemies.js:551`, gate the bubble top-up on THREATS, not everything:
count `enemies + pending` that are NOT currently killable
(`!canKillSpecificEnemy(e)`) against the target; killable prey no longer block
the rotation. Add the rationale comment quoting the owner report
(`src/constants.js:147-148`).
**Verify**: endless-stream rotation spec still green; new species.spec case —
kill 2 prey quickly, then assert a new PREY-band spawn is scheduled within
`2 × ENDLESS_SPAWN_INTERVAL` game-seconds (was: starved).

### Step 4: Reachable combos (DT-2)

`spawnNewEnemies()`: the SECOND replacement of each kill becomes a `prey`-band
spawn at distance 18-25u (new constants `KILL_SPAWN_PREY_MIN/MAX = 18/25` with
rationale: "combo reach at 1× is ~18u — the chain must be sprintable"), species
grunt. First replacement stays a giant at the existing distance. Net kill
economy unchanged (+2 spawns), but one is chainable.
**Verify**: balance combo spec now reaches x2 at 1× without speed changes (it
already kills twice; assert the second target's band). Add an explicit case:
after one kill, a killable enemy exists within 30u.

### Step 5: Speed-aware warn rings (DT-9)

`scheduleEnemySpawn`: warn duration becomes
`SPAWN_WARN_TIME * clamp(state.actualPlayerSpeed / 6.0, 1.0, 2.2)` (new
constant `SPAWN_WARN_SPEED_REF = 6.0` in the balance block; comment: "notice is
measured in player-travel, not seconds — audit DT-9").
**Verify**: species.spec case — set speed multiplier 5×, schedule a spawn,
assert pending warn lifetime ≥ 2× the 1× value (read via a debug getter on the
pending entry or expose `debug.pendingSpawnInfo()`).

### Step 6: Docs + playtest notes

readme "How to play": add two sentences — sprinters (orange, fast, always
edible) and jujas (small green critters, harmless, snack on them for bonus
food). Run log: record the before/after combo-reach math and the four new
constants for the family playtest review.
**Verify**: `npm test` 0 failed, twice.

## Test plan

New `tests/species.spec.js` (~6 cases, patterns from balance/endless-stream
specs, game-clock waits, mock-free). Updated balance assertions per steps 3-4.

## Done criteria

- [ ] `npm test` 0 failed ×2 · lint 0
- [ ] `ENEMY_SPECIES` table exists with rationale comments; 4 speed sites threaded
- [ ] species.spec covers sprinter speed, juja harmlessness, prey-supply,
      chainable kill-spawn, warn scaling
- [ ] `plans/README.md` updated with the balance-change summary line

## STOP conditions

- Step 1 threading changes any EXISTING spec's outcome (it must be a no-op for
  grunts) — report before touching tuning.
- Sprinter at 2.2× catches a straight-line 1×-speed player in open ground in
  under 4s of simulation (it should harass, not guarantee) — report measured
  closing time instead of retuning solo.
- The owner speed rule would be violated by any change you're considering.

## Maintenance notes

- Species colors bypass the killable-yellow flip only for juja (already always
  edible); sprinters flip yellow like grunts — the flip writes body+cap hex, so
  species bodyColor must restore on un-flip (check `src/enemies.js:229-237`
  restores from a stored base color, not a literal).
- Plan 025's boss is species machinery + a scale; keep `spawnSpecies` debug
  generic.
