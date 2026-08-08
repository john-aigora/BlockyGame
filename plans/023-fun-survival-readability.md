# Plan 023: Fun batch 1 — survival celebration, readability, adaptive music

> **Executor instructions**: Step-by-step; verify each. Feel items include a
> screenshot/recording gate. STOP conditions binding. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 128d18e..HEAD -- src/effects.js src/ui.js src/audio.js src/game.js src/characters.js src/state.js tests/tension.spec.js`

## Status

- **Priority**: P2 · **Effort**: M · **Risk**: LOW
- **Depends on**: 017; benefits from 020 (shadow diet) landing first
- **Category**: direction (game feel)
- **Planned at**: commit `128d18e`, 2026-07-31

## Why this matters

The audit's design analysis (DT-10, `plans/audit-2026-07-31.md`) found every
celebration fires on the ACQUISITION axis (eat/kill/grow) and nothing on the
SURVIVAL axis — escapes, near-misses, and time survived get zero feedback, and
the dread systems have no positive resolution. Separately, jump height is
illegible (no ground shadow — screenshots in the audit), and the music system
has a designed-but-unwired third intensity: `music.setIntensity(level)` accepts
a level and coerces it to 0/1 while `state.dangerOpacity` — a computed,
eased danger scalar — is consumed by nothing but the vignette.

## Current state

- `src/ui.js:345-383` `updateDangerPulse` — eases `state.dangerOpacity` toward
  `DANGER_VIGNETTE_MAX` when a non-killable enemy is within `DANGER_RADIUS = 9`;
  heartbeat at `:375-383` only while nothing is killable.
- `src/audio.js:233-235` — `setIntensity(level) { intensity = level ? 1 : 0; }`;
  `scheduleStep` (`:182-194`) reads `intensity` at exactly two sites (octave
  lift `:190`, off-beat hat `:193`); layer switches commit on bar lines (`:184`).
  The `sfx` map (`:64-114`) is the one-shot registry; `blip()` (`:49`) is the
  house synth. Title screen is SILENT (music starts only in `startRun`/unpause/
  unmute).
- `src/effects.js` generic kit: `spawnTextPopup(position, text, fillStyle)`
  (`:249`, pooled, camera-scaled); `spawnRing` (`:197`); `spawnBurst` (`:150`).
- `state.runTime` accumulates every frame (`src/game.js:259`) — consumed ONLY by
  tests. `state` has no `survivalShown`-style fields.
- Characters: no ground-contact shadow of any kind. Terrain material hook:
  `applyWorldBend(material)` (`src/terrain.js:104`) — one call makes a new
  world-space material honor the curved horizon. `groundHeightAt(x, z)` is the
  terrain height query (`src/terrain.js`, exported; used everywhere).
- Best-runs data for the start screen: `loadHiscores('endless')`
  (`src/hiscores.js:33`), distance-ranked.
- Reduced-motion policy: gate every new visual on the same flag effects.js uses
  (`src/effects.js:23`).

## Commands

`export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` · `npm test` ·
`npx playwright test tests/tension.spec.js --workers=1` · `npm run lint`

## Scope

**In scope**: `src/effects.js`, `src/ui.js`, `src/audio.js`, `src/game.js`,
`src/state.js`, `src/characters.js` (shadow quad build), `src/main.js` (debug
exposure), `index.html`/`style.css` (survival HUD line + ticker), `tests/tension.spec.js`.
**Out of scope**: enemy behavior, spawn systems (plan 024), scoring formulas.

## Git workflow

Run branch; `[<branch> · Batch N/M] <verb> <what>`; NEVER push.

## Steps

### Step 1: Blob shadows (UI-3)

In `src/characters.js`, build one shared radial-gradient canvas texture (dark
center → transparent) + shared `MeshBasicMaterial` (transparent, depthWrite
false, `applyWorldBend` applied). Each character group gets a `shadowQuad` child
tagged in `userData`, sized `1.3 × baseSize` on XZ, rotated flat. Per frame (in
the walk-anim update in `src/effects.js`, which already iterates player+enemies):
set quad world Y to `groundHeightAt(x, z) + 0.02` and scale/opacity by jump
height — `scale = 1 / (1 + jumpOffset*0.35)`, `opacity = 0.45 / (1 + jumpOffset*0.6)`
(player only; enemies never jump). Skip under reduced motion? NO — shadows are
static grounding, keep them always.
**Verify**: screenshots standing/mid-jump — shadow visibly detaches and shrinks
during the jump; `npx playwright test tests/effects.spec.js tests/toys.spec.js --workers=1`
green (geometry counts: ONE new shared geometry+texture at boot — if a pool
spec counts boot geometries, its warm-up baseline absorbs this).

### Step 2: "PHEW!" escape beat + near-miss (DT-10)

In `updateDangerPulse`: track `state.dangerPeak` (max dangerOpacity since it
last hit 0). When dangerOpacity returns to ≤0.01 while `gameActive` and
`dangerPeak > 0.15`: fire once — `spawnTextPopup(playerPos+up, 'PHEW!', '#8BC34A')`
+ new `sfx.phew()` (two-note falling-then-rising blip, compose per the
`blip` house style) — then reset the peak. Near-miss: in the enemy loop
(`src/enemies.js` collision section) when a NON-killable enemy's distance
enters < `1.5 × (playerRadius + enemyRadius)` and then exits without death,
fire `spawnTextPopup(..., 'CLOSE ONE!', '#FFC107')` + reuse `sfx.tick()`.
Rate-limit both: ≥6s game-time between fires (a `state.lastSurvivalBeat` clock).
**Verify**: new tension.spec case — drive an enemy near then away via direct
position writes; assert the popup pool shows the text (expose
`debug.effectsInfo().lastPopupText` — add that field) and no fire when a second
pass happens within 6s.

### Step 3: Survival time on the HUD

Add a small `TIME 0:47` element beside DISTANCE (`index.html` `#ui-container`,
match `.ui-element`); update from `state.runTime` in the existing HUD update
path with change-detection (whole seconds only). Every full minute:
`sfx.milestone()` + `spawnTextPopup(..., '1 MINUTE!', ...)` (reuse the distance-
milestone pattern at `src/game.js:472-483`).
**Verify**: smoke spec still green; new tension.spec assertion — after
`waitGameSeconds(2)`, the element shows `0:02`.

### Step 4: Danger music layer (CAP-5)

`src/audio.js`: `intensity` becomes 0|1|2. `setIntensity(level)` stores the
clamped integer. In `scheduleStep`: level ≥1 keeps today's behavior; level 2
ADDS a low held pad (one `note()` per half-bar, root octave down, gain ~0.05)
and doubles the bass note at the bar start. Drive it from `updateDangerPulse`:
`music.setIntensity(anyKillable ? 1 : (state.dangerOpacity > 0.12 ? 2 : 0))` —
CAREFUL: hunt layer (killable) keeps priority 1; danger layer only when no
prey (matching the heartbeat's "dread owns this channel" rule at
`src/ui.js:341-344`). Bar-line commits make this safe.
**Verify**: audio.spec green; new case — set `state.dangerOpacity` high with no
killable enemy, assert `debug.audioState().intensity === 2` (expose intensity in
the existing audioState debug object).

### Step 5: Title-screen warmth

On the start overlay only: quiet music bed — call `music.start()` from
`showStartOverlay` at HALF gain (add a `music.setVolume(f)` that scales the
existing gain nodes) and restore full gain in `startRun`. Requires a prior user
gesture for audio — the GATE unlock click counts; if `ctx.state` isn't running,
skip silently (no error). Add a `FAMILY BEST: <distance>u` line to the overlay
from `loadHiscores('endless')[0]`, hidden when empty.
**Verify**: gate→overlay flow in audio.spec: after gate submit, overlay shows;
if audio unlocked, `musicActive()` true at reduced volume field; START →
full volume. Family-best line renders seeded value (addInitScript seed).

## Test plan

Extend `tests/tension.spec.js` (Steps 2–4, ~5 cases) + 1 audio.spec case +
1 overlay case. Game-clock waits only. Full suite green.

## Done criteria

- [ ] `npm test` 0 failed · lint 0
- [ ] Screenshot pair: jump with detaching shadow (in run log)
- [ ] `debug.audioState().intensity` reflects 0/1/2 states
- [ ] PHEW/CLOSE-ONE rate-limited beats verified by spec
- [ ] `plans/README.md` updated

## STOP conditions

- Step 1's shared shadow texture breaks a pool-discipline spec even after
  warm-up baselining (report the count delta).
- Step 4 audibly glitches on layer transitions (bar-line rule violated) — check
  the `:184` commit guard before reworking.
- Step 5: if starting music pre-run requires gesture plumbing beyond the gate
  click, ship steps 1–4 and report Step 5 as blocked.

## Maintenance notes

- Plan 024's sprinter/juja add new species colors — their popups/sfx reuse this
  plan's primitives; keep `sfx` names generic (`phew`, not `escapeBeat2`).
- Plan 026 duplicates the HUD; the TIME element must be inside the per-player
  HUD block it creates.
