# Plan 012: Mobile polish — touch that doesn't fight the UI, layouts that fit phones

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: plans 002 and 008 must be DONE per
> `plans/README.md` (touch code lives in `src/input.js`; the start overlay
> exists). Locate code by quoted excerpts; original `game.js` lines cited.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED (touch behavior differs across devices; manual device checks listed)
- **Depends on**: plans/008-start-and-death-screens.md
- **Category**: bug / ux
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

Mobile is where a shareable browser game gets played (the todo's "Enhanced Mobile UI/UX" section knows it). Today: a drag that *starts on a button* both moves the player AND clicks the button on release; the "mobile adjustments" media query in `style.css` is an empty comment (`style.css:263-264` — a comment with no rule after it); touch-capable laptops are misdetected as mobile and get +75% player speed (`game.js:90-93`); and nothing prevents iOS double-tap zoom or overscroll on the UI.

## Current state

- Touch start doesn't exclude buttons from MOVEMENT (`game.js:183-196`, post-002 `src/input.js`): `preventDefault` is skipped for buttons, but `touchActive = true` and the drag origin are set regardless of target:
  ```js
  gameScreenContainer.addEventListener('touchstart', (e) => {
      const targetElement = e.target;
      if (!targetElement.closest('button')) { e.preventDefault(); }
      if (e.touches.length > 0) { touchActive = true; ... }
  });
  ```
- Mobile detection (`game.js:90`): `isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || /Mobi|Android/i.test(navigator.userAgent);` — true on touchscreen Windows laptops; sets `playerSpeed = BASE_PLAYER_SPEED * MOBILE_SPEED_MULTIPLIER` (1.75×).
- `style.css:263` ends with `/* Media Query for Mobile Screen Adjustments */` and nothing after.
- Layout: `#game-container` 90vw × 65vh (max 800×550), `#ui-container` below with instructions always expanded (`index.html:33-41`); `body { height: 100vh }` (`style.css:16` — iOS URL-bar issues; `dvh` is the modern fix).
- Buttons: `.game-button` padding 6px 10px, font 12px (`style.css:157-175`) — under the 44px recommended touch target.
- Viewport meta (`index.html:6`): `width=device-width, initial-scale=1.0` — no `viewport-fit`; double-tap zoom not suppressed (CSS `touch-action` is the modern control).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |

## Scope

**In scope**: `src/input.js`, `style.css`, `index.html` (viewport meta only), `tests/touch.spec.js` (create).

**Out of scope**: LBS-style continuous movement / joystick redesign (plan 014's spike decides that), button REPOSITIONING beyond size/spacing (todo mentions it; defer to the spike's verdict on control scheme), any desktop-only styling.

## Git workflow

- Branch: `improve/012-mobile-polish`
- Commit style: `Fix: ...` / `Feat: ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Touches that start on UI never drive movement

In `src/input.js` touchstart handler: if `e.target.closest('button')` (or the start overlay / message box), return WITHOUT setting `touchActive` — buttons handle their own taps. Keep `preventDefault()` only for non-UI touches. Mirror the same guard in `touchmove` (ignore moves when `touchActive` is false — already implied, verify).

Track the driving touch by `identifier` (`e.changedTouches[0].identifier` at start; on move/end, find that identifier in `e.changedTouches`/`e.touches` instead of always reading `e.touches[0]`) so a second finger tapping Pause mid-drag doesn't hijack the movement vector.

**Verify**: `tests/touch.spec.js` tests 1-2 (below) pass.

### Step 2: Honest device detection

Replace the `isMobile` expression with capability + form-factor:
```js
const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
state.isMobile = isCoarsePointer;   // speed boost only for touch-primary devices
```
(Keep the variable name/semantics; a touch-laptop with a mouse reports `pointer: fine` and now correctly gets desktop speed. The 1.75× multiplier itself is unchanged.)

### Step 3: CSS touch hardening + responsive layout

- `.game-button, #start-button, #restart-button, #mute-button { touch-action: manipulation; }` (kills double-tap zoom on controls) and `#game-container canvas { touch-action: none; }` (the drag surface).
- `body { height: 100dvh; }` with the existing `100vh` kept as a fallback line above it.
- Fill in the empty media query at the end of `style.css`:
  ```css
  @media (max-width: 600px) {
      #game-container { width: 100vw; height: 60dvh; border-width: 3px; border-radius: 0; }
      .game-button { padding: 12px 14px; font-size: 11px; min-width: 44px; min-height: 44px; }
      #ui-container { width: 100vw; font-size: 0.9em; padding: 8px; }
      #instructions { display: none; }            /* start overlay now teaches the game */
      .ui-element { font-size: 1em; }
  }
  ```
  Rationale for hiding `#instructions` on small screens: plan 008's start overlay carries the teaching; the always-open instruction block eats a third of a phone screen.
- Viewport meta: `content="width=device-width, initial-scale=1.0, viewport-fit=cover"`.

**Verify**: `npm test` (existing suites) still pass; manual matrix below.

## Test plan

Create `tests/touch.spec.js` using Playwright touch emulation (`test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })`):

1. **Button tap doesn't move the player**: start a run; read player x/z; `page.tap('#pause-button')`; read again → unchanged (and game paused).
2. **Drag moves the player**: resume; `page.touchscreen` drag from canvas center 120px right (use `page.locator('#game-container canvas')` bounding box + `page.touchscreen.tap`… for a drag use CDP-free `page.mouse` is wrong for touch — use `page.locator(...).dispatchEvent` with constructed TouchEvent init if `touchscreen` lacks drag, or Playwright's `page.touchscreen.tap` + manual `dispatchEvent('touchmove')` sequence); assert player x increased. If synthetic TouchEvent construction gets fragile, drive `window.__game.debug` by calling the exported touch handlers with fabricated event objects — the goal is the HANDLER logic (identifier tracking, button exclusion), not browser event plumbing.
3. **Mobile layout applies**: at 390px viewport, `#instructions` is hidden; `.game-button` computed min-height ≥ 44px.

**Verify**: `npm test` → all pass.

Manual device matrix (record results in the PR/report; emulators acceptable):
- iOS Safari (or simulator): drag to move; double-tap on Pause does not zoom; URL bar show/hide doesn't clip the UI container.
- Android Chrome (or devtools device mode): same checks.

## Done criteria

- [ ] `grep -n "Mobi|Android" src/` → no matches (UA sniffing gone)
- [ ] `style.css` media query is non-empty; `touch-action` rules present
- [ ] `npm run lint` / `npm test` exit 0 (incl. touch.spec.js)
- [ ] Manual matrix recorded
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plans 002/008 not DONE.
- Playwright touch emulation can't express the drag test after the fallback strategy in Test 2 — report with what was attempted; do not ship the handler change untested.
- Hiding `#instructions` orphans information the start overlay doesn't cover (compare texts) — if so, move the missing line into the overlay first, then hide.

## Maintenance notes

- Plan 014's movement spike may replace the drag scheme entirely; the button-exclusion and identifier-tracking logic in `src/input.js` is control-scheme-agnostic and should survive.
- `pointer: coarse` is the house device signal now — no UA sniffing may return in review.
- If the game ever goes fullscreen-canvas on mobile, revisit `#ui-container` (it would move into an overlay HUD).
