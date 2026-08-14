# Plan 034: Ghost runs — race the family's best run on the same seeded world

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. On
> any STOP condition, stop and report. When done, update the status row in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c1ffd13..HEAD -- src/ tests/`
> Plans 029–033 may have landed — reconcile: this plan touches
> `hiscores.js` (which 029 extended with `asc`) and `game.js`/`effects.js`
> (which 029/033 touched). Compare excerpts before editing; unexplained
> mismatch = STOP.

## Status

- **Priority**: P2 (top of the next fun wave — catalog #9)
- **Effort**: M
- **Risk**: MED (new persistence + a new per-frame scenery actor; must not
  disturb the resource plateaus or solo behavior when no ghost exists)
- **Depends on**: none hard; NICE-AFTER 029 (an ascended ghost's marker says
  so)
- **Category**: direction
- **Planned at**: commit `c1ffd13`, 2026-08-14

## Why this matters

The game already has everything that makes ghosts cheap and great: worlds
are deterministic and shareable (`WORLD_SEED`, `?seed=`, the TODAY'S WORLD
daily map), the boards rank DISTANCE on those seeds, and the family plays
the same map all day. But racing is asynchronous today — you see a number
("FAMILY BEST: 843u"), not a runner. A ghost replays the best run for the
CURRENT seed as a translucent hero in the world: now a kid isn't chasing a
number, they're chasing *dad*, visibly, on the exact terrain where he went.
This converts TODAY'S WORLD from parallel play into an actual race — the
single highest fun-per-effort item left in the July catalog.

## Design (locked)

- **Scope v1: SOLO runs only** (2P has two heroes and a team board — a team
  ghost is a different feature; the roster contract in `state.js` notes
  ghosts must build on `makePlayerState` — v1 deliberately does NOT put the
  ghost in `state.players` at all; it is pure scenery with zero gameplay
  surface, which honors the spirit of that note by staying OUT of the
  roster rather than half-in).
- **Record**: while a solo run is live, sample seat 0 every
  `GHOST_SAMPLE_INTERVAL` (0.15) game-seconds: TRUE coordinates
  (`mesh.position.x + state.worldOrigin.x`, same for z — rebase-proof by
  construction), plus `scale`, quantized to 2 decimals. Cap memory with
  interval-doubling: when the buffer hits `GHOST_MAX_SAMPLES` (4000),
  drop every second sample and double the live interval (classic
  ghost-recording trick — long runs keep full shape at half resolution).
- **Persist**: at run end (`endGame`), if this run's `furthestDistance`
  beats the stored ghost for this seed, save
  `{ v: 1, seed, distance, score, date, interval, asc, points: [x0,z0,s0, x1,z1,s1, ...] }`
  (flat number array — compact JSON) under `blocky.ghost.<seed>.v1`. ONE
  ghost per seed, best-distance wins (ties keep the incumbent). All storage
  I/O lives in `src/hiscores.js` — the repo's designated localStorage owner
  (only audio.js is also allowed; do NOT touch localStorage from a new
  module).
- **Replay**: at `startRun` on a solo run, if a ghost exists for
  `WORLD_SEED` (and it isn't the recording just made — always replay the
  STORED best), show the ghost: a hero-shaped mesh playing back
  position/scale against `state.runTime`, linear interpolation between
  samples. Position written as `trueX - state.worldOrigin.x` each frame, so
  rebases need zero special handling. When playback passes the last sample,
  the ghost fades out over 1s and a one-time popup marks the spot:
  `GHOST FELL HERE — <distance>u` (or `GHOST ASCENDED HERE` when the stored
  run has `asc`, if plan 029 landed).
- **Look**: `createCharacter({ baseSize: 1, bodyColor: 0x80DEEA, faceColor: 0x222222 })`,
  then ONE traversal at build time replacing every child mesh's material
  with ONE shared ghost material
  (`MeshBasicMaterial({ color: 0x80DEEA, transparent: true, opacity: 0.38, depthWrite: false })`,
  world-bent via `applyWorldBend`) and setting `castShadow = false` on
  every mesh. One geometry set (already cached per baseSize=1), one new
  material, one mesh group — built ONCE at first use and parked with
  `visible = false` between runs (the foodArrows pattern,
  `src/effects.js:140-153`). No blob shadow, no outline pass needed (the
  outline shell child gets the same ghost material — acceptable).
- **Ghost is untouchable**: never in `state.players` or `state.enemies`,
  never collides, never targeted, never counted by any threat surface, no
  arrows, no HUD except the start-overlay line
  `RACING THE GHOST: <distance>u` under FAMILY BEST.
- **Start overlay line**: reuse the `#family-best` pattern (`src/ui.js:276-285`).
- **Kill switch**: `?ghost=0` disables replay for a session (the URL-param
  precedent: `?move=`, `?daily=`, `?paddebug=`). Recording always runs
  (it is cheap and invisible).

## Current state (verified excerpts, at `c1ffd13`)

- Seed resolution: `src/constants.js:193-208` — `WORLD_SEED` resolved once
  at module load (param → daily → default); `DAILY_WORLD` flag beside it.
- Storage owner: `src/hiscores.js:1-7` — "The ONLY module (besides
  src/audio.js) allowed to touch localStorage. Every storage access wrapped
  in try/catch"; key-versioning convention at `:5-7`; permissive
  shape-validated reads (`:26-35`, `:81-104`).
- Run lifecycle: `startRun` (`src/game.js:317-330`, the single "a run
  begins" entry); `endGame` (`src/ui.js:547-586`, the only legal end);
  `setupNewGame` per-player reset loop (`src/game.js:189-198`);
  `state.runTime` (`src/state.js:180`) is the game clock specs wait on.
- True-coordinate convention: `trueX = position.x + worldOrigin.x`
  (`src/state.js:70-72`); region tracking already computes it per frame
  (`src/game.js:643`).
- Parked-mesh pattern to copy: panic food arrows built once in
  `initEffects`, `visible = false` when idle (`src/effects.js:140-153`).
- Character factory: `createCharacter({ baseSize, bodyColor, faceColor, ... })`
  (`src/characters.js:163`) returns a THREE.Group without adding to scene;
  geometry cached per baseSize (`:91-129`); materials cached per color
  (`:131-139`); `applyWorldBend` from `./terrain.js`.
- Start-overlay slot: `#family-best` markup `index.html:71-72`; filled by
  `updateFamilyBest` (`src/ui.js:276-285`) from `showStartOverlay`.
- Popup tool: `spawnTextPopup(position, text, fillStyle, player)`
  (`src/effects.js:264`).
- Resource plateaus pinned by `tests/resources.spec.js` +
  `tests/effects.spec.js` — one-time boot allocations are absorbed by their
  warm-up baselines; per-run allocations are NOT.

## Repo conventions that bind this plan

GAME BALANCE knobs in constants.js with rationale; game-clock law (replay
against `state.runTime`, never wall time); pooled/one-time GPU resources;
solo-below-feature byte-stability (no ghost stored → zero behavior change);
specs DOM- or `__game`-level via `debug.advance`; storage only in
hiscores.js; never two suites at once.

## Commands

Every shell first: `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"`

| Purpose | Command | Expected |
|---|---|---|
| Lint | `npm run lint` | exit 0 |
| New spec | `npx playwright test tests/ghost.spec.js` | pass |
| Plateau guard | `npx playwright test tests/resources.spec.js tests/effects.spec.js` | pass |
| Full suite | `npm test` | all pass |

## Scope

**In scope:** `src/constants.js` (knobs), `src/ghost.js` (NEW — record +
replay state machine), `src/hiscores.js` (ghost load/save only),
`src/game.js` (init + per-frame tick + startRun/endGame/setupNewGame
hooks), `src/ui.js` (overlay line only), `index.html` (one overlay line),
`src/main.js` (debug `ghostInfo`), `tests/ghost.spec.js` (NEW),
`readme.md` (one paragraph), `plans/README.md`.

**Out of scope:** 2P ghosts; ghost-vs-player HUD deltas ("+12u AHEAD"
chips — explicitly rejected UI direction for this repo); any change to
boards/ranking; enemies/collision/threat surfaces (the ghost must remain
invisible to all of them — verify, don't modify); `public/original/`.

## Steps

### Step 1: Knobs + storage

`constants.js` GAME BALANCE: `GHOST_SAMPLE_INTERVAL = 0.15` (≈7 samples/s —
smooth at replay, ~26KB/10min after quantization),
`GHOST_MAX_SAMPLES = 4000` (interval-doubling threshold),
`GHOST_OPACITY = 0.38` (visible, never mistakable for a live hero) — each
with a rationale comment. `hiscores.js`: `loadGhost(seed)` (try/catch,
shape-check `v === 1 && Number.isFinite(distance) && Array.isArray(points)
&& points.length % 3 === 0`; return null on any failure) and
`saveGhost(seed, ghost)` (only overwrite when `ghost.distance` strictly
beats the incumbent; try/catch; key `blocky.ghost.<seed>.v1`).
**Verify**: `npm run lint` → 0; Node-import check on constants still prints
(`node --input-type=module -e "import('./src/constants.js').then(m=>console.log(m.GHOST_SAMPLE_INTERVAL))"` → `0.15`).

### Step 2: `src/ghost.js`

Recorder: `resetGhostRecording()` (setupNewGame), `tickGhostRecording(dt)`
(called from `update()` — accumulates game-time, pushes quantized samples,
interval-doubles at cap; solo + endless + not-CONTINUOUS_MOVEMENT only),
`finalizeGhostRecording()` (endGame hook: build the ghost object from the
buffer + `state.furthestDistance`/score/`WORLD_SEED` and hand to
`saveGhost`; include `asc: true` when the ending was an ascension IF plan
029's flag is available — read it off `state.players[0].ascended`, guarded
with `?? false` so the plan works pre-029). Replayer:
`initGhost()` (lazy one-time mesh build, parked), `startGhostReplay()`
(startRun hook: `loadGhost(WORLD_SEED)`, honor `?ghost=0`, show mesh),
`updateGhostReplay(dt)` (interpolate on `state.runTime`; write local coords
from true coords; ground with `groundHeightAt` + set `scale`; fade+popup at
the end), `hideGhost()` (setupNewGame), `ghostInfo()` (plain data:
`{ recording: n, replaying: bool, x, z, done }`). Only game.js imports this
module (the ascension.js pattern — no new cycles; ghost.js imports state,
constants, hiscores, characters, terrain, effects).
**Verify**: `npm run lint` → 0.

### Step 3: Wire game.js + overlay line + debug

`init()`: nothing (lazy build). `update()`: `tickGhostRecording(dt)` +
`updateGhostReplay(dt)` after the ascension tick (both no-op when idle).
`startRun()`: `startGhostReplay()`. `setupNewGame()`:
`resetGhostRecording(); hideGhost();`. `endGame()` in ui.js must NOT import
ghost.js (cycle law) — instead game.js wraps: the collect… no: endGame
lives in ui.js. Use the same field-signal pattern as ascension:
`finalizeGhostRecording()` is called from `updateGhostReplay`'s owner —
cleanest: game.js polls `state.gameActive` falling edge? Simpler and
deterministic: ui.js `endGame` sets `state.runEnded = true` (one new state
field, comment it); game.js `animate()` (which keeps running after
gameActive flips) checks it once, calls `finalizeGhostRecording()`, clears
it. Overlay: `index.html` one line after `#family-best`
(`<p class="tagline" id="ghost-line" style="display:none">RACING THE GHOST: <span id="ghost-distance">0</span>u</p>`);
`ui.js` `showStartOverlay` fills/hides it via `loadGhost(WORLD_SEED)`
(hiscores import already exists there). `main.js`: `ghostInfo` on debug.
**Verify**: `npx playwright test tests/smoke.spec.js tests/gameover.spec.js`
→ pass (no-ghost behavior unchanged).

### Step 4: The spec — `tests/ghost.spec.js`

Model on `tests/worldfun.spec.js` (seed-driven). Cases: (1) a run records —
`ghostInfo().recording` grows under `debug.advance`; (2) death persists the
ghost — read `localStorage['blocky.ghost.<seed>.v1']` shape; (3) a SECOND
run on the same seed replays — `ghostInfo().replaying === true`, ghost x/z
track the stored path (advance to a known sample time, compare within
tolerance); (4) a better run overwrites, a worse one doesn't; (5)
`?ghost=0` suppresses replay; (6) different `?seed=` shows no ghost; (7)
plateau: `perfInfo().geometries/textures` identical across two runs with a
ghost active (the one-time build is absorbed at first use — take the
baseline AFTER the first replay frame, the effects.spec warm-up pattern);
(8) recording caps: force `GHOST_MAX_SAMPLES` low? — cannot (constants are
build-time); instead drive ~70 game-seconds and assert `recording ≤
GHOST_MAX_SAMPLES` and the stored `interval ≥ GHOST_SAMPLE_INTERVAL`.
**Verify**: the new spec passes; then the FULL suite.

### Step 5: Docs

`readme.md`: a "Ghost runs" paragraph in the endless-world section (race
the stored best on any seed; one ghost per world; `?ghost=0` to hide).
`plans/README.md` row.
**Verify**: `npm test` → all pass.

## Done criteria (ALL must hold)

- [ ] `npm test` exits 0 (baseline + ≥8 ghost tests)
- [ ] `grep -n "localStorage" src/ghost.js` → no matches (storage lives in
      hiscores.js only)
- [ ] `grep -c "from './ghost.js'" src/*.js` → 1 (game.js only)
- [ ] Two consecutive runs with an active ghost hold the geometry/texture
      plateau (spec case 7)
- [ ] `plans/README.md` row 034 updated

## STOP conditions

- The plateau spec shows per-run growth — the ghost mesh/material is being
  rebuilt; stop and re-read the parked-mesh pattern.
- Any solo spec fails with NO ghost stored — the feature leaked into the
  bare path; stop.
- Storing a long run exceeds ~1MB serialized (localStorage pressure) —
  stop and report actual size; the interval-doubling parameters need
  retuning, not ad-hoc truncation.
- You need to touch `enemies.js` or any threat surface — you don't; stop
  and reconsider the design if it seems necessary.

## Maintenance notes

- 2P team ghosts and "beat the ghost" HUD deltas are explicitly deferred;
  the recorder's flat-array format has a `v` field for the schema bump.
- If plan 029's `ASCENSION_SCALE` changes, stored ghosts still replay
  correctly (they are pure kinematics); the `asc` marker only affects the
  end-of-path popup text.
- The daily seed rolls at midnight: `blocky.ghost.<seed>.v1` keys for old
  dailies linger — harmless (a few KB each); a future sweep could prune
  ghost keys whose seed matches `dailySeed()` format but not today. Do not
  build that now.
