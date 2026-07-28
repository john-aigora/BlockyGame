# Plan 007: Rendering & resource hygiene — sharp on retina, no GPU leaks, no per-frame DOM/AABB waste, safe kill-flash

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: plans 001-003 must be DONE per `plans/README.md`.
> Locate code by quoted excerpts (original `game.js` lines cited; post-002:
> renderer in `src/world.js`, collectibles in `src/collectibles.js`,
> characters in `src/characters.js`, indicators/kill-flash in `src/ui.js`,
> collisions in `src/enemies.js` / `src/game.js`).

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/003-frame-rate-independence.md
- **Category**: perf / bug
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

Four small rots, one plan: (1) the renderer never sets a device pixel ratio, so the game is **blurry on every retina/mobile screen**; (2) every collectible and enemy allocates fresh geometries+materials that are removed from the scene but never `dispose()`d or shared — GPU memory grows all session (hundreds of allocations in a long run); (3) the hot loop re-queries the DOM (`getElementById` per frame) and rebuilds the player's world AABB once per enemy plus once for collectibles every frame — `Box3.setFromObject` traverses all ~10 child meshes each time; (4) the "KILL!" indicator tries to flash by toggling opacity every frame against a 0.3s CSS transition — the net effect is a static shimmer (and a naive "fix" would produce a 30Hz strobe, which is a photosensitivity hazard; WCAG 2.3.1 requires ≤3 flashes/sec).

## Current state

- Renderer setup (`game.js:119-123`, src/world.js): `renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(...)` — no `setPixelRatio`. Resize handler (`game.js:596-605`) also lacks it.
- Collectible builder (post-002 single site in src/collectibles.js; originally ×3 at `game.js:468-470`, `491-493`, `516-518`): `new THREE.BoxGeometry(0.7, 0.7, 0.7)` + `new THREE.MeshStandardMaterial({ color: 0x76FF03 })` per spawn; removal is `scene.remove(collectible)` only (`game.js:805-806`).
- Character factory (post-002 `src/characters.js`): builds body/leg/eye/mouth geometries + 2 materials per character; enemy body color is mutated per frame via `bodyMesh.material.color.setHex(...)` (`game.js:679-681`).
- Kill flash (`game.js:615-623`, src/ui.js):
  ```js
  killIndicator.style.display = 'block';
  killIndicatorVisible = !killIndicatorVisible;             // every frame
  killIndicator.style.opacity = killIndicatorVisible ? '1' : '0.3';
  ```
  with `transition: opacity 0.3s ease;` at `style.css:226`. (Plan 003 converted the toggle to a 0.5s accumulator `state.killFlashClock`; the CSS conflict and final rate live here.)
- Per-frame AABBs: `new THREE.Box3().setFromObject(player)` inside the enemy loop (`game.js:740`) AND again for collectibles (`game.js:800`); plus a Box3 per enemy and per collectible per frame.
- Per-frame DOM queries: `document.getElementById('kill-indicator')` (`game.js:614`), `'score'` on collect (`game.js:808`), `'collect-time'` each tick.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |

## Scope

**In scope**: `src/world.js`, `src/collectibles.js`, `src/characters.js`, `src/enemies.js`, `src/ui.js`, `src/game.js`, `style.css` (kill-indicator rule only), `tests/resources.spec.js` (create).

**Out of scope**: gameplay values, camera (006), instanced-mesh rewrites or other deep perf work — this game does not need it; keep changes surgical.

## Git workflow

- Branch: `improve/007-rendering-hygiene`
- Commit style: `Fix: ...` / `Perf: ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Pixel ratio

In renderer setup and in the resize handler: `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));` (cap 2 — phones report 3+ and pay GPU cost for invisible gains).

**Verify (manual)**: on a retina display the blocks' edges are visibly sharper; `page.evaluate(() => window.__game.state.renderer.getPixelRatio())` ≥ 1 in tests (== min(dpr,2)).

### Step 2: Shared collectible resources

Module-level singletons in `src/collectibles.js`:
```js
const COLLECTIBLE_GEOMETRY = new THREE.BoxGeometry(0.7, 0.7, 0.7);
const COLLECTIBLE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x76FF03 });
```
Every spawned collectible is `new THREE.Mesh(COLLECTIBLE_GEOMETRY, COLLECTIBLE_MATERIAL)`. Removal stays `scene.remove` + array splice — shared resources are never disposed (they live for the app's lifetime, which is correct).

### Step 3: Shared character resources, per-enemy body material

In `src/characters.js`:
- Share geometries per `baseSize` via a small cache: `const geomCache = new Map(); // key: baseSize → {body, leg, eye, mouth}`.
- Share the face material per color via a cache. Share the PLAYER body material (only one player).
- The ENEMY body material must stay **per-instance** (`material = ENEMY_BODY_MATERIAL_TEMPLATE.clone()`) because the killable-state color mutates per enemy (`setHex` on a shared material would repaint every enemy at once — do not "optimize" this away).
- Add `disposeCharacter(group)` that disposes ONLY per-instance resources (the cloned enemy body material) and call it in the enemy-kill path (plan 004's `killEnemy`) and in `setupNewGame`'s enemy-clearing loop (`game.js:263-264`).

**Verify**: `tests/resources.spec.js` test 1 (below) passes.

### Step 4: Cache DOM refs and per-frame AABBs

- `src/ui.js`: resolve `score`, `collect-time`, `kill-indicator`, `message-box`, `message-text` elements once at init into a module-level `el` object; all writers use it. Score/timer writes only happen on value change (timer part done in plan 003 — mirror for score).
- Collision path: compute `playerBox` ONCE per frame (module-level `const _playerBox = new THREE.Box3()`, refreshed at the top of the enemy/collectible collision section with `_playerBox.setFromObject(player)`), reuse for all enemies and all collectibles; reuse per-loop scratch `_otherBox` similarly (`setFromObject` into it rather than `new` each iteration).

**Verify**: `grep -rn "getElementById" src/ | grep -v "init\|el\." ` → no per-frame call sites remain (all lookups happen in init paths); `grep -rn "new THREE.Box3" src/` → ≤ 2 module-level scratch instances, none inside loops.

### Step 5: Kill-flash, safe and actually flashing

- `style.css`: remove `transition: opacity 0.3s ease;` from `.kill-indicator` (it fights discrete flashing).
- `src/ui.js`: with plan 003's accumulator, toggle between opacity `1` and `0.35` every **0.5s** (1 flash/sec — well under the 3/sec photosensitivity limit, clearly visible). When no enemy is killable, hide and reset the accumulator so it always starts visible.

**Verify (manual)**: grow taller than an enemy — "KILL!" pulses ~once per second; screen-record 5s and confirm 5±1 pulses.

## Test plan

Create `tests/resources.spec.js` (pattern: smoke spec; uses `window.__game.state.renderer.info`):

1. **No geometry growth from the food cycle**: boot; read `renderer.info.memory.geometries`; via debug hook spawn 30 collectibles then remove them (or simulate 30 collect cycles by teleporting the player onto food repeatedly); read again → geometry count delta ≤ 1. (Before this plan the delta would be ~30; this is the leak regression test.)
2. **Pixel ratio applied**: `renderer.getPixelRatio() === Math.min(devicePixelRatio, 2)`.
3. **Kill flash cadence**: make first enemy killable via evaluate (`state.playerScale = 10; state.player.scale.set(10,10,10)`), sample `#kill-indicator` opacity every 100ms for 2s → both values observed, and value changes ≤ 6 times (≈1Hz toggle, allowing jitter).

**Verify**: `npm test` → all pass.

## Done criteria

- [ ] `grep -rn "setPixelRatio" src/` → 2 sites (init + resize)
- [ ] `grep -rn "new THREE.MeshStandardMaterial" src/collectibles.js` → 1 (module-level)
- [ ] `npm run lint` / `npm test` exit 0 (incl. resources.spec.js)
- [ ] style.css `.kill-indicator` has no opacity transition
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plans 001-003 not DONE; excerpts unlocatable.
- After step 3 all enemies change color together — a body material got shared; re-read step 3's per-instance requirement.
- `renderer.info.memory.geometries` fluctuates unexpectedly even without the food cycle (three.js internals) — pin the assertion to the delta across the cycle only; if still noisy, report with numbers.

## Maintenance notes

- Anyone adding a new mesh type should follow the shared-geometry/material pattern; per-instance materials only where per-instance mutation exists (enemy body is the exemplar).
- The dpr cap of 2 is a deliberate perf/quality trade for phones; revisit only with profiling.
- If plan 010 (sound) adds a "collect" pulse to the score display, keep the write-on-change discipline.
