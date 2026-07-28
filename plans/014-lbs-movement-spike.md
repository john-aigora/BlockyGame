# Plan 014: Design spike — Little Big Snake-style continuous movement & boost (prototype behind a flag, then decide)

> **Executor instructions**: This is a SPIKE, not a feature build. The
> deliverables are (1) a short design doc, (2) a throwaway-quality prototype
> gated behind a URL flag, (3) a written recommendation. Follow the steps,
> honor STOP conditions, update `plans/README.md` when done.
>
> **Drift check (run first)**: plans 003 (deltaTime) and 012 (touch handling)
> must be DONE per `plans/README.md`. Continuous movement without deltaTime
> would bake in the exact bug class plan 003 removed — hard prerequisite.

## Status

- **Priority**: P3
- **Effort**: M (timeboxed: if the prototype exceeds ~a day, stop and write up)
- **Risk**: LOW (flag-gated; default gameplay untouched)
- **Depends on**: plans/003-frame-rate-independence.md, plans/012-mobile-polish.md
- **Category**: direction (design spike)
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

The maintainers' own top wishlist item (`todo.md:20-30`, marked "Major Refactor") and their saved advisory notes (`grok_tips.md` §1-2, with detailed parameter suggestions) describe replacing 4-direction arrow/drag movement with continuous motion toward the cursor/joystick plus a hold-to-boost energy system — the "Little Big Snake feel". It's the biggest possible upgrade to game feel and also the riskiest change (it invalidates current tuning: orbit radii, spawn distances, timer pressure). A flag-gated prototype lets the family PLAY both schemes side by side and decide with hands instead of arguments. The decision, not the code, is the deliverable.

## Current state

- Movement today: 4-directional, axis-aligned, instant (`keys['arrowup'] → position.z -= speed*dt` in `src/game.js`; touch drag sets a normalized `movementVector` in `src/input.js`). No rotation — the player mesh always faces +Z (its face is on the +Z side, `createCharacter` in `src/characters.js`).
- The saved design notes to honor (`grok_tips.md:79-88` — inline so you don't need the file): desktop = move continuously at constant speed toward mouse cursor raycast to the ground plane, smooth rotation (lerp ~0.1); mobile = joystick direction persists after finger lift; boost = hold (Space / left-click / touch button), ~1.5× speed, energy 100 max, −10/s drain, +5/s regen, visual energy bar; stop only on pause/game-over.
- Camera looks straight down-behind (`updateCameraPosition`, plan 006) — cursor raycasting must intersect the y=0 plane (`THREE.Raycaster.setFromCamera` + `THREE.Plane(new THREE.Vector3(0,1,0), 0)` — r128 API).
- Flag plumbing does not exist; `URLSearchParams` is available (no router).
- All speeds are per-second and dt-integrated (plan 003); world math via `src/worldmath.js` (plan 005).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint/tests | `npm run lint && npm test` | exit 0 (existing suites must stay green with the flag OFF) |
| Dev server | `npm run dev` | flag testable at `http://localhost:5173/?move=continuous` |

## Scope

**In scope**: `src/input.js`, `src/game.js` (movement application site), new `src/movement-continuous.js`, minimal energy-bar DOM/CSS (may be ugly — spike), `plans/design/lbs-movement-notes.md` (create — the writeup), `tests/` — ONLY a flag-off regression assertion.

**Out of scope**: trailing body segments, particle trails, skins (later phases in grok_tips); ANY change to default-mode behavior; polishing the prototype's visuals; performance work.

## Git workflow

- Branch: `improve/014-lbs-spike`
- Commit style: `Spike: ...`
- Do NOT push or open a PR unless the operator instructed it. The prototype branch may be long-lived; the WRITEUP lands regardless of the verdict.

## Steps

### Step 1: Flag plumbing

`const MOVEMENT_MODE = new URLSearchParams(location.search).get('move') === 'continuous' ? 'continuous' : 'classic';` exposed via `src/constants.js` or `state`. Classic path must be byte-for-byte the existing logic when the flag is off.

**Verify**: `npm test` → all existing suites pass (they run flag-off).

### Step 2: Prototype continuous movement

In `src/movement-continuous.js`:
- Desktop: track mouse position over the canvas; raycast to the y=0 plane each frame; steer current heading toward the target direction with a turn-rate lerp (start at `grok_tips` 0.1/frame equivalent — convert to per-second: `1 - Math.exp(-6 * dt)`); move at constant `actualPlayerSpeed`.
- Rotate the player group to face the heading (`player.rotation.y = Math.atan2(heading.x, heading.z)` — verify the face lands forward given the mesh's +Z face; if it trails, add π).
- Mobile: reuse plan 012's drag vector as the heading source; on release, KEEP the last heading (persistence per the design notes).
- Boost: hold Space (desktop) / a temporary on-screen button (mobile): speed ×1.5 while `state.energy > 0`; `energy -= 10*dt` boosting, `+= 5*dt` otherwise, clamp [0,100]; a bare `<div>` bar above the canvas is fine.
- Wrapping, collisions, camera: unchanged — movement only changes how the position delta is produced.

### Step 3: Family playtest + writeup

Write `plans/design/lbs-movement-notes.md`:
1. How to run both modes (URLs).
2. A 6-question scorecard to fill during playtest (each rated per mode): easier to dodge? easier to hunt? feels faster? mobile comfort? "one more try" pull? kid's verdict?
3. Open design questions discovered while prototyping (e.g. does constant motion fight the 15s collect timer? does boost trivialize fleeing yellows? does the fixed camera need to look ahead of the heading?).
4. **Recommendation**: adopt / adapt / reject, with the 2-3 changes a real implementation would need beyond the prototype (expected at minimum: retuning `engagementRadius`, spawn distances, and timer pressure around constant motion).

## Test plan

One assertion only: with the flag OFF, the full existing suite passes unchanged (`npm test`). The prototype path gets NO automated tests — it's disposable by definition. (If adopted, the real implementation plan writes real tests.)

## Done criteria

- [ ] `?move=continuous` plays with cursor-steer + boost; default URL plays exactly as before
- [ ] `npm run lint && npm test` exit 0 (flag off)
- [ ] `plans/design/lbs-movement-notes.md` exists with the scorecard and a recommendation section (recommendation may say "pending family playtest" if the humans haven't played yet — the doc must make that playtest a 10-minute task)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plans 003/012 not DONE.
- The prototype needs > ~1 day — stop, write up what exists and what blocked it; that IS a valid spike outcome.
- You start refactoring classic movement "while you're in there" — flag-off behavior is sacred; revert.

## Maintenance notes

- If adopted: write a NEW full plan (real tests, retuning pass, remove classic path or keep as accessibility option — decide in that plan); delete `src/movement-continuous.js` prototype code as part of it.
- If rejected: keep the writeup, delete the prototype module and flag in a cleanup commit noted in `plans/README.md`.
- The energy system's numbers (10/s drain, 5/s regen) came from the family's own saved notes — start there, tune in playtest.
