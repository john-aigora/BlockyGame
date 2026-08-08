# Plan 020: Performance pass 1 — measure first, then the cheap large wins

> **Executor instructions**: Step-by-step with verification; STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 128d18e..HEAD -- src/characters.js src/terrain.js src/effects.js src/ui.js src/input.js src/world.js src/collectibles.js src/main.js index.html tests/resources.spec.js`

## Status

- **Priority**: P1 · **Effort**: M · **Risk**: LOW-MED
- **Depends on**: 017
- **Category**: perf
- **Planned at**: commit `128d18e`, 2026-07-31

## Why this matters

The frame has one very large avoidable cost (an estimated 20–30%: ~700 meshes
are shadow-eligible, including sub-pixel pupils and teeth) and several medium
ones (never-culled terrain, per-frame terrain re-sampling for fogged-out food,
layout-triggering HUD writes, hot-loop allocations). Mobile gets desktop-tier
MSAA/DPR/shadows. Plan 026 (two-player) renders the scene TWICE per frame, so
this headroom is a prerequisite. Evidence: P-1..P-12 in `plans/audit-2026-07-31.md`.

## Current state (key excerpts)

- No measurement exists. `src/main.js:17-51` (`window.__game.debug`) has no
  renderer stats or frame-time.
- `src/characters.js` — 17 `castShadow = true` sites (body `:161`-area, brows
  `:248`, eye whites `:223`, pupils `:232`, mouth `:265`, teeth `:316`, antenna
  tip `:330`, scarf `:355`, …). `src/collectibles.js:20` food casts;
  `src/terrain.js:456-457` every rock block casts AND receives.
- `src/terrain.js:384-386` — `mesh.frustumCulled = false;` (horizon-bend
  bounding-sphere excuse). Bend drop is bounded: worst chunk corner ~118u,
  `CURVE_STRENGTH = 0.0012` → ≤ ~16.7u.
- `src/effects.js:691-703` — `updateFoodGlow` calls `groundHeightAt` per
  collectible per frame; spawns already compute the same height
  (`src/collectibles.js:53,70`). Fog far ≈ 86 (`src/world.js:311-312`).
- `src/ui.js:489` `position.clone()` per enemy per frame; `:519-521` writes
  `style.left/top` (layout) + a rebuilt transform string; `:496-503`
  unconditional `display`/`backgroundColor` writes.
- `src/enemies.js:280,306,307` fresh Vector3s per enemy per frame; `:586`
  closure per enemy; `:223` `getObjectByName('body')` though
  `userData.bodyMesh` exists (`src/characters.js:161`); `:230-235` sets
  body/cap color every frame regardless of change.
- `src/input.js:377-381` pad HUD `textContent` written every frame;
  `activeGamepad()` reached up to 3×/frame (`:98` callers).
- `src/terrain.js:546` builds 9 string keys per collision probe (3×3 loop).
- `src/world.js:146-149` — `antialias: true`, DPR cap 2, shadows on,
  unconditional. `state.isMobile` resolves later (`src/game.js:60`).
- `index.html:15` — Google Fonts stylesheet with no preconnect.
- `tests/resources.spec.js:34-40` pins `getPixelRatio() === min(devicePixelRatio, 2)`.

## Commands

`export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` · `npm test` ·
`npx playwright test tests/resources.spec.js tests/effects.spec.js --workers=1` · `npm run lint`

## Scope

**In scope**: files listed in the drift check, plus `style.css` (Step 5's
indicator pinning) — `src/game.js`/`src/enemies.js` were already in the drift
check via Steps 1/5. *(Scope line corrected post-landing by the B3 review.)*
**Out of scope**: InstancedMesh
conversion (plan 028), water recolor internals (028), audio, `movement-continuous.js`.

## Git workflow

Run branch; `[<branch> · Batch N/M] <verb> <what>`; NEVER push.

## Steps

### Step 1: `perfInfo()` measurement hook (do FIRST)

Add to the debug handle a `perfInfo()` returning
`{ calls, triangles, geometries, textures, frameMsAvg }` — calls/triangles from
`renderer.info.render`, memory from `renderer.info.memory`, `frameMsAvg` a
module-level exponential average updated in the rAF loop (measure around the
`update+render` body with `performance.now()`; this is diagnostics, not
simulation — game logic keeps using the clamped game clock).
**Verify**: in a scratch spec or REPL: `debug.perfInfo()` returns finite numbers;
record baseline `{calls, triangles}` mid-run in the commit message.

### Step 2: Shadow diet (P-1)

In `createCharacter`: `castShadow = true` ONLY on the body, cap, and the four
legs/feet; remove it from eyes/pupils/brows/mouth/ears/tail/spikes/jaw/teeth/
antenna/scarf/outline. Remove from food (`src/collectibles.js:20`). Rocks: keep
`receiveShadow`, drop `castShadow` on rock blocks. Mobile tier:
`renderer.shadowMap.enabled = !isMobile` (see Step 7 ordering).
**Verify**: `debug.perfInfo()` calls drop vs Step 1 baseline (record numbers);
one zoomed-in screenshot before/after attached to the run log; suite green.

### Step 3: Cull terrain chunks (P-2)

In `buildChunk` after `computeVertexNormals()`:
`geo.computeBoundingSphere(); geo.boundingSphere.radius += 24; mesh.frustumCulled = true;`
(24 covers the ≤16.7u worst-case bend drop). Leave the water plane
`frustumCulled = false` (its comment is correct).
**Verify**: `perfInfo().calls` drops again; pan the camera in a scripted run —
no chunk pop at screen edges (screenshot pair at a low zoom); endless specs green.

### Step 4: Food glow cache + fog gate (P-4)

Store `userData.baseY` at both spawn sites (value already computed there); in
`updateFoodGlow` use it instead of `groundHeightAt`, and `continue` when
squared XZ distance to the player > 90² (leave `position.y = baseY + rest`).
Heights are rebase-invariant (they are heights, not coordinates) — note this in
a comment.
**Verify**: effects/resources specs green; food still bobs near the player
(existing endless-polish assertions cover placement).

### Step 5: Indicator + AI hot-loop hygiene (P-5, P-6)

- `src/ui.js`: module scratch Vector3 (`copy` not `clone`); CSS pins
  `left:0; top:0` on indicators; write ONE
  `transform: translate3d(Xpx,Ypx,0) translate(-50%,-50%) rotate(Ndeg)` with
  integers; cache last `display`/`backgroundColor` per indicator and skip
  unchanged writes.
- `src/enemies.js`: add `moveScratch/orbitScratch/chaseScratch` beside the
  existing scratch trio (`:26-28`), zeroed per enemy iteration (note:
  `moveEnemyWithCollision` MUTATES the vector — re-zero each iteration);
  convert `computeAvoidance` forEach to a for loop; use `userData.bodyMesh`;
  gate the body/cap `color.setHex` on the killable-state TRANSITION (tracked at
  `src/effects.js:906-907` — mirror that pattern locally).
**Verify**: indicator visuals unchanged (screenshot with an off-screen enemy);
suite green; `grep -n "position.clone()" src/ui.js` → none.

### Step 6: Pad HUD + probe keys (P-7, P-8)

- `updatePadHud`: compose the string, compare to a module `lastPadHudText`,
  write only on change. Cache `activeGamepad()` per frame: a frame counter
  incremented in `pollGamepad`; other same-frame callers reuse the snapshot
  (tests mock per-call — key the cache by counter so mocks still drive it).
- `src/terrain.js`: key the `active` chunk lookup by packed int
  `(cx & 0xFFFF) << 16 | (cz & 0xFFFF)` for the collision path; KEEP the string
  `chunk.key` field (food/cloud ownership + `terrainInfo().activeKeys` tests
  read it).
**Verify**: gamepad + endless specs green; `terrainInfo().activeKeys` unchanged shape.

### Step 7: Mobile tier + font (P-10, P-11)

- Resolve `isMobile` BEFORE `createWorld()` (move the `matchMedia('(pointer: coarse)')`
  read above it in `init()`); create renderer with `{ antialias: !isMobile }`;
  DPR cap: `min(devicePixelRatio, isMobile ? 1.5 : 2)`. Update
  `tests/resources.spec.js:34-40` to assert the tiered rule (desktop context ⇒ 2).
- `index.html`: add both preconnect lines above the fonts stylesheet:
  `<link rel="preconnect" href="https://fonts.googleapis.com">` and
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`.
**Verify**: suite green (resources spec updated); `npm run build` exits 0.

## Test plan

No behavioral tests change except `resources.spec.js` (DPR tier). Each step's
verification is the perfInfo delta + green suite + screenshots for visual steps.
Record before/after `{calls, triangles, frameMsAvg}` in the final commit body.

## Done criteria

- [ ] `npm test` 0 failed; `npm run lint` 0; `npm run build` exit 0
- [ ] `debug.perfInfo()` exists; commit log records baseline vs after numbers
- [ ] `grep -c "castShadow = true" src/characters.js` ≤ 7
- [ ] Chunk meshes are frustum-culled with inflated spheres (code review)
- [ ] `plans/README.md` updated

## STOP conditions

- Step 3 shows chunk pop-in at screen edges after raising the margin to 32.
- Step 2 visibly degrades the look at default zoom (compare screenshots) —
  report with images instead of restoring per-part shadows piecemeal.
- Any step regresses a spec that resists one focused fix.

## Maintenance notes

- Plan 028 (instancing, water recolor) MUST read this plan's perfInfo numbers
  first — it is gated on measured draw-call counts.
- Plan 026 renders twice per frame; re-record perfInfo after it lands.
