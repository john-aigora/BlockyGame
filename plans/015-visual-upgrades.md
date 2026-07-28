# Plan 015: Beautiful graphical upgrades — the "juice" pass (creative latitude granted)

> **Executor instructions**: This plan is different: the maintainers explicitly granted creative
> latitude — "you also have our permission to surprise us with some beautiful graphical upgrades."
> You choose what to build from the menu below (or beyond it), within the hard guardrails. Follow
> the verification gates like any other plan. When done, update `plans/README.md`.
>
> **Drift check (run first)**: plans 002, 003, 006, 007 must be DONE per `plans/README.md`
> (modules, deltaTime, camera model, and shared-resource patterns are the foundation this builds on).

## Status

- **Priority**: P2
- **Effort**: M (timeboxed: pick wins that fit; do not gold-plate one effect for hours)
- **Risk**: MED (aesthetic judgment + perf) — bounded by guardrails and gates below
- **Depends on**: plans/007-rendering-hygiene.md (and everything 007 depends on)
- **Category**: direction (visual polish) — user-mandated
- **Planned at**: commit `f4d3ecc`, 2026-07-25 (added during elves staging by user request)

## Why this matters

The game is visually flat: unlit-looking solid boxes on a featureless teal plane, no feedback
beyond scale changes. The maintainers' own `todo.md` "Visual & UI Enhancements" section asks for
particles on collect, a real enemy-death explosion, movement trails, walk animations, glowing
power-up-style effects, and textures. The user then explicitly authorized a surprise beauty pass.
Visual "juice" is the highest feel-per-effort upgrade after correctness: the same mechanics read as
a finished game when actions have visible consequences.

## Hard guardrails (non-negotiable)

1. **No external assets.** Everything procedural: geometry, vertex colors, canvas-generated
   textures, math. No image/texture/model/font files added to the repo.
2. **Photosensitivity:** nothing strobes. No full-screen flashes above 3/sec (WCAG 2.3.1); prefer
   fades/eases. Screen shake (if any) ≤ 0.15s, small amplitude, and skipped when
   `prefers-reduced-motion` is set.
3. **Performance:** stays smooth on modest hardware. Particle systems must reuse geometry/materials
   per plan 007's shared-resource pattern (one `THREE.Points`/pool per effect type — never
   per-particle meshes/materials). After the pass, `renderer.info.render.calls` in a busy scene
   (8 enemies, 40 food, particles firing) stays under ~120, and `tests/resources.spec.js` still passes.
4. **Palette identity:** build on the existing "Deep Dive Arcade" scheme (teal #004D40 world,
   orange-red #FF4500 player, electric blue #03A9F4 / yellow #FFEB3B enemies, lime #76FF03 food).
   Enrich it (shades, emissive accents, gradients); do not replace it.
5. **Readability first:** killable-yellow vs dangerous-blue must remain instantly distinguishable;
   effects must never obscure the player or an approaching enemy.
6. **All existing tests stay green.** The three.js version stays 0.128.0 (its API for Points,
   vertex colors, fog, and emissive materials is fully sufficient).

## The menu (pick high-impact items; ship at least 4, grounded in todo.md)

- **Collect burst** (todo: "Particle effect when player collects food"): 10-15 lime sparks from a
  pooled `THREE.Points`, 0.4s, ease-out, slight upward bias + a quick player squash-and-stretch pulse.
- **Enemy death explosion** (todo: "More elaborate particle effect for enemy 'explosion'"): burst in
  the enemy's body color that transitions to lime as the food spawns — sells "enemy becomes food".
- **Walk animation** (todo: "'Walking' animation, enemy leg animations"): sinusoidal leg swing
  driven by distance traveled (not wall time), player and enemies; idle = legs settle to rest.
- **Living ground** (todo: "Textures... ground"): procedural canvas texture — subtle darker-teal
  grid/checker fading with fog — gives motion feedback the featureless plane lacks (audit finding:
  you literally cannot see yourself move on empty stretches). Must tile with the wrap illusion
  (ground follows the player; use texture offset = player position so the grid scrolls correctly).
- **Food glow**: gentle emissive pulse on collectibles (shared material animated globally, cheap)
  + slow rotation so food reads as pickup-able.
- **Kill-mode aura**: when an enemy is killable, a soft yellow point light or emissive ramp instead
  of a flat color swap; fleeing enemies get a subtle "panic" wobble.
- **Sky & atmosphere**: vertical gradient background (canvas texture on `scene.background` or a
  large inverted sphere), fog color tuned to match the horizon line.
- **UI polish** (todo: "More distinct styling for active/hover states"): consistent button hover/
  active glow, score "pop" animation on change, death-screen fade-in.
- **Camera juice**: tiny ease-in on zoom changes is already there (plan 006); optionally a very
  small kill-impulse (respecting guardrail 2).

Feel free to go beyond the menu if something better fits the guardrails — the mandate is "surprise
us, beautifully," not "execute this list."

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint/tests/build | `npm run lint && npm test && npm run build` | all green |
| Dev server (visual judgment) | `npm run dev` | play 2 full runs, watch every effect |

## Scope

**In scope**: `src/` (new `src/effects.js` module for particles/animation helpers; touch points in
collect/kill/death/move paths), `style.css`, `index.html` (only if a UI element needs structure),
`tests/effects.spec.js` (create — see Test plan).

**Out of scope**: gameplay values (balance is plan 011), new mechanics (no actual power-ups —
that's future work), sound (plan 010), post-processing/shader frameworks (EffectComposer adds
complexity beyond need — raw Points/materials only), anything requiring assets.

## Git workflow

- Branch: current elves run branch; commits per effect: `Feat: <effect>` in run format.
- Commit each effect separately so any single effect can be reverted without losing the rest.

## Steps

1. **Build the pooled particle engine once** in `src/effects.js`: one `THREE.Points` pool per
   effect type, preallocated positions/velocities/life arrays, `spawnBurst(origin, color, opts)`,
   updated with `dt` from the main loop (plan 003's clock). Verify: fire 50 bursts in a loop via a
   debug hook → `renderer.info.memory.geometries` stable (pool, not allocation).
2. **Ship menu items** one commit each, playtesting each in the dev server before the next.
3. **Reduced-motion pass**: `window.matchMedia('(prefers-reduced-motion: reduce)')` disables
   screen shake and squash-stretch (particles may stay — they're object motion, not screen motion).
4. **Perf pass**: busy-scene `renderer.info` numbers recorded in the execution log.

## Test plan

Create `tests/effects.spec.js`:
1. Collect a food via the debug hook (teleport player onto one) → no pageerror, and
   `renderer.info.memory.geometries` delta over 10 collects ≤ 1 (pool discipline).
2. Boot with `prefers-reduced-motion` emulated (`page.emulateMedia({ reducedMotion: 'reduce' })`)
   → play 5s → no pageerror (the flag paths execute).
3. All pre-existing suites green.

Manual (required, this is a VISUAL plan): play two full runs in the dev server; record in the
execution log a one-paragraph honest self-review of how it looks, plus `renderer.info` numbers.
Screenshot before/after for the Elves Report.

## Done criteria

- [ ] ≥4 menu-grade effects shipped, each in its own commit
- [ ] `npm run lint && npm test && npm run build` green (incl. new effects spec)
- [ ] No new asset files: `git diff main...HEAD --stat` shows no images/models/audio added
- [ ] Reduced-motion honored; nothing strobes >3/sec
- [ ] Before/after screenshots saved for the report; perf numbers logged
- [ ] `plans/README.md` status row updated

## STOP conditions

- Prerequisite plans not DONE.
- An effect can't hit the perf guardrail after one rework attempt — cut it (log why) rather than
  shipping a janky effect; this plan ships only what looks AND runs good.
- You catch yourself adding a shader framework, post-processing stack, or asset pipeline — that's
  scope creep; revert to raw three.js primitives.

## Maintenance notes

- `src/effects.js` is the home for all future juice; the pool pattern is the law here (plan 007's
  shared-resource discipline extended to particles).
- The boost trail on the family's wishlist (todo.md, plan 014's spike) should reuse `spawnBurst`.
- If the family later wants power-up orbs, the food-glow material pattern is the starting point.
