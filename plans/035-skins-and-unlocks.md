# Plan 035: Hero skins with milestone unlocks — earned palettes, one cycling button

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. On
> any STOP condition, stop and report. When done, update the status row in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c1ffd13..HEAD -- src/characters.js src/game.js src/ui.js src/hiscores.js index.html style.css tests/`
> Plans 029–034 may have landed (029 adds the `asc` board field this plan's
> top unlock reads — soft dependency). Compare excerpts; unexplained
> mismatch = STOP.

## Status

- **Priority**: P3 (fun wave)
- **Effort**: S-M
- **Risk**: LOW-MED (touches hero-mesh creation; the resource-plateau specs
  and the P2-teal contract must hold)
- **Depends on**: none hard; the top unlock reads plan 029's `asc` field if
  present (degrade gracefully when absent)
- **Category**: direction
- **Planned at**: commit `c1ffd13`, 2026-08-14

## Why this matters

The July capability map (CAP-3) called this out: `createCharacter`
parameterizes body color completely, the material cache makes a new palette
cost exactly three cached materials, and `createPlayer` already takes a
color override — P2's teal IS the skin system with one hardcoded caller.
Milestone-unlocked palettes give the family a progression axis that isn't a
number: "I unlocked Midnight at 1000u" is a reason for one more run, and an
ascension-exclusive skin gives plan 029's crown a lasting trophy.

## Design (locked)

- **Palettes** (a look, not balance → they live in `src/characters.js`
  beside `FOOT_SHADE`/`CAP_LIGHTEN`; the UNLOCK THRESHOLDS are progression
  knobs → `src/constants.js` GAME BALANCE):
  - `ember` — `0xFF4500` (the classic hero orange-red; always unlocked, the default)
  - `lime` — `0x9CCC65` (unlock: any endless run ≥ 500u)
  - `midnight` — `0x5C6BC0` (unlock: any endless run ≥ 1000u — you met the titan)
  - `gold` — `0xFFC107` (unlock: any board row with a score ≥ 1000)
  - `celestial` — `0xB39DDB` (unlock: any ascended run — a board row with
    `asc === true`; hidden from the cycle entirely until plan 029 exists
    AND a row qualifies)
- **Unlocks are DERIVED, not stored**: computed at boot/overlay-show by
  scanning the endless + daily boards via `loadHiscores` (rows carry
  `distance`, `score`, and `asc`). No new unlock storage means nothing to
  migrate and nothing to cheat-edit beyond what the boards already are.
  (Consequence, documented: clearing browser storage clears skins WITH the
  boards — coherent family semantics.)
- **Selection persists** in `blocky.skin.v1` (a single id string) —
  read/written ONLY via `src/hiscores.js` (the storage owner), falling back
  to `ember` when missing/invalid/locked.
- **UI: ONE cycling button** on the start overlay in the existing
  `#mode-picker` row, exactly the established `.mode-button` +
  Speed-button-cycle pattern: `SKIN: EMBER →` clicks through UNLOCKED
  palettes only. No swatch grids, no pills — one labeled button, matching
  the repo's own controls. Locked palettes are simply absent from the
  cycle; when something new unlocks, the button label gains a `· NEW`
  suffix once (until cycled).
- **Seat scope**: seat 0 only. P2 keeps the teal contract
  (`P2_BODY_COLOR`) — the two heroes must stay tellable-apart, and teal is
  P2's identity. If the selected P1 skin ever equals teal (it can't — teal
  is not in the table; keep it that way), the design is wrong.
- **Applying a skin** rebuilds the hero mesh on the start overlay only
  (never mid-run): `scene.remove(old mesh)`, `createPlayer(p, { bodyColor })`,
  re-ground. All palette materials come from the shared color cache — the
  FIRST use of each new palette allocates its 3 shaded materials
  (body/cap/foot) once for the app's lifetime; meshes reuse cached
  geometry. The resource specs' warm-up baselines absorb one-time
  allocations; per-cycle churn must be zero after each palette's first use.

## Current state (verified excerpts, at `c1ffd13`)

- `createPlayer(p2, { bodyColor: P2_BODY_COLOR })` — the override exists and
  is exercised (`src/game.js:831`).
- `createCharacter({ baseSize, bodyColor, faceColor, ... })`
  (`src/characters.js:163`); shared material cache keyed per color
  (`:131-139` `getSharedMaterial`), shade derivation `shadeColor`
  (`:83-89`), look-constants precedent `FOOT_SHADE`/`CAP_LIGHTEN`
  (`:34-35`).
- `setupNewGame` mesh reuse: `if (!p.mesh) createPlayer(p);`
  (`src/game.js:236-240`) — a skin change must remove the mesh first so
  this rebuilds.
- Storage owner + permissive board reads: `src/hiscores.js:1-7, 81-104`
  (rows expose `score`, `distance`; plan 029 adds `asc`).
- Overlay button pattern to copy: the 1P/2P buttons — markup
  `index.html:83-87` (`.game-button.mode-button` inside `#mode-picker`),
  wiring with `pointerdown stopPropagation` + `click` action
  (`src/game.js:145-163` — the overlay's own pointerdown starts the run, so
  buttons must stop the press and act on the click).
- Cycle-button label precedent: the Speed button (`src/game.js:1066-1074`).
- Resource plateaus pinned by `tests/resources.spec.js` /
  `tests/effects.spec.js` (warm-up-baseline pattern).

## Repo conventions that bind this plan

Balance/progression knobs in constants.js GAME BALANCE; looks in
characters.js; storage only via hiscores.js; solo byte-stable when no skin
is stored (default `ember` must produce today's exact hero); specs DOM- or
`__game`-level; never two suites at once. UI: reuse `.mode-button` — do not
introduce a new control style.

## Commands

Every shell first: `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"`

| Purpose | Command | Expected |
|---|---|---|
| Lint | `npm run lint` | exit 0 |
| New spec | `npx playwright test tests/skins.spec.js` | pass |
| Plateau guard | `npx playwright test tests/resources.spec.js tests/effects.spec.js` | pass |
| Full suite | `npm test` | all pass |

## Scope

**In scope:** `src/characters.js` (SKIN_PALETTES table + createPlayer
default plumb), `src/constants.js` (SKIN_UNLOCKS thresholds),
`src/hiscores.js` (selection load/save + `computeUnlockedSkins()`),
`src/game.js` (button wiring + rebuild-on-select), `src/ui.js` (button
label refresh on overlay show), `index.html` (one button), `src/main.js`
(debug `skinInfo`), `tests/skins.spec.js` (NEW), `readme.md`,
`plans/README.md`.

**Out of scope:** P2 palette choice (teal contract), mid-run skin changes,
enemy skins, per-skin gameplay effects of ANY kind (skins are pure look —
a "gold skin scores more" idea is explicitly rejected), new CSS beyond the
existing `.mode-button` reuse.

## Steps

### Step 1: Tables + storage

`characters.js`: export `SKIN_PALETTES` (ordered array of
`{ id, name, bodyColor }` per the Design list) with a comment marking it a
look-table (thresholds live in constants). `constants.js` GAME BALANCE:
`SKIN_UNLOCK_DISTANCE_1 = 500`, `SKIN_UNLOCK_DISTANCE_2 = 1000`,
`SKIN_UNLOCK_SCORE = 1000` with rationale comments (`celestial` needs no
knob — its condition is "any `asc` row"). `hiscores.js`:
`loadSelectedSkin()` / `saveSelectedSkin(id)` (key `blocky.skin.v1`,
try/catch, invalid → null) and `computeUnlockedSkins()` returning an
ordered id array derived from `loadHiscores('endless')` +
`loadHiscores('daily')` rows (always includes `ember`; `celestial` only
when some row has `asc === true`).
**Verify**: `npm run lint` → 0; Node-import check on constants → prints 500.

### Step 2: Apply at spawn

`characters.js` `createPlayer(playerState, opts)`: seat 0's default body
color becomes the SELECTED skin's color (resolve via a small
`resolveSkinColor(seat)` helper: seat 0 → selected-if-unlocked else ember;
seat ≥1 → existing behavior/P2 override untouched). CRITICAL: with no
stored selection the resolved color must equal today's hardcoded hero color
EXACTLY (byte-stable default).
**Verify**: `npx playwright test tests/smoke.spec.js tests/hitbox.spec.js`
→ pass (default hero unchanged).

### Step 3: The button

`index.html`: `<button id="skin-button" class="game-button mode-button" title="Cycle your hero's earned palettes">SKIN: EMBER</button>`
inside `#mode-picker`. `game.js` `init()`: wire it with the 1P/2P pattern
(stopPropagation on pointerdown; on click → advance selection through
`computeUnlockedSkins()`, `saveSelectedSkin`, `sfx.click()`, then if
`state.onStartScreen` rebuild seat 0's hero: `state.scene.remove(p.mesh)`,
`p.mesh = null`, `createPlayer(p)`, re-ground with `groundHeightAt`, and
refresh the label). `ui.js` `showStartOverlay`: refresh the label (and the
`· NEW` marker: compare `computeUnlockedSkins()` against a
`blocky.skin.seen.v1` list — SKIP this marker if it costs more than ~15
lines; it is sugar, not core). `main.js`: `skinInfo` debug
(`{ selected, unlocked }`).
**Verify**: `npm run lint` → 0.

### Step 4: The spec — `tests/skins.spec.js`

Cases: (1) default: fresh storage → hero body color is the classic hex
(read via the existing `heroBodyWidth`-style debug pattern — add
`skinInfo` + assert `state.player.userData.bodyMesh.material.color.getHex()`
via page.evaluate); (2) locked skins absent: empty boards →
`skinInfo().unlocked` is `['ember']` and clicking the button keeps EMBER;
(3) unlock by seeding a board row (`localStorage` endless row with
`distance: 600`) → reload → `lime` unlocked, cycling selects it and the
hero rebuilds with the lime hex; (4) selection persists across reload; (5)
a stored-but-now-locked selection (storage edited) falls back to ember; (6)
plateau: cycling through all unlocked skins twice on the overlay holds
geometry counts flat and material counts flat after the first full cycle;
(7) 2P: P2 stays teal regardless of P1's skin.
**Verify**: new spec passes; then full suite.

### Step 5: Docs

`readme.md`: a "Skins" bullet (earned by distance/score/ascension; SKIN
button on the title screen; P2 is always teal). `plans/README.md` row.
**Verify**: `npm test` → all pass.

## Done criteria (ALL must hold)

- [ ] `npm test` exits 0 (baseline + ≥7 skin tests)
- [ ] Fresh-profile hero color is byte-identical to today's (spec case 1)
- [ ] `grep -n "localStorage" src/characters.js src/game.js` → no matches
      (storage stays in hiscores.js)
- [ ] Material/geometry plateaus hold across skin cycling (spec case 6)
- [ ] `plans/README.md` row 035 updated

## STOP conditions

- The default hero's rendered color differs from today's in any spec — the
  resolve path isn't byte-stable; stop.
- Rebuilding the hero on the overlay breaks the attract camera or leaves
  two meshes in the scene (geometry count climbs) — stop, report.
- The button cannot reuse `.mode-button` without new CSS — stop (the
  overlay layout may need the owner's eye; do not invent a new control
  style).

## Maintenance notes

- Plan 029's `asc` field is `celestial`'s only gate — if 029 is unlanded,
  the skin simply never appears (verify the guard reads `row.asc === true`
  defensively).
- Ghost runs (plan 034) deliberately do NOT wear the player's skin (fixed
  spectral cyan — a ghost must read as a ghost); if that ever changes,
  store the skin id in the ghost blob.
- Adding a palette = one table row + (optionally) one unlock knob; adding a
  SEAT-1 skin system means revisiting the teal-identity contract first.
