# Plan 006: Camera that frames the game — bounded two-way zoom, growth-aware framing, fog that follows

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: plans 001-003 must be DONE per `plans/README.md`
> (004/005 are independent of this plan). Locate code by quoted excerpts
> (original `game.js` lines cited; post-002 camera/zoom code lives in
> `src/world.js`, wiring in `src/game.js`, buttons in `index.html`/`style.css`).

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW-MED (visual feel; bounded by explicit clamps and tests)
- **Depends on**: plans/003-frame-rate-independence.md
- **Category**: bug / ux
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

Verified live during the audit: clicking **Zoom Out four times makes the whole game invisible** — the camera passes the fog's far distance (100) and everything fades to solid teal. There is no zoom-in and no reset, and **Restart keeps the broken zoom**, so a player (a kid, most likely) who over-taps the button is stuck with a blank game until they reload the page. Separately, the camera never adapts to player growth — by scale ~4 the player dominates the screen, which is *why* people reach for the zoom button in the first place.

## Current state

- Fog fixed at creation (`game.js:109`, src/world.js): `scene.fog = new THREE.Fog(0x004D40, 20, 100);`
- One-way multiplicative zoom (`game.js:984-992`):
  ```js
  function zoomOutCamera() {
      activeCameraYOffset *= ZOOM_OUT_FACTOR;   // 1.5, unbounded
      activeCameraZOffset *= ZOOM_OUT_FACTOR;
      ...
  }
  ```
- Camera follow (`game.js:995-1000`): offset `(0, activeCameraYOffset, activeCameraZOffset)` from player, base (15, 12) → base distance ≈ 19.2. 4 clicks ⇒ ≈ 97; 5 ⇒ ≈ 146 (past fog far=100).
- `setupNewGame()` (`game.js:247-305`) never resets `activeCameraYOffset/ZOffset`.
- Single button `#zoom-toggle-button` labeled "Zoom Out" (`index.html:23`), positioned bottom-right (`style.css:203-206`).
- Shadow camera frustum is ±30 around the light (`game.js:137-140`) — at far zoom shadows vanish outside it; acceptable, but the far plane must cover the largest allowed camera distance.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |

## Scope

**In scope**: `src/world.js`, `src/game.js`, `src/constants.js`, `src/state.js`, `index.html` (zoom buttons), `style.css` (zoom button styles), `tests/camera.spec.js` (create).

**Out of scope**: enemy/food logic; the speed button; shadow-quality work beyond the far-plane note; any smoothing of PLAYER movement.

## Git workflow

- Branch: `improve/006-camera-zoom-fog`
- Commit style: `Fix: ...` / `Feat: ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace raw offsets with a clamped zoom model

In `src/constants.js`:
```js
export const ZOOM_STEP = 1.25;
export const ZOOM_MIN = 0.6;     // slightly closer than default
export const ZOOM_MAX = 3.0;     // ~2.9x default distance, still inside a scaled fog
export const GROWTH_FRAME_FACTOR = 0.35; // how much camera pulls back per unit of playerScale growth
```
In `src/state.js`: `zoomLevel: 1.0` replaces `activeCameraYOffset/activeCameraZOffset`.

Camera math in `updateCameraPosition()`:
```js
const growthComp = 1 + (state.playerScale - 1) * GROWTH_FRAME_FACTOR;
const targetY = INITIAL_CAMERA_Y_OFFSET * state.zoomLevel * growthComp;
const targetZ = INITIAL_CAMERA_Z_OFFSET * state.zoomLevel * growthComp;
// smooth: state.camY += (targetY - state.camY) * (1 - Math.exp(-6 * dt)); same for camZ
// dt comes from update(); when called outside update (paused zoom click), pass dt = 1/60
camera.position.set(player.position.x, player.position.y + state.camY, player.position.z + state.camZ);
camera.lookAt(player.position);
```
`zoomIn()` / `zoomOut()` multiply/divide `state.zoomLevel` by `ZOOM_STEP` and clamp to `[ZOOM_MIN, ZOOM_MAX]`, then (as today at `game.js:988-991`) force a camera update + render so zoom responds while paused.

**Verify**: dev server — clicking zoom out repeatedly stops changing the view after ~5 clicks (clamped), game always visible.

### Step 2: Fog follows the camera distance

After computing `camY/camZ` each frame (and on zoom clicks), update fog instead of leaving it fixed:
```js
const camDist = Math.hypot(state.camY, state.camZ);
scene.fog.near = camDist * 1.1;
scene.fog.far  = camDist * 4.5;
```
At default distance (~19) that's near≈21/far≈86 — close to today's 20/100 look; at max zoom everything stays visible with the same depth-haze character. Camera far plane is 1000 (`game.js:114`) — `ZOOM_MAX` keeps `camDist*4.5 ≈ 260` well under it; do not raise `ZOOM_MAX` past ~8 without revisiting.

**Verify (manual)**: at min, default, and max zoom the player, enemies, and ground are all clearly visible; fog haze still visible in the distance at every level.

### Step 3: Reset on new game

`setupNewGame()` sets `state.zoomLevel = 1.0` and snaps `state.camY/camZ` to the unsmoothed targets (no lerp-in from the previous game's zoom).

**Verify**: zoom to max, die or Restart → the new run starts at the default framing.

### Step 4: Two-way buttons

`index.html`: replace the single zoom button with:
```html
<button id="zoom-in-button" class="game-button">+</button>
<button id="zoom-out-button" class="game-button">−</button>
```
`style.css`: keep them stacked bottom-right (`#zoom-in-button { bottom: 52px; right: 10px; }`, `#zoom-out-button { bottom: 10px; right: 10px; }`), min 40px square touch targets. Wire listeners where the old one was (`game.js:166`). Remove the `#zoom-toggle-button` CSS block.

**Verify**: `grep -rn "zoom-toggle-button" index.html style.css src/` → no matches; both buttons work in dev server.

## Test plan

Create `tests/camera.spec.js` (pattern: smoke spec, uses `window.__game.state`):

1. **Zoom is clamped**: click `#zoom-out-button` 12 times → `state.zoomLevel === ZOOM_MAX` (read constants via `page.evaluate(() => window.__game.state.zoomLevel)`; assert ≤ 3.01). Click `#zoom-in-button` 20 times → `zoomLevel` ≥ 0.59 and ≤ 0.61.
2. **Fog tracks camera**: at max zoom, `page.evaluate(() => { const s = window.__game.state; return s.scene.fog.far > Math.hypot(s.camY, s.camZ); })` → true. (Expose `scene` on state if plan 002 didn't.)
3. **Restart resets zoom**: max out zoom, click `#restart-game-button`, assert `zoomLevel === 1`.
4. **Growth pulls back**: set `state.playerScale = 5` via evaluate, run 1s, assert `state.camY` grew vs its value at scale 1 (± tolerance).

**Verify**: `npm test` → all pass.

## Done criteria

- [ ] `grep -rn "ZOOM_OUT_FACTOR\|activeCameraYOffset" src/` → no matches (old model gone)
- [ ] `npm run lint` / `npm test` exit 0 (incl. camera.spec.js)
- [ ] Manual: at every zoom level the game is visible; restart resets framing
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plans 001-003 not DONE; excerpts unlocatable.
- After step 2 the scene looks washed-out or the background band at the horizon looks broken — fog near/far ratios need the step-2 constants exactly; if they're in place and it still looks wrong, screenshot and report rather than eyeballing new ratios.
- Smoothing introduces motion sickness-y lag (camera trails the player visibly at 1x speed) — reduce the `-6` exponent factor toward `-10`; if still bad, report.

## Maintenance notes

- `GROWTH_FRAME_FACTOR` is the "how big does the player feel" knob; balance work (plan 011) may want it lower if growth should feel more imposing.
- If a future feature raises `ZOOM_MAX`, re-check the far plane (1000) and the shadow frustum (±30) — both are sized for the current range.
- The kill-flash/indicator layer reads projected positions every frame; nothing there depends on fog, but indicator visibility DOES depend on the camera frustum — plan 007 touches that file, coordinate if executed concurrently.
