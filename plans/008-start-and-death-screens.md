# Plan 008: A real start screen and a real death screen

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: plans 001-004 must be DONE per `plans/README.md`.
> This plan REWRITES two smoke tests — read `tests/smoke.spec.js` first and
> keep all other tests passing.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/004-game-over-loop-correctness.md
- **Category**: direction (UX)
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

Verified in the audit: the game boots into a **frozen scene** whose only cue is a small "Resume" button in a corner — a first-time player (or a parent's coworker clicking the Vercel link) sees what looks like a broken page. The maintainers' own `todo.md` lists "Improve 'New Game' start flow/button for user-friendliness". Death currently shows a bare sentence + "Play Again"; after this plan it becomes a proper moment (title, score, restart affordances) that plan 009 extends with the high-score board.

## Current state

- Boot state (`game.js:247-259`, src/game.js `setupNewGame`): `gameActive = true; isPaused = true;` and the pause button is set to text "Resume". No overlay exists.
- Keyboard handler ignores everything when the game is over (`game.js:568-569`): `if (!gameActive) return;` — so Space/Enter can't restart; only the "Play Again" click works.
- Message box (`index.html:15-18`): `#message-box` > `#message-text` + `#restart-button` ("Play Again"); shown via `showMessage(...)` with `display: block` (`game.js:834-839`); styled at `style.css:95-120` (red border, dark background).
- `endGame(reason)` exists post-004 as the single game-over path.
- Smoke tests (`tests/smoke.spec.js`) currently: (a) boot test asserts pause button visible; (b) two tests start the game by clicking `#pause-button`. These change here.
- Instructions block is a permanent sibling below the canvas (`index.html:33-41`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |

## Scope

**In scope**: `index.html`, `style.css`, `src/game.js`, `src/ui.js`, `src/input.js`, `tests/smoke.spec.js` (two tests updated), `tests/gameover.spec.js` (start-flow helper updated).

**Out of scope**: high-score storage/rendering (plan 009 — but see step 3's placeholder element it will fill), sound hooks (plan 010), any change to in-round gameplay.

## Git workflow

- Branch: `improve/008-start-death-screens`
- Commit style: `Feat: ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Start overlay

`index.html` — inside `#game-container`, add:
```html
<div id="start-overlay">
    <h1>BLOCKY COLLECTOR 3D</h1>
    <p class="tagline">Collect. Grow. Hunt the yellow ones.</p>
    <button id="start-button" class="game-button">▶ START</button>
    <p class="start-hint">or press any key</p>
</div>
```
`style.css` — full-container overlay (absolute, inset 0, `z-index: 90` — below `#top-controls` at 100 is fine since it covers the same area; ensure the four corner buttons are NOT clickable through it by giving the overlay `z-index: 110`), dark translucent background (`rgba(0,0,0,0.75)`), centered flex column, arcade font already inherited. `#start-button` min 48px tall.

Flow in `src/game.js`:
- `setupNewGame()` keeps booting paused, and shows the overlay when it's a *fresh boot or post-death restart* (always, for simplicity — restart returns you to the start screen).
- New `startRun()`: hides the overlay, and if `state.isPaused` calls `togglePause()` (which starts the clock). Wire: `#start-button` click; any `keydown` while overlay visible; any `pointerdown` on the overlay. All go through one `startRun()`.
- The pause button no longer reads "Resume" at boot: `setupNewGame` sets it to "Pause" + removes the `paused` class ONLY in visual terms — simplest correct approach: `setupNewGame` leaves `isPaused = true` but the overlay owns the boot UX; `togglePause()` still manages the button text when used mid-run. After `startRun()`, the button correctly shows "Pause".

**Verify (manual)**: boot → overlay with title; click START (or press a key) → overlay gone, world moving, pause button says "Pause". Pause/resume mid-run still works via button and Space.

### Step 2: Death screen

Rework `showMessage` usage for deaths — `endGame(reason)` now calls `showDeathScreen(reason)`:
```html
<!-- #message-box becomes: -->
<h2 id="death-title">GAME OVER</h2>
<p id="death-reason"></p>
<p class="final-score">Score: <span id="final-score">0</span></p>
<div id="hiscore-slot"></div>   <!-- plan 009 fills this; empty and invisible for now -->
<button id="restart-button">Play Again</button>
<p class="start-hint">or press Space</p>
```
Populate `#death-reason` with the reason sentence and `#final-score` with `state.score`. Keep the combined text of the box containing the strings "GAME OVER" and score — update the smoke assertions as described in the Test plan (they currently look at `#message-text`, which this step REPLACES; that's expected).

`style.css`: restyle `.message-box` minimally (existing red-border arcade style is good; add spacing for the new children). Delete the now-unused `#message-text` rule if any.

### Step 3: Restart from keyboard

In `src/input.js` `onKeyDown`, replace the blanket `if (!gameActive) return;` with:
```js
if (!state.gameActive) {
    if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault();
        resetGame();        // returns to the start overlay per step 1
    }
    return;
}
```
(Import `resetGame` or route via a callback — match how post-002 modules share functions.)

**Verify (manual)**: die → death screen; press Space → start overlay; press any key → new run begins.

## Test plan

Update `tests/smoke.spec.js`:
- Boot test: assert `#start-overlay` visible and contains "BLOCKY", canvas visible behind it.
- Replace every `page.locator('#pause-button').click()` game-start step with `page.locator('#start-button').click()` (add a tiny helper `async function startGame(page)` at the top of the file; also export/copy it into `tests/gameover.spec.js` and any other spec that started via pause).
- Game-over test: assert `#message-box` visible, `#death-title` has "GAME OVER", `#final-score` matches `/^\d+$/`.
- Play-Again test: after clicking `#restart-button`, assert `#start-overlay` is visible again and `#score` shows "0"; then `#start-button` starts a fresh run (collect-time decreasing).

Add one new test: **keyboard restart** — die, `page.keyboard.press('Space')`, assert start overlay visible.

**Verify**: `npm test` → all pass, all spec files.

## Done criteria

- [ ] Boot shows the start overlay; no test or manual path relies on clicking "Resume" to begin
- [ ] `grep -rn "message-text" src/ index.html tests/` → no matches (replaced by structured death screen)
- [ ] `npm run lint` / `npm test` exit 0
- [ ] `#hiscore-slot` exists and is empty (plan 009's mount point)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plans 001-004 not DONE.
- Any OTHER spec file still starts games via `#pause-button` and fails — update it with the shared helper; if a spec resists (asserts pause-button text semantics), report rather than deleting assertions.
- Focus/keydown wiring makes Space trigger BOTH restart and pause in the same press — event ordering bug; fix with the `state.gameActive` guard shown, or report.

## Maintenance notes

- Plan 009 mounts the leaderboard into `#hiscore-slot` — keep that id stable.
- Plan 010 hooks `startRun()` for the AudioContext-resume user gesture — keep `startRun()` the single entry point for "a run begins".
- The overlay intentionally also serves as the post-death "menu"; if a distinct main menu grows later, split it then, not now.
