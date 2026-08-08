# Plan 028: Performance pass 2 — water recolor, chunk-build cost, instancing (measured, gated)

> **Executor instructions**: This plan is GATED on measurements — read Step 0
> before anything. STOP conditions binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 128d18e..HEAD -- src/terrain.js src/collectibles.js src/clouds.js tests/`
> Drift from earlier plans is expected; STOP only if `recolorWater`/`buildChunk`
> are unrecognizable vs the descriptions below.

## Status

- **Priority**: P3 · **Effort**: M-L · **Risk**: MED
- **Depends on**: 020 (perfInfo hook + pass-1 wins), 026 (two-view numbers)
- **Category**: perf
- **Planned at**: commit `128d18e`, 2026-07-31

## Why this matters

Three remaining costs were estimated, not measured (findings P-3, P-12, P-9 in
`plans/audit-2026-07-31.md`): the water recolor bursts ~1.6M ops in one frame
every ~2s of travel; chunk builds burst 2×~212k ops during row crossings; and
~450 scenery draw calls could be 3 InstancedMesh — worth roughly double after
plan 026 renders twice. Pass 1 took the sure wins; this pass takes the measured
ones and SKIPS what the numbers don't justify.

## Current state

- `debug.perfInfo()` exists (plan 020) with pass-1 baselines in that plan's
  commit log; 2P numbers in plan 026's run log.
- `src/terrain.js:252-268` `recolorWater()` — 81×81 vertices, full
  `terrainHeight` per vertex, full color-attribute upload; triggered on
  `WATER_SNAP = 12` grid crossings (`:323-327`).
- `src/terrain.js:399-417` `buildChunk` — 625 `terrainHeight` + `computeTint`
  per vertex; `computeTint`'s biome octave (`:174`, wavelength 300) is
  near-constant across a 32u chunk. `CHUNK_BUILDS_PER_FRAME = 2`.
- Scenery: food one Mesh each (`src/collectibles.js:19`), rocks 4 Meshes per
  boulder (`src/terrain.js:454-458`), cloud puffs one Mesh each
  (`src/clouds.js:62`) — each family single-geometry+single-material.
- Bend shader: `BEND_PROJECT_CHUNK` (`src/terrain.js:93-100`) does
  `modelMatrix * vec4(transformed,1.0)` — it would DROP `instanceMatrix` on an
  InstancedMesh; needs an `#ifdef USE_INSTANCING` branch first.
- `tests/resources.spec.js` / `tests/effects.spec.js` assert geometry-count
  stability (rewritten in 017 with warm-up baselines).

## Commands

`export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` · `npm test` ·
`npx playwright test tests/endless-polish.spec.js tests/resources.spec.js --workers=1`

## Scope

**In scope**: `src/terrain.js`, `src/collectibles.js`, `src/clouds.js`,
`src/constants.js`, affected specs. **Out of scope**: characters (stay
individual meshes — they animate per-part), renderer settings, audio.

## Git workflow

Run branch; `[<branch> · Batch N/M] <verb> <what>`; NEVER push.

## Steps

### Step 0: Measure and decide

Scripted run (solo + 2P if 026 landed): record `perfInfo()` over 60s of
straight travel at 1× and 5× — capture `frameMsAvg`, `calls`, and a manual
worst-frame estimate around a `WATER_SNAP` crossing (sample `frameMsAvg` decay
after crossings). Record in the run log. DECISION TABLE (binding):
- Step 1 (water) runs only if snap crossings visibly spike (avg jumps >2ms).
- Step 2 (tint) runs only if chunk-build frames spike at 5×.
- Step 3 (instancing) runs only if `calls` > 400 in the 2P steady state.
Skipped steps are recorded as "SKIPPED per Step 0 numbers: <numbers>".

### Step 1: Incremental water recolor (P-3)

Align `WATER_SNAP` to the water-grid pitch (plane is 560/80 = 7u cells → snap
14 = two cells, constant comment updated); on a snap step, `copyWithin` the
color array by the row/col offset and recompute ONLY the newly exposed bands
(~324 verts vs 6,561). Pin correctness with the existing `waterRecolors`
counter + a new spec case: colors at a fixed world point are identical whether
reached by walking (shifted) or by teleport (full recompute) — sample via
`debug.terrainTint`-style water probe (add `debug.waterTintAt(x,z)` reading the
vertex color nearest a world point).
**Verify**: endless-polish water assertions green; the new equality case green;
snap-crossing spike gone (perfInfo sample).

### Step 2: Chunk-tint corner interpolation (P-12)

In `buildChunk`, sample the biome octave at the four chunk corners; per vertex
bilinearly interpolate instead of calling the octave (≈25% build-cost cut).
The 3-octave height stays exact. Re-baseline `terrainTint` assertions in
`tests/endless-polish.spec.js` if deltas exceed tolerance (they should be
sub-visible at wavelength 300 — if a biome-band test fails by more than 0.01
in a channel, STOP).
**Verify**: endless-polish green (or re-baselined within tolerance); build
burst reduced (perfInfo around a row crossing).

### Step 3: Instancing, rocks first (P-9)

3a. Patch `BEND_PROJECT_CHUNK` with `#ifdef USE_INSTANCING` applying
`instanceMatrix` before `modelMatrix`; OWN COMMIT; verify existing visuals
unchanged (screenshot).
3b. Rocks → one `InstancedMesh(boxGeo, rockMaterial, MAX_ROCK_INSTANCES)` on
the terrain root; pool becomes an index free-list; `setMatrixAt` on
acquire/release + `instanceMatrix.needsUpdate`. Colliders unchanged (data, not
meshes). Update geometry-count assertions deliberately (comment why).
3c. Food next (per-frame `setMatrixAt` for bob/spin — still one draw call);
gold food (plan 025) via `setColorAt` or a second small InstancedMesh.
3d. Clouds last, same pattern.
Each sub-step: screenshot + suite + perfInfo delta; STOP the step ladder as
soon as `calls` drops under 150 in 2P — further conversion isn't worth churn.
**Verify**: per sub-step; horizon bend visibly applies to instanced rocks
(screenshot at the horizon — unbent rocks at the origin = the shader patch
regressed).

### Step 4: Record

Final perfInfo table (solo/2P × 1×/5×) in the run log + `plans/README.md` row.
**Verify**: `npm test` 0 failed ×2 · `npm run build` exit 0.

## Test plan

New: water shift-equality case, `debug.waterTintAt`. Updated: geometry-count
specs per instancing sub-step. Everything else is measurement + screenshots.

## Done criteria

- [ ] Step 0 decision table recorded with numbers; skipped steps justified
- [ ] `npm test` 0 failed ×2; visuals verified by screenshots per step
- [ ] perfInfo before/after table in run log
- [ ] `plans/README.md` updated

## STOP conditions

- Step 1 equality case fails (stale-stripe class) after one index-arithmetic fix.
- Step 3a screenshot shows ANY visual difference — the shader patch must be a
  no-op for non-instanced materials.
- A geometry-count spec disagreement you cannot explain in one sentence.

## Maintenance notes

- If instancing lands, plan-022's "no pooling for collectibles" note in
  `plans/README.md` is superseded for food — update the rejected-findings line.
- Character instancing stays rejected (per-part animation) — record if asked.
