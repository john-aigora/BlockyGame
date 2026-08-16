# Plan 029: Ascension — give runaway growth a destination: a "going to heaven" ceremony that ends the run as a win

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c1ffd13..HEAD -- src/ tests/ index.html`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (owner-requested headline feature)
- **Effort**: L
- **Risk**: MED (touches the end-of-run path that five specs pin with exact text)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `c1ffd13`, 2026-08-14

## Why this matters

The owner reports the game's terminal failure mode directly: "the player gets
so large that there is an infinite loop where they get larger, and eat food,
and get larger, etc." The July audit proved the same thing arithmetically
(finding DT-7): growth is uncapped (`growthFactor = 0.1` per block, no
ceiling anywhere), but the speed payoff caps at scale 7.67
(`SPEED_GROWTH_CAP` 2.2 reached at `1 + 0.18·(s−1) = 2.2`), the jump
out-scales every rock, enemies scale WITH the player (bands are multiples of
player height), and terrain features become irrelevant — so past ~scale 8-10
the loop is pure inflation with no game left in it. DT-8 said the same about
the late game: "an endless mode with no late game."

This plan gives the loop a destination: at `ASCENSION_SCALE` the hero has
outgrown the world and **ascends** — a ~6.5-second scripted ceremony (beam of
light, golden rings, the hero rises spinning into the cloud layer, shrinks
into a star, bursts) that ends that player's run as a **win**, records the
board row with an ascension mark, and shows an "ASCENDED!" end screen instead
of "GAME OVER". In 2P, one hero can ascend while the partner plays on
(the existing spectator machinery), so the ceremony composes with co-op.

## Current state (verified excerpts — confirm each before editing)

All line numbers are at commit `c1ffd13`.

### Growth + the trigger site — `src/game.js:493-547` (collect loop inside `update(dt)`)

```js
// game.js:510-525 — growth happens ONLY here; milestone fires on whole-unit crossings
const prevScale = player.scale;
player.scale += growthFactor;
player.mesh.scale.set(player.scale, player.scale, player.scale);
...
if (Math.floor((player.scale + 1e-9) / MILESTONE_STEP) >
    Math.floor((prevScale + 1e-9) / MILESTONE_STEP)) {
    onGrowthMilestone(player.mesh.position, player.scale, player);
    sfx.milestone();
}
```

The movement loop that must skip an ascending hero (ceremony owns their
position) — `src/game.js:391-421`, endless branch:

```js
for (const player of state.players) {
    if (!player.alive || !player.mesh) continue;
    updateJumpPhysics(player, dt);
    ...
    p.y = groundHeightAt(p.x, p.z) + player.jump.offset;
}
```

`tryJump` (`src/game.js:568-581`) guards `!player.alive` but not ascension.
`applySpeedMultiplier` (`src/game.js:1028-1075`) excludes dead seats from the
enemy pace: `if (state.players.length >= 2 && state.gameActive && !p.alive) continue;`.
`updateEndlessProgress` (`src/game.js:707-757`) iterates `player.alive`
players for distance/regions/titan anchor. `setupNewGame`
(`src/game.js:183-309`) resets every per-player field at lines 189-198.

### Per-player state — `src/state.js:7-53` (`makePlayerState`)

Every per-hero field lives here (the file's own comment: "pets/ghosts/
spectators must build on this too"). `state.playerScale` etc. are delegate
accessors to `players[0]` (lines 105-145) — the spec-facing surface.

### End-of-run path — `src/ui.js:513-586`

```js
// ui.js:513-545 — killPlayer: per-player death; last death → endGame
export function killPlayer(player, reason) {
    if (!state.gameActive || !player.alive) return;
    let othersLiving = 0;
    for (const q of state.players) {
        if (q !== player && q.alive) othersLiving++;
    }
    if (othersLiving === 0) { endGame(reason, player); return; }
    player.alive = false;
    onPlayerDeath(player); // Squash flat + burst
    sfx.death();
    ...
    if (el.seatWaits[player.seat]) el.seatWaits[player.seat].style.display = 'block';
```

```js
// ui.js:547-586 — endGame: the ONLY legal run end; records boards, then
// death screen after DEATH_SCREEN_DELAY. Note sfx.death() + onPlayerDeath().
export function endGame(reason, dyingPlayer = state.players[0]) {
    ...
    music.stop();
    sfx.death();
    rumble(180, 0.7, dyingPlayer.seat);
    onPlayerDeath(dyingPlayer);
    ...
    ({ list, rank } = recordScore(state.score, state.worldMode, state.furthestDistance));
```

`showDeathScreen(reason, hiscores, rank, boardTitle)` is `ui.js:384-419`;
`renderHiscores(list, rank, boardTitle)` is `ui.js:425-455` and renders
endless rows as `` `${entry.distance}u — ${entry.score} pts — ${entry.date}` ``.

### The title element — `index.html:98-100`

```html
<div id="message-box" class="message-box">
    <h2 id="death-title">GAME OVER</h2>
    <p id="death-reason"></p>
```

**Five specs assert exact text** `toHaveText('GAME OVER')` on `#death-title`:
`tests/coop.spec.js:278`, `tests/gameover.spec.js:32,43`,
`tests/hiscores.spec.js:72`, `tests/smoke.spec.js:40`. All five are DEATH
flows. The repo invariant (CLAUDE.md): "Game-over message text always
contains 'GAME OVER'" — it binds death ends, and the swap below must restore
the exact string on every death show.

### Enemy threat surfaces — `src/enemies.js`

- `nearestLivingPlayer(pos)` (`enemies.js:141-153`) — THE targeting/anchor
  chooser (AI target, despawn anchor, bubble ownership): filters
  `!p.alive || !p.mesh`.
- Collision pass (`enemies.js:590-611`): `for (const p of state.players) {
  if (!p.alive || !p.mesh) continue; ... killPlayer(p, 'The enemy caught you.'); }`
- Kill-indicator / arrows / danger / near-miss all branch per player:
  `ui.js:883-927` (`player.alive &&` gate at 893), `ui.js:947-968`
  (indicator passes per seat, `player.alive && player.camera`),
  `ui.js:634-757` (`updateDangerPulse` skips `!player.alive`).
- `tickCollectClock` (`src/timers.js:34-75`) skips `!p.alive` and kills on
  expiry — an ascending hero must be exempt or the clock kills them
  mid-ceremony.

### Camera — `src/world.js:298-360` (`updateCameraForPlayer`)

The endless camera follows the TERRAIN under the player, deliberately NOT
vertical motion: `player.camAnchorY += ((p.y - player.jump.offset) - player.camAnchorY) * ...`
(line 313). A rising hero therefore exits the frame unless the ceremony adds
a gated lift. `state.zoomLevel` is shared; `cameraTargets` (248-254) applies
the growth pull-back `1 + (scale-1) * GROWTH_FRAME_FACTOR`.

### Effects toolkit — `src/effects.js` (pooled; nothing allocates after init)

- `spawnBurst(origin, opts)` (164), `spawnRing(origin, opts)` (211),
  `spawnTextPopup(position, text, fillStyle, player)` (264) — all pooled and
  rebase-shifted by `shiftActiveParticles` (1041).
- The per-seat lazily-hidden mesh pattern to copy for halo/beam: the panic
  food arrows — built ONCE in `initEffects` (`effects.js:140-153`), two
  meshes sharing one geometry + material, `visible = false` when idle.
- The staged-celebration pattern to copy for ceremony beats:
  `onNewBest`/`updateCelebration` (`effects.js:403-447`) — steps + clock
  advanced inside `updateEffects`, no timers.
- Death cinematic pattern: `onPlayerDeath`/`updateDeathFx`
  (`effects.js:349-401`) — a per-player timer field ticked every frame.
- `reducedMotion` is resolved once in `initEffects` (line 86) — mirror that;
  do NOT re-query `matchMedia` per frame.

### Audio — `src/audio.js`

House style: every effect is a `blip({freq, endFreq, type, dur, vol, delay})`
composition (`audio.js:58-71`); see `sfx.fanfare` (91-99) and
`sfx.milestone` (102). Music layers commit on bar lines;
`updateDangerPulse` is the single `music.setIntensity` driver — an ascending
player excluded from the danger loop naturally drops the intensity request.

### Boards — `src/hiscores.js`

`recordScore(score, mode = 'endless', distance = 0)` (111-127) builds
`{ score, date, distance }` rows; `loadHiscores` filters only on
`Number.isFinite(e.score)` (86) — **extra optional fields survive** the
round-trip, so an additive `asc` flag needs NO key version bump.
`recordCoopScore(p1Score, p2Score, maxDistance)` (38-54) likewise
(`Number.isFinite(e.teamScore)` filter).

### Debug handle — `src/main.js:20-88`

`window.__game.debug` exposes spawners, `advance: advanceGameTime`,
`effectsInfo`, `setPlayerCount`/`startTwoPlayer`, `seatInfo`. Add
`ascensionInfo` beside `effectsInfo`. Specs may only assert plain data —
never THREE objects (the file's own comment).

### Waiting chips — `index.html:59-60`

```html
<div class="waiting-chip coop-only" data-seat="0">WAITING FOR P2</div>
<div class="waiting-chip coop-only" data-seat="1">WAITING FOR P1</div>
```

`killPlayer` shows them with `style.display = 'block'` and NEVER writes
`textContent` today — the ascension settle will, so death must (re)write the
default string too (single-writer-per-show rule).

## Repo conventions that bind this plan

1. **Every tuning knob in the GAME BALANCE block** of `src/constants.js`
   with a rationale comment — nowhere else (CLAUDE.md invariant).
2. **constants.js stays Node-importable** — no unguarded browser globals at
   module scope (`src/constants.js:2-5`).
3. **Game time ≠ wall time**: the ceremony ticks on `dt` inside `update()`
   so pause freezes it; specs use `__game.debug.advance(seconds)`, never
   `waitForTimeout` (lint-banned in `tests/`).
4. **Pooled GPU resources**: halo/beam meshes are created once, parked with
   `visible = false` — `tests/effects.spec.js` and `tests/resources.spec.js`
   pin geometry/texture plateaus.
5. **Photosensitivity**: nothing may flash more than 3×/sec (WCAG 2.3.1).
   The ceremony's climax is ONE bloom. The existing kill-flash budget
   (1 Hz) is untouched.
6. **Reduced motion**: screen-space motion (camera lift, the white-out
   feel) is skipped under `prefers-reduced-motion`; object motion (rise,
   particles, halo bob) stays — same split `effects.js` already applies.
7. **Solo behavior below the threshold must be byte-stable** — every new
   branch keys off `player.ascension` / `player.ascended` being falsy, and
   the full 154-test suite green is the regression gate.
8. **No per-frame allocation** in hot paths — scratch objects at module
   scope (`milestoneOrigin` in game.js is the pattern).

## Commands you will need

Every shell first: `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"`

| Purpose | Command | Expected on success |
|---|---|---|
| Lint | `npm run lint` | exit 0 |
| Full suite | `npm test` | 154 baseline + new ascension tests, all pass (~8-9 min; NEVER run two suites at once) |
| One spec | `npx playwright test tests/ascension.spec.js` | all new tests pass |
| Build | `npm run build` | "built in …ms", exit 0 |
| Node-import check | `node --input-type=module -e "import('./src/constants.js').then(m=>console.log(m.ASCENSION_SCALE))"` | prints `10` |

## Scope

**In scope (the only files you may modify/create):**
- `src/constants.js` (GAME BALANCE additions)
- `src/state.js` (`makePlayerState` field)
- `src/ascension.js` (NEW — the ceremony module)
- `src/game.js` (trigger + tick + guards + reset)
- `src/ui.js` (`endGame`/`showDeathScreen`/`killPlayer`-adjacent settle, chip text, board-row prefix, threat-surface gates)
- `src/enemies.js` (ONLY the `nearestLivingPlayer` filter + collision-pass skip)
- `src/timers.js` (collect-clock exemption)
- `src/world.js` (gated camera lift in `updateCameraForPlayer`)
- `src/audio.js` (two new `sfx` entries)
- `src/hiscores.js` (optional `asc`/`ascCount` row fields)
- `src/main.js` (debug handle entry)
- `tests/ascension.spec.js` (NEW)
- `readme.md`, `CLAUDE.md` (docs — last step)
- `plans/README.md` (status row)

**Out of scope (do NOT touch):**
- `src/movement-continuous.js` — the `?move=continuous` spike; the trigger is
  gated OFF under it (see Step 3) and the spike's fate is a separate owner
  decision.
- `src/characters.js`, `src/terrain.js`, `src/collectibles.js`,
  `src/worldmath.js`, `src/gate.js`, `public/original/` (byte-frozen),
  `index.html`, `style.css` (no markup/CSS changes are needed — title and
  chip text are set via JS).
- Board RANKING rules (`sortBoard`) — ascension marks rows, never re-ranks.
- The five existing `#death-title` assertions — they must pass unchanged.

## Git workflow

- Branch: `feat/029-ascension` off `main`.
- Commit per step (or per pair of small steps); message style matches the
  repo log: imperative summary line, e.g. `Add ascension constants and per-player state`.
- Do NOT push or open a PR unless the operator instructed it.

## Design (locked — implement as specified)

- **Trigger**: on collect, when `player.scale >= ASCENSION_SCALE` (10.0 =
  the 90th block), endless mode only, not under `CONTINUOUS_MOVEMENT`, not
  already ascending. Growth happens only on collect, so the check lives in
  the collect handler.
- **Foreshadow**: crossing `ASCENSION_FORESHADOW_SCALE` (9.0) attaches a
  golden halo above the hero (gentle bob+spin) and fires one popup
  `THE SKY AWAITS...` + `sfx.milestone()`. The halo warns the run is about
  to crown — ascension must never feel like a rug-pull.
- **Ceremony (game-clock, ~6.5 s, per player)**, phases inside
  `player.ascension = { phase, t, baseY, rise, spin }`:
  1. **LIFT** (`ASCENSION_LIFT_TIME` 2.2 s): beam of light (additive
     cylinder, tall as `ASCENSION_RISE_HEIGHT + 4`) scales in around the
     hero; a gold `spawnRing` at the feet; popup `ASCENSION!` in gold;
     `sfx.ascend()` starts; enemies stand down (see exclusions). Hero
     rises the first ~15% of the height, slow spin starts.
  2. **RISE** (`ASCENSION_RISE_TIME` 2.8 s): hero rises to
     `ASCENSION_RISE_HEIGHT` (14 u — into the cloud band, 12-18 u) on an
     ease-in curve, spinning; a small gold `spawnBurst` sparkle trail every
     0.25 s (pooled); camera lift branch tilts up (skipped under reduced
     motion).
  3. **STARBURST** (`ASCENSION_BURST_TIME` 1.5 s): the hero mesh scale eases
     to ~0.05 (shrinks into a star — avoids touching shared materials for
     opacity), then ONE mega `spawnBurst` (white→gold) + `sfx.ascendBurst()`
     + popup `+${ASCENSION_BONUS} ASCENDED!`; `player.score += ASCENSION_BONUS`;
     beam and halo hide; mesh `visible = false`.
  4. **Settle**: `player.ascension = null`, `player.ascended = true`. If
     another player is still `alive` → spectator bookkeeping WITHOUT death
     juice: `player.alive = false`, combo cleared, seat vignette zeroed,
     `applySpeedMultiplier()` (drop their mult from enemy pace), waiting
     chip shown with text `ASCENDED — WATCHING P2` (or P1). If nobody else
     is alive → `endGame(reason, player, { ascended: true })` with reason
     `You grew beyond this world.` (In 2P, when the LAST undone player dies
     or ascends, the normal `endGame` runs; the team screen shows.)
- **During the ceremony** the player is untargetable, uncollidable,
  unkillable, unsteerable, exempt from the collect clock, and contributes
  nothing to danger/arrows/kill-indicator; their own half (2P) keeps
  rendering THEIR camera (they are still `alive` — the spectator swap in
  `renderFrame` keys off `alive`, which flips only at settle). When the
  ascending player is the LAST active one, also `clearPendingSpawns()` at
  ceremony start (no monster materializes through the holy beat; the
  function already exists and is restart-safe).
- **End screen**: `showDeathScreen` gains an `ascended` flag; it sets
  `#death-title` to `ASCENDED!` when true and — critically — to exactly
  `GAME OVER` when false (explicit restore; a later death must never inherit
  the ascension title). Board rows carry `asc: true` (solo/daily) or
  `ascCount: 1|2` (coop); `renderHiscores` prefixes `✦ ` to marked rows.
  Ranking rules untouched.
- **endGame ascension variant** skips `sfx.death()`, the death `rumble`, and
  `onPlayerDeath()` (the hero already left in light), and passes the flag to
  `showDeathScreen` + the recorders. Everything else (music stop, resets,
  board recording, DEATH_SCREEN_DELAY) is identical.

## Steps

### Step 1: Constants + per-player state

`src/constants.js`, inside the GAME BALANCE block (keep Node-importable —
plain numbers only), with rationale comments in the file's house style:

```js
// --- Ascension (plan 029, audit DT-7/DT-8): growth's destination ---
// Uncapped growth had no endgame: past the speed cap (scale 7.67) size only
// cost. At ASCENSION_SCALE the hero has outgrown the world and ASCENDS — a
// scripted ceremony ends the run as a win. Solo play below the threshold is
// byte-identical.
export const ASCENSION_SCALE = 10;            // 90th block — the crowning size
export const ASCENSION_FORESHADOW_SCALE = 9;  // Halo + "THE SKY AWAITS..." warn the crown is near
export const ASCENSION_BONUS = 500;           // Crowning payout — bigger than any single titan beat
export const ASCENSION_RISE_HEIGHT = 14;      // Rise into the cloud band (12-18u)
export const ASCENSION_LIFT_TIME = 2.2;       // Beam + first lift
export const ASCENSION_RISE_TIME = 2.8;       // The climb
export const ASCENSION_BURST_TIME = 1.5;      // Shrink-to-star + burst
```

`src/state.js` in `makePlayerState`: add `ascension: null,` (transient
ceremony state) and `ascended: false,` (sticky for the end screen/boards)
next to the `alive` field, with one-line comments.

**Verify**: the Node-import check command → prints `10`; `npm run lint` → 0.

### Step 2: The ceremony module `src/ascension.js`

New file. Imports: `constants`, `state`, `effects` (`spawnBurst`,
`spawnRing`, `spawnTextPopup`), `audio` (`sfx`), `terrain`
(`groundHeightAt`), `ui` (`endGame`, plus the settle helpers you add in
Step 5), `three`. **game.js is the ONLY module that imports ascension.js**
(no ui.js→ascension or enemies.js→ascension edges — other modules read the
`player.ascension` FIELD, never the module; this keeps the import graph
acyclic).

Contents:
- Module-scope shared resources, foodArrows pattern: ONE
  `THREE.TorusGeometry(0.55, 0.09, 8, 24)` halo geometry + ONE additive gold
  `MeshBasicMaterial` (`transparent: true, depthWrite: false`); ONE
  open-ended `THREE.CylinderGeometry(1.4, 1.8, 1, 16, 1, true)` beam
  geometry + ONE additive pale-gold material (`opacity ~0.28`,
  `side: THREE.DoubleSide, depthWrite: false`). Two halo meshes + two beam
  meshes (one per seat), built in `initAscensionFx()` (called from game.js
  `init()` after `initEffects()`), added to the scene `visible = false`.
  Beams are scene children (NOT mesh children — the star-shrink would scale
  a parented beam); their positions are re-copied from the hero every frame,
  which also makes rebase shifts automatic.
- `resolveReducedMotion()` once at init (matchMedia, the effects.js pattern).
- `maybeForeshadow(player, prevScale)` — crossing-detector like the
  milestone block; shows that seat's halo and fires the popup+jingle once
  per run (`player.ascension === null && !player.ascended` guard plus a
  per-seat shown flag reset in `resetAscension`).
- `maybeBeginAscension(player)` — the trigger guard chain
  (endless, not CONTINUOUS_MOVEMENT, `!player.ascension && !player.ascended
  && player.alive && player.scale >= ASCENSION_SCALE`); on fire: build
  `player.ascension = { phase: 'lift', t: 0, baseY: groundHeightAt(x, z),
  rise: 0, spin: 0, trailClock: 0 }`, zero that player's
  `dangerOpacity`/`dangerPeak`, show beam+halo, gold ring + `ASCENSION!`
  popup + `sfx.ascend()`; if no OTHER player is `alive && !ascension`,
  `clearPendingSpawns()` (import from enemies.js — this edge is fine:
  ascension→enemies has no reverse edge).
- `updateAscension(dt)` — for each player with `.ascension`: advance
  `t`; per phase set `rise` (ease-in), `spin`; write
  `mesh.position.y = a.baseY + a.rise` and `mesh.rotation.y = a.spin`;
  halo follows above the head; beam follows at `baseY`; sparkle trail on
  `trailClock` every 0.25 s during RISE; STARBURST eases `mesh.scale`
  toward `player.scale * 0.05` (write all three axes — the walk/squash
  systems are excluded because updateEffects' per-player loops check
  `mesh.visible`… they do NOT — so ALSO zero `squashTime`/`pulseTime` at
  begin and accept the walk system reading a stationary mesh: legs settle
  on their own since XZ never moves); at burst end fire the mega burst +
  bonus popup + `player.score += ASCENSION_BONUS` + `updateScoreDisplay()`
  (import from ui.js), hide beam/halo, `mesh.visible = false`,
  `mesh.rotation.y = 0`, restore `mesh.scale` to `player.scale` (invisible;
  prevents a stale tiny scale leaking into the next run before
  setupNewGame's own restore), then settle (Step 5's helper or `endGame`).
- `resetAscension()` — for every player: `ascension = null`,
  `ascended = false`, hide halo/beam, reset foreshadow-shown flags. Called
  from `setupNewGame`.
- `ascensionInfo()` — plain data for specs:
  `{ seats: state.players.map(p => ({ active: !!p.ascension, phase: p.ascension?.phase ?? null, ascended: p.ascended, rise: p.ascension?.rise ?? 0 })) }`.

**Verify**: `npm run lint` → 0 (the file parses; unused-import errors guide
wiring gaps).

### Step 3: Wire game.js — trigger, tick, guards, reset

1. Import `{ initAscensionFx, maybeBeginAscension, maybeForeshadow,
   updateAscension, resetAscension }` from `./ascension.js`.
2. `init()`: call `initAscensionFx()` right after `initEffects()`.
3. Collect handler: immediately after the milestone `if` block
   (`game.js:521-525`), add `maybeForeshadow(player, prevScale);` and
   `maybeBeginAscension(player);` (order: foreshadow first so a single
   collect crossing both thresholds still pops the halo before the beam).
4. `update(dt)`: after `tickComboClock(dt);` add `updateAscension(dt);`
   (runs behind the pause/gameActive gates — the clock law for free).
5. Movement loop (both the endless branch at 391 and the classic branch at
   427): change the skip to
   `if (!player.alive || !player.mesh || player.ascension) continue;`.
6. `tryJump`: add `|| player.ascension` to the reject chain (`game.js:573`).
7. `applySpeedMultiplier`: extend the enemy-mult exclusion to
   `if (state.players.length >= 2 && state.gameActive && (!p.alive || p.ascension)) continue;`.
8. `updateEndlessProgress`: skip ascending players
   (`if (!player.alive || !player.mesh || player.ascension) continue;`) —
   frozen heroes set no records and must not anchor the titan.
9. `setupNewGame`: in the per-player reset loop add `p.ascension = null;
   p.ascended = false;` AND call `resetAscension()` next to
   `resetEffects()` (both are idempotent; the field reset keeps the loop
   self-documenting, the module call parks the meshes).

**Verify**: `npm run lint` → 0;
`npx playwright test tests/smoke.spec.js tests/gameover.spec.js` → pass
(below-threshold behavior unchanged).

### Step 4: Threat-surface exemptions

1. `src/enemies.js` `nearestLivingPlayer` (141-153): skip line becomes
   `if (!p.alive || !p.mesh || p.ascension) continue;` — this single edit
   removes the ascending hero from AI targeting, despawn anchoring, and
   bubble ownership at once. (In solo ceremony `updateEnemies` then hits
   `if (!target) return;` — enemies freeze in place and "watch"; accepted.)
2. `src/enemies.js` collision pass (~592): the per-player loop's skip
   becomes `if (!p.alive || !p.mesh || p.ascension) continue;` (both the
   box-refresh loop at 428-430 and the contact loop).
3. `src/timers.js` `tickCollectClock` (~39): `if (!p.alive || p.ascension) continue;`.
4. `src/ui.js` `updateDangerPulse` (~639): `if (!player.alive || !player.mesh || player.ascension) continue;`.
5. `src/ui.js` `updateKillIndicator` coop branch (~894): the per-seat gate
   becomes `player.alive && !player.ascension && state.enemies.some(...)`;
   solo branch needs no change (solo ceremony ends the run — but guard it
   anyway via the same condition on seat 0 for consistency:
   `const anyEnemyKillable = !state.players[0].ascension && state.enemies.some(...)`).
6. `src/ui.js` `updateOffscreenIndicators` coop branch (~955): route the
   ascending seat to `hideIndicatorRange` by extending the condition to
   `player.alive && !player.ascension && player.camera`. Solo: wrap the
   final `updateIndicatorsForView(...)` call in
   `if (state.players[0].ascension) { hideIndicatorRange(0, MAX_ENEMY_INDICATORS); } else { ... }`.

**Verify**: `npx playwright test tests/coop.spec.js tests/tension.spec.js`
→ pass (no behavioral change while `ascension` is null everywhere).

### Step 5: End wiring in ui.js + hiscores.js + world.js camera lift

1. `src/ui.js` — add an exported `settleAscendedPlayer(player)` used by
   ascension.js when a partner is still alive: sets `player.alive = false`,
   zeroes combo (`comboCount/comboTimeLeft` + `hideComboChip(player)`),
   zeroes that seat's vignette (the killPlayer pattern, ui.js:541-544),
   calls `applySpeedMultiplier()`, shows the seat's waiting chip with
   `chip.textContent = player.seat === 0 ? 'ASCENDED — WATCHING P2' : 'ASCENDED — WATCHING P1'`.
   In `killPlayer`, before `style.display = 'block'`, set the chip text to
   its default (`'WAITING FOR P2'` / `'WAITING FOR P1'`) so a death after a
   prior run's ascension shows the right label (single writer per show).
2. `endGame(reason, dyingPlayer, { ascended = false } = {})`: when
   `ascended`, skip `sfx.death()`, `rumble(...)`, and
   `onPlayerDeath(dyingPlayer)` (music.stop() and every reset stay); pass
   the flag through: solo `recordScore(state.score, state.worldMode,
   state.furthestDistance, ascended)` (and the daily re-record likewise);
   coop `recordCoopScore(p1.score, p2.score, state.furthestDistance,
   ascendedSeatCount)` where `ascendedSeatCount =
   state.players.filter(p => p.ascended).length`; store the flag in a local
   and hand it to `showDeathScreen(reason, list, rank, boardTitle, ascended)`.
   NOTE: in 2P the run may end by the PARTNER's death after an ascension —
   `endGame`'s `ascended` option reflects the FINAL end's cause, but the
   coop `ascCount` counts `p.ascended` seats regardless; the title shows
   `ASCENDED!` only when the final end was an ascension OR any seat
   ascended (`ascended || ascendedSeatCount > 0`) — a team run containing an
   ascension IS a crowned run.
3. `showDeathScreen(..., ascended = false)`: first line sets
   `document.getElementById('death-title')` — no; cache it: add
   `el.deathTitle` to the `el` map + `initUI` (`ui.js:19-127` pattern), then
   `el.deathTitle.textContent = ascended ? 'ASCENDED!' : 'GAME OVER';`.
4. `renderHiscores`: prefix marked rows —
   `const mark = (entry.asc || entry.ascCount > 0) ? '✦ ' : '';` and
   prepend `mark` to each of the three text branches.
5. `src/hiscores.js`: `recordScore(score, mode = 'endless', distance = 0,
   asc = false)` adds `if (asc) entry.asc = true;`;
   `recordCoopScore(p1Score, p2Score, maxDistance, ascCount = 0)` adds
   `if (ascCount > 0) entry.ascCount = ascCount;`. Loaders are already
   permissive (verified) — no read-side change.
6. `src/world.js` `updateCameraForPlayer`: after the `followY` computation
   (~314), add the gated lift:

```js
const asc = player.ascension;
if (asc && shakeEnabled) { // shakeEnabled === !reducedMotion, resolved in createWorld
    // Ceremony lift: the camera rises at a third of the hero's rise and
    // tilts up at two thirds — the departure stays framed, the ground
    // stays referenced. Zero effect when no ceremony is active.
    camYpos += asc.rise * 0.35;
}
player.camera.position.set(camX, camYpos, camZpos);
if (state.worldMode === 'endless') {
    player.camera.lookAt(lookTarget.set(p.x, followY + (asc && shakeEnabled ? asc.rise * 0.65 : 0), p.z));
}
```

Match the surrounding code exactly — the excerpt above shows the INTENT;
integrate it into the existing `position.set`/`lookAt` lines rather than
duplicating them.

**Verify**: `npm run lint` → 0; `npx playwright test tests/hiscores.spec.js
tests/gameover.spec.js tests/coop.spec.js` → pass.

### Step 6: Audio

`src/audio.js`, two `sfx` entries in house style (blip compositions only):

```js
// Ascension (plan 029): a long rising C-major climb into held light —
// deliberately the BIGGEST jingle in the game; the run just crowned.
ascend: () => {
    [261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        blip({ freq: f, dur: 0.14, vol: 0.15, delay: i * 0.16 }));
    blip({ freq: 1046.5, type: 'triangle', dur: 1.6, vol: 0.10, delay: 1.15 });
    blip({ freq: 1318.5, type: 'sine', dur: 1.6, vol: 0.08, delay: 1.15 });
},
// The starburst: one bright chord + a long high shimmer tail.
ascendBurst: () => {
    [1046.5, 1318.5, 1568].forEach((f) => blip({ freq: f, dur: 0.5, vol: 0.12 }));
    blip({ freq: 2093, endFreq: 3136, type: 'sine', dur: 0.9, vol: 0.06, delay: 0.1 });
},
```

**Verify**: `npx playwright test tests/audio.spec.js` → pass.

### Step 7: Debug handle

`src/main.js`: import `ascensionInfo` from `./ascension.js` and add
`ascensionInfo,` beside `effectsInfo`.

**Verify**: `npm run build` → exit 0.

### Step 8: The spec — `tests/ascension.spec.js`

Model the file on `tests/species.spec.js` / `tests/coop.spec.js` structure
(gate bypass + start via `tests/helpers.js`; time via
`__game.debug.advance`). Cases (each `test(...)`):

1. **No trigger below threshold** (solo regression): set
   `__game.state.playerScale = 9.5` (delegate writes players[0].scale),
   spawn food on the player (`debug.spawnAtPosition`), advance until
   collected; assert `ascensionInfo().seats[0].active === false` and score
   grew by 1 (normal collect).
2. **Foreshadow**: scale 8.95 → collect → `effectsInfo().lastPopupText ===
   'THE SKY AWAITS...'`.
3. **Trigger + invulnerability**: scale 9.95 → collect → `active === true`,
   `phase` is `'lift'`; then `debug.spawnSpecies('grunt', px, pz, 20)` (a
   giant ON the player) + `advance(1)` → `state.gameActive === true`
   (contact ignored), collect clock exempt (`advance(16)` in steps while
   active — game still active mid-ceremony… note total ceremony is 6.5 s, so
   instead assert: `advance(3)` twice and check `collectTimeLeft` never
   killed the run before settle).
4. **Completion (solo)**: after the trigger, `advance(8)` →
   `state.gameActive === false`; `#death-title` has text `ASCENDED!`;
   `#death-reason` contains `beyond this world`; board row: `page.evaluate`
   reads `localStorage['blocky.hiscores.endless.v1']` → top entry has
   `asc === true`; score includes the +500 bonus.
5. **Death restores the title**: restart (`restart-button`), die normally
   (advance past the collect clock), assert `#death-title` text is exactly
   `GAME OVER` (the invariant, post-swap).
6. **2P — partner plays on**: `startTwoPlayer`, start run, set
   `players[1].scale = 9.95` via evaluate on the state handle, collect on
   P2, `advance(8)` → `gameActive === true`, `players[1].alive === false`,
   `ascended === true`, seat-1 waiting chip visible with text containing
   `ASCENDED`; then run out P1's clock (`advance(16)`) → team screen,
   title `ASCENDED!` (crowned team run), coop row `ascCount === 1`.
7. **Pause freezes the ceremony**: trigger, `advance(1)`, read
   `ascensionInfo().seats[0].rise`, toggle pause via the button, wait 500 ms
   wall-clock is FORBIDDEN — instead assert immediately after pause that
   two consecutive reads of `rise` across a `page.waitForTimeout`-free
   round-trip are equal (two sequential `page.evaluate` reads suffice —
   the rAF loop runs but update() is pause-gated), then unpause and
   `advance(1)` → `rise` increased.

**Verify**: `npx playwright test tests/ascension.spec.js` → all pass. Then
the FULL suite: `npm test` → everything passes (~160 tests). Never run the
suite while another suite is running.

### Step 9: Docs

1. `readme.md`: add an **Ascension** bullet to "How to play" (grow to scale
   10 — the 90th block — and the run crowns itself: ceremony, +500, a ✦ row
   on the board) and a line in the endless-world paragraph.
2. `CLAUDE.md`: under Invariants, amend the game-over line: the message
   element is swapped per show — death shows ALWAYS restore exactly
   "GAME OVER"; the ascension end shows "ASCENDED!" (spec-pinned).
3. `plans/README.md`: status row → DONE with a one-line summary.

**Verify**: `npm run lint` → 0; `git status` shows only in-scope files.

## Test plan (summary)

New file `tests/ascension.spec.js` (7 cases above) modeled on
`species.spec.js`; regression = the untouched 154-test baseline, especially
`smoke/gameover/hiscores/coop` (exact `GAME OVER` assertions) and
`effects/resources` (pool plateaus — halo/beam must be boot-created).
Full-suite green is the done gate.

## Done criteria (ALL must hold)

- [ ] `npm run lint` exits 0; `npm run build` exits 0
- [ ] `npm test` exits 0 — 154 baseline tests + ≥7 new ascension tests
- [ ] `node --input-type=module -e "import('./src/constants.js').then(m=>console.log(m.ASCENSION_SCALE))"` prints 10
- [ ] `grep -n "ASCENSION" src/constants.js` shows all 7 knobs in the GAME BALANCE block
- [ ] `grep -rn "waitForTimeout" tests/ascension.spec.js` returns nothing
- [ ] `git status` — no files outside the in-scope list modified
- [ ] `plans/README.md` row 029 updated

## STOP conditions

- Any of the five exact-text `GAME OVER` assertions fails after your title
  change — the restore path is wrong; stop and report rather than editing
  those specs.
- `tests/effects.spec.js` or `tests/resources.spec.js` report geometry/
  texture growth — the halo/beam are being created per-run or per-ceremony;
  stop and re-read the foodArrows pattern.
- The ceremony advances while paused (spec case 7 fails on the frozen
  read) — the tick is outside `update()`'s pause gate; stop and re-wire.
- You find `killPlayer`/`endGame` signatures already changed vs the
  excerpts (drift) — stop and report.
- Implementing the camera lift requires editing `renderFrame` or fog code —
  it must not; stop and report if the framing cannot be achieved inside
  `updateCameraForPlayer`.

## Maintenance notes

- **Ghost runs / skins / pets** (the planned next fun wave) key off
  `makePlayerState` — the new `ascended`/`ascension` fields are part of that
  contract now; a ghost must never trigger ascension (guard: ghosts should
  not run the collect handler).
- The `asc` board field is additive; if a future schema bump lands, carry it.
- `ASCENSION_SCALE` is THE tuning lever: raise it if family runs crown too
  fast, lower toward 8 if reaching it feels like a slog. The foreshadow
  scale should track roughly one MILESTONE_STEP below it.
- If per-player zoom ever ships, revisit the camera-lift factors (0.35/0.65)
  which assume the shared-zoom framing.
- Reviewer scrutiny: the threat-surface exemptions (Step 4) are six small
  edits — a missed one shows up as a mid-ceremony death or a lying arrow;
  the spec's invulnerability case covers contact and clock but NOT arrows —
  eyeball those two gates in review.
