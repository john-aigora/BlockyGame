# Plan 026: Two-player split-screen — two views, two heroes, one world

> **Executor instructions**: This is the largest plan of the run. Execute the
> stages IN ORDER — each stage ends with the full suite green and solo play
> unchanged. Never proceed past a red stage. STOP conditions binding. Update
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 128d18e..HEAD -- src/ index.html style.css`
> This plan EXPECTS drift from plans 017-025 (they land first). The excerpts
> below describe `128d18e`; where a prior plan renamed something
> (CONTINUOUS_MOVEMENT from 022, moveVector from 019, per-pad edges from 018),
> use the landed name. If a whole subsystem looks different from both
> descriptions, STOP.

## Status

- **Priority**: P1 (owner-requested headline feature) · **Effort**: L · **Risk**: HIGH
- **Depends on**: 017 (green), 018 (multi-pad correctness), 019 (explicit
  hitboxes + clearTransientInput), 020 (render headroom — the frame renders
  twice), 022 item 1 (naming)
- **Category**: direction (feature)
- **Planned at**: commit `128d18e`, 2026-07-31

## Why this matters

Owner request, verbatim: "add a two player mode with two screens where the two
players can play at the same time." This is a father/son game; simultaneous
couch play is its natural form. The reference implementation for pad seating is
the sibling repo battle-paddle (its pad code started from BlockyGame's and
gained 2P seat claims): first MOVING pad claims seat 1, second claims seat 2,
claims keyed by `gamepad.index` never by id (dual DB9 adapters share id
strings), ghosts never claim (a claim requires real directional input).
Reference: `~/fun/battle-paddle/outputs/pong-game/index.html` (`seatClaims`,
`refreshTwoPlayerPadClaims`, ~lines 5325-5349 and the dev brief
`~/fun/battle-paddle/docs/atari-db9-dev-brief.md`).

## Design (decided — do not re-open mid-run)

- **Split**: one browser window, vertical split — P1 LEFT half, P2 RIGHT half,
  rendered with `renderer.setScissorTest(true)` + per-half `setViewport/
  setScissor`, one shared `THREE.Scene`, two cameras.
- **Players**: two hero characters in ONE shared world; both visible to each
  other; P2 gets a distinct palette (factory already parameterizes colors —
  `createCharacter`; `createPlayer` gains an options arg if plan 023/skins
  hasn't already added one).
- **Input seats**: keyboard always available — 2P on one keyboard = WASD (P1)
  vs Arrows (P2); pads claim seats battle-paddle-style (first pad with real
  directional input → P1 unless P1 keyboard-active this run, then P2; second
  live pad → the other seat). Jump: Space (P1) / ArrowDown+Up? NO — keyboard P2
  jump = Enter? Enter is pause. DECISION: P2 keyboard jump = `/` (Slash), P1 =
  Space; pad A jumps for its seat. Pause (P key, Start on any pad) pauses BOTH.
- **Rules per player**: own scale, score, collect clock (15s each), distance,
  jump state. Enemies target the NEAREST LIVING player. Edibility is
  per-player: before rendering each half, enemy body/cap colors are set for
  THAT viewer's edibility (two cheap color passes per frame at ≤12 enemies;
  materials are per-instance already). KILL!/danger/panic HUD per half.
- **Death**: first player to die becomes a spectator — their half shows their
  partner's camera with a `WAITING FOR <NAME>` chip; run ends when BOTH are
  dead → one death screen with both columns; the run records to a NEW coop
  board `blocky.hiscores.coop.v1` (`{p1Score, p2Score, teamScore, maxDistance,
  date}`, ranked by teamScore) and does NOT write the solo boards.
- **World services**: terrain/food/cloud streaming anchors on BOTH players
  (union of two chunk windows); enemy bubble maintained per player (target
  split, cap stays global at 12 + 4); floating-origin rebase triggers on the
  MIDPOINT of the two players crossing 2048 and shifts everything once (both
  players' positions included). Distance ramp uses the FURTHER player.
- **Mode entry**: start overlay gains `1 PLAYER` / `2 PLAYERS` buttons
  (`.mode-button` CSS), remembered in sessionStorage. Solo path must remain
  pixel-identical (single full-width viewport, no scissor).
- **Explicitly OUT of v1**: online play; horizontal split; >2 players; tether/
  rubber-band; per-player zoom (shared zoom level); daily-board interplay
  beyond "2P records coop only".

## Current state (at 128d18e — adjust for landed plans)

- `src/state.js` — SINGLETON fields: `player`, `playerScale`, `score`,
  `collectTimeLeft`, `jumpOffset/Velocity/Gravity/Airborne`, `camera`,
  `furthestDistance`, `movementVector`, `touchActive`, `comboCount`,
  `comboTimeLeft`, `dangerOpacity`, `heartbeatClock`, `lastShownCollectTime`.
- Consumers of `state.player` / `state.playerScale`: `game.js` (movement, jump,
  collect, progress), `enemies.js` (AI target, edibility `:58-71`, collision),
  `effects.js` (walk/glow/squash/arrow), `ui.js` (danger, indicators),
  `world.js` (camera follow `updateCamera`, zoom, attract), `terrain.js`
  (streaming anchor via calls from game.js), `collectibles.js`
  (spawnNearPlayer), `timers.js` (collect clock + panic).
- Camera: ONE `state.camera`; `world.js` owns follow/zoom/fog/attract; fog
  scales with camera distance (`world.js:308-313`).
- Renderer: created in `world.js:146-149`; `setSize` on resize; NO scissor use.
- HUD: single `#ui-container` block (`index.html:68-82`), single set of ids
  (`#score`, `#distance`, `#collect-time`, `#kill-indicator`, `#combo-chip`).
- Hiscores: per-mode keys + `sortBoard` (`src/hiscores.js:9-31`) — the coop
  board is a third key + branch (3-line pattern).
- Test handle: `window.__game.debug` (`src/main.js:17-51`); mock pads harness in
  tests (multi-pad capable after plan 018).

## Commands

`export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` · `npm test` ·
`npx playwright test tests/coop.spec.js --workers=1` · `npm run lint` · `npm run build`

## Scope

**In scope**: `src/state.js`, `src/game.js`, `src/world.js`, `src/enemies.js`,
`src/effects.js`, `src/ui.js`, `src/input.js`, `src/timers.js`,
`src/collectibles.js`, `src/terrain.js` (anchor union only), `src/clouds.js`
(anchor union only), `src/hiscores.js`, `src/characters.js` (palette arg),
`src/main.js`, `index.html`, `style.css`, new `tests/coop.spec.js`, `readme.md`.
**Out of scope**: `movement-continuous.js` (2P is stepwise-movement only);
`worldmath.js` internals; `public/original/`; audio synth internals (only the
intensity/proximity DRIVERS change); rumble (v1: rumble goes to each seat's own
pad on its own events — one line per site if trivial, else skip).

## Git workflow

Run branch; `[<branch> · Batch N/M] <verb> <what>`; NEVER push. Commit per stage.

## Stages

### Stage A: players[] refactor with solo unchanged

Introduce `state.players = [makePlayerState()]` where each entry owns:
`{ mesh, scale, score, collectTimeLeft, lastShownCollectTime, distanceBest,
jump: {offset, velocity, gravity, airborne}, camera, comboCount, comboTimeLeft,
dangerOpacity, heartbeatClock, alive, seat }`. Mechanically migrate every
singleton consumer to `state.players[i]` loops (or `for (const p of
alivePlayers())`). Keep TEMPORARY getters on `state` (`get player() { return
state.players[0].mesh; }` etc.) ONLY if a consumer can't migrate cleanly this
stage — and remove them by Stage F (done criterion greps them out).
Per-system notes:
- `timers.js`: tick every living player's clock; expiry kills THAT player
  (see Stage E for per-player death vs endGame).
- `enemies.js` edibility: `canKillSpecificEnemy(enemy, player)` gains a player
  arg; call sites pass the relevant player (collision loops per player).
  Targeting: nearest living player (worldmath distance).
- `effects.js` walk/glow/squash/arrow: loop players (the arrow targets each
  player's own nearest food — one arrow per player, pool a second).
- `ui.js` danger/indicators: computed per player; in solo, player 0 (identical
  output — verify).
**Verify**: FULL suite green with ZERO spec edits (solo behavior identical is
the contract of this stage). `npm test` twice.

### Stage B: split rendering

`world.js`: `createCameraFor(playerState)`; render path becomes
`renderView(playerState, viewportRect)` — set viewport+scissor, update that
camera's follow/zoom/fog, render. Solo: one full-rect call (scissor test OFF —
keep the exact current path when `players.length === 1` so solo is
bit-identical). 2P: left/right halves, aspect = (w/2)/h per camera, resize
recomputes both. Attract mode stays single-view (camera 0).
**Verify**: solo smoke + camera specs green; a temporary
`debug.startTwoPlayer()` (added now) shows two viewports — screenshot recorded;
`perfInfo().calls` in 2P ≈ 2× solo (note the number).

### Stage C: seats and input

Port battle-paddle seat claims into `src/input.js`: `seatClaims` array,
`refreshSeatClaims()` each poll — a pad claims the first open seat when its
deadzoned direction is non-zero; claims persist by `gamepad.index`; disconnect
vacates. Keyboard split (2P only): WASD → seat 0, Arrows → seat 1, Space →
seat 0 jump, Slash → seat 1 jump; pads override their seat's keyboard half
additively (same one-clamp rule from plan 019's `moveVector`, now per seat).
`clearTransientInput` clears per seat. Solo keeps today's merged behavior
exactly.
**Verify**: coop.spec — two mock pads drive the two players independently
(assert positions diverge as commanded); keyboard-only 2P moves both; solo
timing/touch specs green.

### Stage D: world services for two anchors

- Terrain/food/clouds: `updateTerrain` takes a list of anchor positions; the
  active set is the UNION of each anchor's window (dedupe by key; release only
  chunks outside ALL windows). Pool sizes: bump chunk/cloud pool caps to cover
  2× windows (constants, with comment).
- Enemy streaming: bubble target per player (each `ENDLESS_ENEMY_TARGET +
  ramp`), global cap `ENDLESS_ENEMY_CAP_COOP = 16`; despawn radius applies to
  the NEAREST player.
- Rebase: trigger when the players' MIDPOINT exceeds the threshold; shift both
  players + both cameras + everything current code shifts. Distance ramp: use
  `max(p.distanceBest)`.
**Verify**: coop.spec — teleport P1 +300u east and P2 −300u west, pump frames:
both halves show terrain (read `terrainInfo().activeKeys` covers both
neighborhoods); food exists near both; rebase test: walk midpoint past the
threshold via teleports and assert both players' coords shrank by the same
delta and `furthest` distances did not change. Solo endless specs green.

### Stage E: rules, HUD, death, board

- HUD: wrap the per-player readouts in two `.player-hud` blocks (CSS grid: two
  columns under the two halves); ids become classes with `data-seat` —
  UPDATE the specs that read `#score` etc. via a helper (`hudFor(page, seat)`)
  in `tests/helpers.js`; solo renders one block with the SAME ids as today
  (keep solo DOM stable — dual-mode markup, not a rename).
- Per-half KILL!/combo/danger: the Stage A per-player fields drive per-half
  elements; per-viewer enemy coloring: before each half's render, write
  body/cap color + aura for THAT player's edibility (12 enemies × 2 = trivial);
  restore is unnecessary (each pass sets all).
- Collect clocks: per player; panic arrow/tick per player (audio: tick fires if
  EITHER is in panic; heartbeat if either qualifies; music intensity = max of
  players' states).
- Death: clock-zero or contact kills THAT player: their mesh squashes (reuse
  onPlayerDeath parameterized), `alive = false`, their half switches to
  partner-cam + `WAITING` chip; enemies stop targeting them. Both dead →
  shared death screen: two columns (P1/P2 score+distance), coop board write
  (`blocky.hiscores.coop.v1`, rank by teamScore = p1+p2), `NEW BEST!` +
  confetti on rank 0. Restart returns to the overlay with the 1P/2P choice
  remembered.
**Verify**: coop.spec — kill P2 (force clock), assert P1 continues + WAITING
chip; kill P1 → death screen shows both scores; coop key written; solo boards
untouched (seed them first, assert unchanged). Solo gameover/hiscores specs
green.

### Stage F: entry UI + polish + docs

Start overlay `1 PLAYER` / `2 PLAYERS` buttons (sessionStorage
`blocky.playerCount`); pad A on the overlay starts the remembered mode; P2
palette (teal body `0x26C6DA`, matching shadow shades via `shadeColor`).
Remove any Stage A temporary getters. readme: a Two Players section
(controls table for both seats). Update `docs/elves/learnings.md` if a trap was
learned. Record 2P `perfInfo()` numbers in the run log.
**Verify**: full suite green ×2 including coop.spec (~10 cases); solo smoke
screenshot diff vs a pre-plan capture shows no layout change; `grep -rn "get player()" src/state.js` → none.

## Test plan

New `tests/coop.spec.js` (~10 cases listed in stages) + `hudFor` helper. All
seat/pad cases use the multi-pad mock from plan 018. Every stage also re-runs
the FULL suite — solo regressions are this plan's biggest risk.

## Done criteria

- [ ] `npm test` 0 failed ×2 (incl. coop.spec)
- [ ] Solo path: no spec edits needed in Stages A-B; DOM ids stable in solo
- [ ] 2P screenshot pair (both halves, divergent positions) in the run log
- [ ] Coop board written; solo boards untouched in 2P
- [ ] `perfInfo()` 2P numbers recorded; `npm run build` exit 0
- [ ] `plans/README.md` updated

## STOP conditions

- Stage A cannot reach full-green without editing >3 specs — the refactor is
  leaking behavior; report the diff of failing assertions.
- Stage B scissor rendering artifacts (bleed across halves) persist after
  verifying viewport+scissor are set together per pass.
- Per-viewer enemy coloring flickers in captures (a pass ordering bug) — fall
  back to nearest-player coloring behind a `COOP_SIMPLE_COLORS` constant and
  report.
- Rebase in Stage D moves the two players by DIFFERENT deltas in the test —
  stop immediately (world-integrity bug class).
- Frame time in 2P exceeds 2.4× solo `frameMsAvg` (something is rendering more
  than twice) — report perfInfo before continuing.

## Maintenance notes

- The players[] refactor is the foundation for pets (a third animated list),
  ghosts (a non-colliding player-like), and spectate features — keep
  `makePlayerState()` the single construction path.
- Deferred from v1 (do not sneak in): online, tether, per-player zoom,
  3-4 players (seat machinery generalizes; rendering needs a quad split).
- After this lands, plan 028 re-measures perf; instancing's value roughly
  doubles with two views.
