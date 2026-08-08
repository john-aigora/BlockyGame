# Plan 017: Make lint and the full test suite green again, with failure artifacts and CI

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report — do not improvise. When done, update this
> plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 128d18e..HEAD -- eslint.config.js playwright.config.js tests/ src/main.js readme.md`
> If any in-scope file changed since planning, compare "Current state" excerpts
> against live code first; on mismatch, STOP.

## Status

- **Priority**: P1 · **Effort**: M · **Risk**: LOW
- **Depends on**: none — THIS PLAN GATES ALL OTHERS
- **Category**: tests
- **Planned at**: commit `128d18e`, 2026-07-31

## Why this matters

`npm test` currently fails (7 of 79 tests, reproducible serially — verified twice
on 2026-07-31) and `npm run lint` fails (78 errors). Every other plan in this run
cites these commands as its verification gate, so nothing can be trusted until
they are green. The failures are STALE TESTS asserting retired classic-arena
semantics — the game code is behaving as designed. Full attribution: finding
BASE-1 in `plans/audit-2026-07-31.md`.

## Current state

- `eslint.config.js` — flat config; `files: ['src/**/*.js', 'tests/**/*.js', '*.config.js']`
  gets browser+node globals, but `js.configs.recommended` applies repo-wide, so
  `video/scripts/*.js` (Node scripts) produce 78 `no-undef` errors (`console`,
  `process`, `Buffer`, `require`, …). Ignore list at the bottom covers
  `dist/`, `node_modules/`, `playwright-report/`, `test-results/`, `public/original/`.
- `playwright.config.js` — 12 lines; no trace/screenshot/video/reporter/retries.
- The 7 failing tests and why (each verified):
  1. `tests/hiscores.spec.js:19` seeds `blocky.hiscores.v1` (CLASSIC key) then
     expects 2 rows; the death screen now renders the ENDLESS board
     (`blocky.hiscores.endless.v1`, distance-ranked — `src/hiscores.js:9-11,24-31`).
  2. `tests/balance.spec.js:42` (combo) — `page.evaluate` reads
     `state.enemies[0].scale` right after `debug.spawnNewEnemies()`; endless spawns
     go through a 0.95s warn + 0.5s materialize pipeline
     (`src/enemies.js:129-198`), so the array is still empty → TypeError.
  3. `tests/balance.spec.js:94` — expects the horde capped at 8 (classic
     `MAX_ENEMIES`); endless cap is 12 (`ENDLESS_ENEMY_CAP`, `src/constants.js:154`)
     and immediate counts stay low because spawns are pending, not live.
  4. `tests/effects.spec.js:12` and 5. `tests/resources.spec.js:13` — assert
     renderer geometry count grows ≤1; endless chunk streaming legitimately builds
     chunk geometries when the test teleports the player (observed +26 / +4).
  6. `tests/effects.spec.js:49` (popups) — same class; boot-time chunk builds are
     still completing when `before` is sampled.
  7. `tests/endless-stream.spec.js:289` — fast-forwards with
     `debug.updateEnemyStreaming(5)`, which only QUEUES warn discs now; nothing
     ticks `updateSpawnWarnings`, so 0 spawns are observed.
- `src/main.js:17-51` — the `window.__game.debug` handle. It does NOT expose
  `updateSpawnWarnings`.
- `readme.md:58` claims "61 tests" — the real count is 79.
- No `.github/` directory exists.
- Test conventions: game-clock waits via `waitGameSeconds`/`waitForGameOver` in
  `tests/helpers.js:61-72` — never wall-clock waits for game behavior
  (`docs/elves/learnings.md:38`).

## Commands you will need

Every shell: `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"`

| Purpose | Command | Expected |
|---|---|---|
| Lint | `npm run lint` | exit 0, no errors |
| Full suite | `npm test` | 79+ passed, 0 failed |
| One spec | `npx playwright test tests/balance.spec.js --workers=1` | all pass |

## Scope

**In scope**: `eslint.config.js`, `playwright.config.js`, `tests/hiscores.spec.js`,
`tests/balance.spec.js`, `tests/effects.spec.js`, `tests/resources.spec.js`,
`tests/endless-stream.spec.js`, `src/main.js` (ONE added debug entry only),
`readme.md` (test-count line only), `.github/workflows/ci.yml` (create).

**Out of scope**: any gameplay/source change beyond the single `main.js` debug
line; `public/original/`; other readme fixes (plan 021 owns docs).

## Git workflow

Single run branch (created by the run orchestrator). Commit per step, message
style `[<branch> · Batch N/M] <verb> <what>`. **NEVER `git push`** — origin is
read-only for this account and the owner forbade pushing.

## Steps

### Step 1: Scope lint to the game project

In `eslint.config.js`, add `'video/'` to the `ignores` array with a comment:
`// video/ is a separate npm project (Remotion tooling) with its own deps; not linted here.`
**Verify**: `npm run lint` → exit 0.

### Step 2: Add failure artifacts and a reporter

In `playwright.config.js` add:
`use: { baseURL: ..., trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' }`
and `reporter: [['list'], ['html', { open: 'never' }]]`. Keep everything else.
**Verify**: `npx playwright test tests/smoke.spec.js` → passes; `playwright-report/` created (gitignored already).

### Step 3: Expose the warn-pipeline tick on the debug handle

In `src/main.js`, inside the `debug` object, add one line:
`updateSpawnWarnings,` imported from `./enemies.js` (it is exported — confirm; if
not exported, export it). This is the same read-only-affordance pattern as the
existing `updateEnemyStreaming` entry (`src/main.js:23`).
**Verify**: `npm run lint` → 0; in a spec scratch: `window.__game.debug.updateSpawnWarnings` is a function.

### Step 4: Fix `tests/hiscores.spec.js`

Re-seed against the endless key and ranking: seeds become
`localStorage.setItem('blocky.hiscores.endless.v1', JSON.stringify([{ score: 50, date: '2026-01-01', distance: 400 }]))`.
Endless ranks by DISTANCE first (`src/hiscores.js:24-31`) — an idle run to death
scores 0 points and ~0 distance, so the seeded 400u entry stays rank 0 and the
new run lands below it: the original assertions (2 rows, seeded first, new row
`.is-new`, "0" in row 2) hold once the key and a distance field are right. Apply
the same key/shape change to the trim test's seed list (5 entries need distance
values in descending order).
**Verify**: `npx playwright test tests/hiscores.spec.js --workers=1` → 4 passed.

### Step 5: Fix `tests/balance.spec.js`

- Combo test: after `debug.spawnNewEnemies()`, wait for materialization on the
  game clock before touching enemies: `await waitGameSeconds(page, 2.0);` then
  `await page.waitForFunction(() => window.__game.state.enemies.length >= 1)`.
  Then proceed with the existing kill choreography.
- Cap test: pending spawns count against the cap
  (`src/enemies.js:429-432`). Loop `spawnNewEnemies()` 10×, then
  `waitGameSeconds(page, 2.0)`, then assert
  `state.enemies.length + <pending> <= 12` — read pending via
  `debug.updateSpawnWarnings ? ... : 0`; simplest honest assertion:
  `enemies.length <= 12` after settling, and rename the test
  `...never grows the horde past the endless cap (12)`.
**Verify**: `npx playwright test tests/balance.spec.js --workers=1` → 5 passed.

### Step 6: Fix the geometry-stability specs

In `tests/effects.spec.js:12` and `tests/resources.spec.js:13`: warm the world
BEFORE sampling `before` — run the teleport-collect loop once (or in the effects
spec, teleport to `collectibles[0]` once and `waitGameSeconds(page, 1)`), then
sample `before`, then run the measured loop, then assert. Add the comment:
`// Endless streams chunk geometry on movement; measure after warm-up so the pool is settled (plan 017).`
For `tests/effects.spec.js:49` (popups): move the `before` sample to after a
`waitForFunction` that `debug.terrainInfo().pendingBuilds === 0` (the field
exists — verify with `terrainInfo()` output; if named differently, use the
equivalent queue-empty signal).
**Verify**: `npx playwright test tests/effects.spec.js tests/resources.spec.js --workers=1` → all pass.

### Step 7: Fix `tests/endless-stream.spec.js:289` (spawn rotation)

After each fabricated `updateEnemyStreaming(5)` call, also tick the warn
pipeline to materialize pending spawns:
`await page.evaluate(() => { for (let i = 0; i < 40; i++) window.__game.debug.updateSpawnWarnings(0.05); });`
then wait one rAF. Keep the existing band assertions.
**Verify**: `npx playwright test tests/endless-stream.spec.js --workers=1` → 5 passed.

### Step 8: Readme count + CI

- `readme.md:58`: replace "(61 tests)" with "(see `npx playwright test --list`)".
- Create `.github/workflows/ci.yml`: on push+PR → checkout, setup-node 22 with
  npm cache, `npm ci`, `npm run lint`,
  `npx playwright install --with-deps chromium`, `npm test`, upload
  `playwright-report/` artifact on failure.
**Verify**: `npm run lint` → 0. (CI itself cannot run locally; YAML must parse: `node -e "require('js-yaml')"` is NOT available — just review carefully.)

### Step 9: Full green gate

**Verify**: `npm test` → 0 failed. Run it twice; both green.

## Test plan

This plan IS the test plan. New assertions must keep the original intent
(pool discipline, cap enforcement, ranking) — do not weaken an assertion beyond
what the endless design requires; each loosening carries a comment naming the
endless mechanism that requires it.

## Done criteria

- [ ] `npm run lint` exits 0
- [ ] `npm test` → 0 failed, twice in a row
- [ ] `playwright.config.js` has trace/screenshot/video retain-on-failure
- [ ] `.github/workflows/ci.yml` exists
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` row updated

## STOP conditions

- A "stale" test still fails after its endless-semantics rewrite — that would
  mean a REAL regression, not test drift. Report which assertion with output.
- Fixing a spec seems to require changing game code (other than the one
  `main.js` debug line).
- `updateSpawnWarnings` is not exported and exporting it creates an import cycle.

## Maintenance notes

- Future feature merges must run the FULL suite, not just their own spec — this
  plan exists because two merges didn't.
- Plan 027 adds `debug.advance(seconds)`; when it lands, the `waitGameSeconds`
  settles added here can be tightened.
