# Plan 025: Fun batch 3 — daily worlds, named biomes, golden food, the 1000u boss

> **Executor instructions**: Step-by-step; verify each. STOP conditions binding.
> Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 128d18e..HEAD -- src/terrain.js src/constants.js src/game.js src/collectibles.js src/hiscores.js src/ui.js src/gate.js index.html tests/`

## Status

- **Priority**: P2 · **Effort**: M-L · **Risk**: MED
- **Depends on**: 017, 023 (beats/popups), 024 (species machinery for the boss)
- **Category**: direction (content & late game)
- **Planned at**: commit `128d18e`, 2026-07-31

## Why this matters

The endless mode's escalation completes by 1800u and every reward constant is
flat forever (DT-8) — there is no late game and no reason to replay beyond the
number. The world is fully deterministic (`TERRAIN_SEED`, `src/constants.js:106`)
but that determinism is invisible to players. This plan adds: a shared DAILY
world the family competes on, biome discovery moments, a rare routing-decision
food, and one scripted boss beat at 1000u. Grounding: DT-8/DT-10, CAP-1/2,
catalog E-27/32, D-17/21/22 in `plans/audit-2026-07-31.md`.

## Current state

- `src/constants.js:106` — `export const TERRAIN_SEED = 20260726;` module const;
  chunk seed streams hash it (`src/terrain.js:472-473,513-514`; clouds
  `src/clouds.js:47`). URL-param precedent: `?move=` (`src/constants.js:217-218`),
  `?paddebug=1` (`src/input.js:27-28`).
- Biome tint: `computeTint` (`src/terrain.js:168-185`) adds one low-frequency
  octave (`BIOME_WAVELENGTH = 300`); nothing else reads it; `terrainTint(x,z)`
  is already on the debug handle.
- Scatter hook: `buildChunk` calls exactly `scatterRocks/scatterFood/
  spawnChunkCloud` (`src/terrain.js:421-423`), released at `:427-441`; per-chunk
  seeded LCG with the roll-all-randoms law (`:517-518`); collider registration
  `chunk.colliders.push({x,z,r})` (`:503`).
- Food collect block: `src/game.js:377-407` (single site — points, growth,
  clock reset, milestone, sfx).
- Ramp/level transitions: `updateEndlessProgress()` (`src/game.js:468-491`) —
  the single place level changes are detected; distance milestones every 250u
  there too.
- Boards: `keyForMode(mode)` 3-line pattern (`src/hiscores.js:14`), sortBoard
  per-mode (`:24-31`), schema-change policy `:6-7`.
- Boss ingredients (post-024): `debug.spawnSpecies`, `scheduleEnemySpawn(x, z,
  scaleFactor)` (`src/enemies.js:129`), `sfx.fanfare` (`src/audio.js:79`),
  `spawnRing`/`spawnTextPopup`, size bounty already scales with height
  (`src/enemies.js:372-378`).

## Commands

`export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` · `npm test` ·
`npx playwright test tests/endless.spec.js tests/endless-polish.spec.js --workers=1`

## Scope

**In scope**: files in the drift check + new `tests/worldfun.spec.js`.
**Out of scope**: backend/global boards (no serverless exists — recorded
constraint); weather/ice/bridges; ghost runs (future plan); classic mode.

## Git workflow

Run branch; `[<branch> · Batch N/M] <verb> <what>`; NEVER push.

## Steps

### Step 1: Seed plumbing + `?seed=` + DAILY WORLD

Make the seed a read-once function: `src/constants.js` exports
`WORLD_SEED` resolved at module load — priority: `?seed=<int>` param → daily
flag → default `TERRAIN_SEED`. Daily flag: `?daily=1` OR a persisted toggle
(sessionStorage `blocky.daily`) set by a new start-overlay button
`TODAY'S WORLD` (reuse `.mode-button` CSS — style.css:322-355; if plan 022
deleted it, re-add the class rules under a `/* daily toggle */` comment).
Daily seed = `YYYYMMDD` of local date. ALL seed consumers must reference
`WORLD_SEED` (grep `TERRAIN_SEED` uses: `src/terrain.js`, `src/clouds.js`,
food stream) — keep the export name `TERRAIN_SEED` as an alias if simpler, but
one source of truth. Show the active seed small on the start overlay
(`SEED 20260807 · DAILY`).
**Verify**: `tests/worldfun.spec.js` — load `/?seed=123`, sample
`debug.terrainHeight(10,10)`; reload same seed → identical value; `/?seed=124`
→ different. Suite green (default seed unchanged → terrain determinism spec
still passes).

### Step 2: Daily board

Runs made with the daily toggle record ALSO to key
`blocky.hiscores.daily.v1` with a `seed` field; `sortBoard` branch = endless
rules. Death screen: when the run was daily, show the daily board titled
`TODAY'S BEST` filtered to entries whose `seed` matches today; stale-seed
entries prune on read (keep ≤5 of today). Solo endless board still records too
(a daily run is an endless run).
**Verify**: worldfun.spec — daily run to death writes both keys; death screen
shows `TODAY'S BEST`; a seeded stale-seed entry does not render.

### Step 3: Named biomes + DISCOVERED banner

Export `biomeAt(tx, tz)` from `src/terrain.js` (the existing biome octave call
in `computeTint` extracted; deterministic in TRUE coords). Region identity:
quantize the octave value into 5 bins; name = seeded pick from a 12-entry table
of kid-friendly two-word names (`THE TEAL SHALLOWS`, `COPPER FLATS`, …) hashed
by bin + region cell (`floor(tx/300), floor(tz/300)`). In
`updateEndlessProgress`, when the player's bin+cell changes and stays changed
for 1.5 game-seconds (debounce — shorelines flicker), fire
`spawnTextPopup(..., 'DISCOVERED: <NAME>', biome tint color)` + `sfx.milestone()`.
Track visited count in `state`; show `REGIONS <n>` on the death screen line.
**Verify**: worldfun.spec — teleport 400u, pump frames, assert a DISCOVERED
popup fired (via `effectsInfo().lastPopupText` from plan 023) and the death
screen shows `REGIONS`.

### Step 4: Golden food

In `scatterFood` (`src/terrain.js:512-525`): per chunk, ONE extra seeded roll
(before rejection, per the roll-all law) with 8% chance → mark that food gold:
separate shared gold material (emissive, `applyWorldBend`), `userData.gold = true`,
slightly larger. In the collect block (`src/game.js:377-407`): gold pays
`GOLD_FOOD_POINTS = 5`, full clock reset (same as normal), +popup `+5 GOLD!` +
`sfx.fanfare` short. Constants in the balance block with rationale ("a visible
routing prize — worth a detour, not a strategy").
**Verify**: worldfun.spec — force-spawn a gold food via a debug flag on
`spawnChunkFood` or scan `state.collectibles` for `userData.gold` after seeding
a known seed; collect it; assert +5 and the popup.

### Step 5: The 1000u boss

In `updateEndlessProgress`, at the FIRST crossing of `BOSS_DISTANCE = 1000`
(state flag, once per run): schedule `scheduleEnemySpawn(x, z, bossScale)`
40u ahead of the player's heading with `bossScale = currentEnemyScaleFactor() ×
1.6`, species `grunt`, and mark the resulting enemy `ud.boss = true` (crown: cap
mesh color gold + scale 1.3 — the cap mesh is per-instance already). Boss
rules: bounty ×3 (multiply payout in `killEnemy` when `ud.boss`), on-kill
`spawnRing` of 10 food in a 6u circle (use the existing kill-food drop path
with count 10 + wider scatter), `sfx.fanfare` full, popup `TITAN DOWN!`.
Warn beat: 2× warn time + popup `SOMETHING BIG COMES...` at schedule time.
The boss does NOT bypass edibility — it arrives inedible (giant) and becomes
huntable as the player grows; it never despawns by radius (exempt in the
despawn check) until killed or the run ends.
**Verify**: worldfun.spec — set `state.furthestDistance` to 990, walk forward,
assert the warn popup, then (force `playerScale` big) kill it: payout ≥ 3× the
normal formula, 10 food present, flag cleared (no second boss on further
distance).

### Step 6: Docs

readme: one paragraph — daily world, seeds, gold blocks, regions, the 1000u
titan. Run log: constants added + the boss math.
**Verify**: `npm test` 0 failed ×2.

## Test plan

New `tests/worldfun.spec.js` (~8 cases). Seeded determinism makes every case
reproducible; use `?seed=` for fixtures. Game-clock waits only.

## Done criteria

- [ ] `npm test` 0 failed ×2 · lint 0
- [ ] Same-seed reload reproduces terrain; daily board written + pruned
- [ ] DISCOVERED, gold, boss beats all spec-verified
- [ ] `plans/README.md` updated

## STOP conditions

- Step 1: any consumer still reads the OLD constant after the sweep
  (`grep -rn "TERRAIN_SEED" src/` shows a non-alias use) and terrain determinism
  spec fails.
- Step 5: the boss exemption from despawn leaks it across a restart
  (`setupNewGame` must clear it — verify before reporting).
- Any step needs a change to enemy base speeds.

## Maintenance notes

- Ghost runs (catalog I-55) become cheap after this: same seed + an input log.
  Deferred deliberately.
- Plan 026: daily/coop interplay — a 2P daily run records to the coop board
  only (avoid double-crediting solo boards); 026 owns that rule.
