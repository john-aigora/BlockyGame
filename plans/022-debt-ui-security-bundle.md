# Plan 022: Debt, UI, and security small-fixes bundle

> **Executor instructions**: Each numbered item is independent — commit per item,
> verify per item. STOP conditions binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 128d18e..HEAD -- src/ tests/ style.css index.html`
> Compare per-item excerpts before each item; on mismatch, skip THAT item, note
> it, continue with the rest.

## Status

- **Priority**: P2 · **Effort**: M (many S items) · **Risk**: LOW
- **Depends on**: 017; item 1 before plan 026 lands (naming collision)
- **Category**: tech-debt / bug / security
- **Planned at**: commit `128d18e`, 2026-07-31

## Why this matters

Sixteen small, verified problems: a naming collision sitting exactly where
future work happens, dead-but-dangerous defaults, contract fragilities that fail
silently, two visible UI defects, and low-cost security hardening. Each is S;
together they de-mine the codebase for the bigger plans. Findings D-3..D-6,
D-10..D-13, C-10..C-13(partial), UI-1, UI-2, SEC-1, SEC-3 in
`plans/audit-2026-07-31.md`.

## Commands

`export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` · `npm test` ·
`npm run lint` · per-item spec runs with `--workers=1`.

## Scope

**In scope**: `src/constants.js`, `src/game.js`, `src/input.js`, `src/ui.js`,
`src/hiscores.js`, `src/state.js`, `src/effects.js`, `src/gate.js`,
`tests/helpers.js`, `tests/gate.spec.js`, `tests/fairness.spec.js`,
`tests/toys.spec.js`, `style.css`, `index.html`, `vercel.json` (create),
`readme.md` (gate line only).
**Out of scope**: `worldmath.js` and the torus test suite (KEEP — recorded
verdict); full classic deletion (D-1 partial only as below); `game.js`/`effects.js`
module splits (deferred — see Maintenance); `public/original/` contents.

## Git workflow

Run branch; `[<branch> · Batch N/M] <verb> <what>`; NEVER push. One commit per item.

## Items

### 1 (D-3): Kill the "classic" naming collision
`src/constants.js:217-218`: replace `MOVEMENT_MODE` with
`export const CONTINUOUS_MOVEMENT = new URLSearchParams(location.search).get('move') === 'continuous';`
Update the 7 read sites (`src/game.js:109,224,287,429`, `src/input.js:326,481-489
region`) and fix the misleading comments (`game.js:108` claims "classic mode"
where it means the movement scheme).
**Verify**: `grep -rn "MOVEMENT_MODE" src/` → none; suite green.

### 2 (D-4): Remove the mode-picker corpse, keep the live HUD updater
Delete `el.modeClassic/modeEndless` (`src/ui.js:28-29,57-58`), `initModePicker`
(`:85-96`) and its call (`src/game.js:53-54`), `setWorldMode` (`src/game.js:536-548`)
— BUT first extract lines `src/ui.js:106-114` (endless-hint display + controls
text logic, minus any part plan 021 already deleted) into `updateModeHud()`;
`forceWorldMode` calls it. Delete `#mode-picker`/`.mode-button` CSS
(`style.css:320-355`) ONLY IF plan 026 has not landed first — 026 re-uses those
classes; if 026 is already merged, leave CSS.
**Verify**: `npx playwright test tests/endless.spec.js tests/smoke.spec.js --workers=1` green.

### 3 (D-5): Hiscores defaults point at the live board
`src/hiscores.js:33,55`: default `mode = 'endless'` in both `loadHiscores` and
`recordScore`. Delete `saveWorldMode`'s `MODE_KEY` write if nothing reads it
(grep first). KEEP the classic key and its sort branch (real scores exist).
**Verify**: `npx playwright test tests/hiscores.spec.js tests/toys.spec.js --workers=1` green.

### 4 (D-6): Collapse classic-only input forks
`src/input.js:334-336` (pad A as pause) delete; `:481-489` Space=jump always,
P/Enter=pause (remove the worldMode ternary).
**Verify**: `npx playwright test tests/gamepad.spec.js tests/timing.spec.js tests/toys.spec.js --workers=1` green.

### 5 (D-10): Dead state fields
Delete `state.playerSpeed` (`src/state.js:53`) + its writes (`src/game.js:61-63`);
merge `gameScreenContainer` into `gameContainer` (`src/state.js:63,69`,
`src/input.js:594-609`); refresh the stale classic comments in `state.js:19-25`.
**Verify**: `grep -rn "playerSpeed\b" src/ tests/` → none; suite green.

### 6 (D-11): Bind collider widths to geometry
New test in `tests/fairness.spec.js`: assert `PLAYER_COLLIDER_HALF_WIDTH * 2`
equals the hero body geometry width via a one-line debug getter
(`debug.heroBodyWidth = () => state.player.userData.bodyMesh.geometry.parameters.width`
— add to `src/main.js`), and the enemy equivalent. Replace the two hardcoded
`0.54` literals in `tests/toys.spec.js:91,182` with the imported constant.
**Verify**: the new assertions pass; toys green.

### 7 (D-12): One speed ladder
`src/constants.js`: derive `export const SPEED_LADDER = [...speedMultipliers].sort((a,b)=>a-b);`
`src/game.js:687` imports it instead of redefining; `indexForMultiplier` logs a
`console.warn` on miss instead of silently returning 0.
**Verify**: `npx playwright test tests/balance.spec.js tests/gamepad.spec.js --workers=1` green.

### 8 (D-13): Delete phantom jump constants
`src/constants.js:209-211` `JUMP_GRAVITY`/`JUMP_VELOCITY` + comment — delete.
**Verify**: `grep -rn "JUMP_GRAVITY\|JUMP_VELOCITY" src/ tests/` → none; lint 0.

### 9 (C-10): Modifier chords
Hoist the `metaKey||ctrlKey||altKey` early-return (pattern at
`src/input.js:453-457`) to the top of `onKeyDown` for all non-movement keys
(movement keys may keep working — simplest: return early for the F/R/Space/P/
Enter branches when a modifier is held).
**Verify**: new fairness.spec case — `page.keyboard.press('Meta+f')` does not
change `state.currentSpeedMultiplierIndex`.

### 10 (C-12): dt-correct wobble settle
`src/effects.js:936-939`: `rotation.z *= Math.exp(-11 * dt)` (pass dt in from
the caller; it is available in `updateEffects`' signature chain).
**Verify**: suite green (visual-only change).

### 11 (C-13 partial): Guard `seamDelta` + reimage warn discs
`src/effects.js:713-719`: route through `worldmath.torusDeltaComponent` (mode-
aware) instead of hardcoded `worldSize/2` math, with a comment. In classic
`reimageEntities` (`src/game.js:577-587`) also re-image pending warn-disc
positions (`src/enemies.js:139-146` — expose a `reimagePendingSpawns(fn)` helper
from enemies.js).
**Verify**: `npx playwright test tests/world.spec.js --workers=1` green.

### 12 (UI-1): KILL!/combo chip into the play frame
`#kill-indicator` and `#combo-chip` live inside `#ui-container`
(`index.html:69-70`) but position against the viewport (`style.css:616` absolute
with an unpositioned ancestor). Move both elements INTO `#game-container` in
`index.html` (its children `#top-controls` etc. already position against it) and
adjust `top` so KILL! sits inside the canvas top edge, combo chip below it.
Preserve the ≤3Hz flash invariant (no CSS transition on the flash — comment at
`style.css:625` says why).
**Verify**: screenshot with a killable enemy — banner renders INSIDE the play
frame; smoke/tension specs green (`#kill-indicator` id unchanged).

### 13 (UI-2): Controls-hint overlap
Reproduce at 1280×800 (screenshot); fix `#instructions` line layout (the
wrapped `#controls-hint` span collides with the next line — give
`#instructions` a sane `line-height` and drop the manual `<br>` after the span
in favor of block display).
**Verify**: screenshot at 1280×800 and 800×450 — no overlapping glyphs.

### 14 (SEC-1): `vercel.json` headers
Create `vercel.json`: for `/(.*)`: `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`; for `/original.html` and
`/original/(.*)`: `Content-Security-Policy: script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com`
(the archive loads three.min.js from cdnjs and Google Fonts — `public/original/index.html:9-10`;
do NOT edit the archive itself).
**Verify**: `npm run build` exit 0; JSON parses (`node -e "JSON.parse(require('fs').readFileSync('vercel.json'))"`).

### 15 (SEC-3): Single-source the gate password
`tests/helpers.js:4` imports the constant from `src/gate.js` (export it) instead
of re-declaring; `tests/gate.spec.js` drops the literal assertion at `:18`
(assert unlock behavior, not the string) and removes the value from the test
title; `readme.md:28` → "Password: see `src/gate.js` (shared family password)."
Leave `index.html:19`'s comment removal to taste — prefer removing it.
**Verify**: `npx playwright test tests/gate.spec.js --workers=1` green;
`grep -rn "<the-gate-password>" tests/` (substitute the literal from
src/gate.js when running) shows no password literal in tests. *(Needle
redacted from this plan at terminal review A-6 — the plan itself was leaking
the string it verifies the absence of.)*

## Done criteria

- [ ] `npm test` 0 failed · `npm run lint` 0 · `npm run build` exit 0
- [ ] Per-item greps above all clean
- [ ] Screenshots for items 12–13 recorded in the run log
- [ ] `plans/README.md` updated (note any skipped items + why)

## STOP conditions

- Any single item breaks >1 spec after one focused fix — skip it, record, move on.
- Item 2: if `updateModePicker` extraction leaves `#endless-hint` stuck
  hidden/visible in smoke screenshots, stop that item.

## Maintenance notes

- Deferred deliberately: `game.js`/`effects.js` module splits (D-7/D-8 — do
  AFTER plan 026 to avoid double-churn on the same lines), full classic
  retirement D-1 (partial only; `worldmath.js` + torus specs stay), import-cycle
  lint rule D-9 (add with the splits).
- Item 12 moves DOM nodes — plan 026 duplicates HUD per player half; it will
  relocate these again; keep ids stable.
