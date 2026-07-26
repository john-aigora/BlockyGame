# Plan 004: Stop the world when the game ends; make enemy-kill iteration safe

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: plans 001-003 must be DONE per `plans/README.md`.
> Locate code by quoted excerpts (original `game.js` lines cited; the logic
> lives in `src/game.js` / `src/enemies.js` after plan 002). If an excerpt is
> missing, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/003-frame-rate-independence.md
- **Category**: bug
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

After game over, the world keeps simulating behind the message box: the frame loop only checks `isPaused`, and the enemy update block is not gated on `gameActive`. Enemies keep chasing the corpse, re-trigger `showMessage` on every touch, and — if a *killable* enemy touches the dead player — it still "dies", spawns two bigger enemies and four food blocks, forever. Separately, killing an enemy calls `enemies.splice(index, 1)` inside `enemies.forEach(...)`, which skips the next enemy for a frame and passes stale indexes into `avoidOtherEnemies`. A comment at `game.js:761` claims `return; // Exit forEach loop and update function` — a `return` in a forEach callback does neither.

## Current state

- Loop gate (`game.js:824-830`, src/game.js post-002/003): `if (!state.isPaused) update(dt);` — no `gameActive` check; `update()` early-returns only on `!player || isPaused` (`game.js:610`).
- Player movement IS gated (`game.js:767` `if (gameActive) {...}`) — enemies are not.
- The kill branch (`game.js:742-756`, src/enemies.js):
  ```js
  if (playerBox.intersectsBox(enemyBox)) {
      if (canKillSpecificEnemy(enemyGroup)) {
          const enemyDeathPosition = enemyGroup.position.clone();
          scene.remove(enemyGroup);
          enemies.splice(index, 1);
          for (let i = 0; i < 4; i++) { spawnCollectibleAtPosition(enemyDeathPosition); }
          spawnNewEnemies();
      } else {
          gameActive = false;
          ...
          showMessage(`GAME OVER! ...`);
          return; // Exit forEach loop and update function if game over  <-- FALSE
      }
  }
  ```
- `avoidOtherEnemies(enemyGroup, index)` (`game.js:917-935`) compares `index !== otherIndex` — index identity breaks the frame an element is spliced.
- Game-over is triggered from two places: the collision above and the collect-clock expiry (post-003, in `src/timers.js`), each assembling its own message.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |

## Scope

**In scope**: `src/game.js`, `src/enemies.js`, `src/timers.js`, `src/ui.js` (endGame lives wherever showMessage lives), `tests/gameover.spec.js` (create).

**Out of scope**:
- Wrap math / avoidance strength (plan 005), camera (006), death-screen redesign (008).
- Pausing the RENDER after game over — keep rendering (the scene behind the message box should stay visible, just frozen).

## Git workflow

- Branch: `improve/004-game-over-correctness`
- Commit style: `Fix: ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Single endGame path

Create one exported function (in `src/game.js` or `src/ui.js`, wherever `showMessage` landed):

```js
export function endGame(reason) {
    if (!state.gameActive) return;      // idempotent — safe against double triggers
    state.gameActive = false;
    showMessage(`GAME OVER! ${reason} Final Score: ${state.score}`);
}
```

Replace both existing game-over sites (enemy collision; collect-clock expiry) with `endGame('The enemy caught you.')` / `endGame('Failed to collect a block in time.')`. Keep the final user-visible strings containing "GAME OVER" and "Final Score" — the smoke tests assert on "GAME OVER".

**Verify**: `grep -rn "GAME OVER" src/` → exactly one construction site (inside `endGame`).

### Step 2: Gate the simulation

In `update(dt)` add `gameActive` to the early return: `if (!state.player || state.isPaused || !state.gameActive) return;` — but ensure `updateCameraPosition()` and the render still run each frame (they are outside `update()` / at the loop level). After this, nothing moves post-mortem, indicators freeze as-is, and the message box stays.

**Verify**: manual — die, watch 10s: no enemy moves, no new enemies/food appear, no repeated message flicker.

### Step 3: Safe kill iteration

In `src/enemies.js`, replace the `enemies.forEach((enemyGroup, index) => ...)` movement/collision loop with a backwards indexed loop:

```js
for (let i = state.enemies.length - 1; i >= 0; i--) {
    const enemyGroup = state.enemies[i];
    // ...existing movement...
    if (collidesWithPlayer) {
        if (canKillSpecificEnemy(enemyGroup)) {
            killEnemy(enemyGroup, i);       // splice(i,1) — safe going backwards
            continue;
        } else {
            endGame('The enemy caught you.');
            return;                          // NOW actually exits the enemy update
        }
    }
}
```

`killEnemy(enemyGroup, i)` = death position clone + `scene.remove` + `splice(i, 1)` + 4× spawnAtPosition + `spawnNewEnemies()` (newly spawned enemies are appended; the backwards loop naturally does not process them this frame — same as today's forEach semantics).

Change `avoidOtherEnemies(enemyGroup, index)` to identity-by-reference: signature becomes `avoidOtherEnemies(enemyGroup)` and the inner check `if (otherEnemyGroup !== enemyGroup)`.

**Verify**: `grep -rn "enemies.forEach" src/` → no matches in the movement path; `npm test` → all pass.

## Test plan

Create `tests/gameover.spec.js` (pattern: `tests/smoke.spec.js`):

1. **World freezes on death**: unpause; wait for `#message-box` visible (≤25s); then `const a = await page.evaluate(() => window.__game.state.enemies.map(e => [e.position.x, e.position.z]))`; wait 2s; read again → deep-equal (positions unchanged). Also capture `enemies.length` twice → equal (no post-mortem spawning).
2. **Message renders once**: after death, assert `#message-text` textContent contains exactly one "GAME OVER" occurrence and remains identical across a 2s window.
3. **Restart still works after the freeze** (reuses smoke test 4's flow; keep it here as a guard for the new early-return interacting with `resetGame`).

**Verify**: `npm test` → all pass.

## Done criteria

- [ ] `grep -rn "gameActive = false" src/` → only inside `endGame`
- [ ] `grep -c "GAME OVER" src/**/*.js` → 1
- [ ] `npm run lint` exits 0; `npm test` exits 0 including `gameover.spec.js`
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plans 001-003 not DONE; excerpts unlocatable.
- Test 1 shows positions still changing after death — the gate is incomplete (another update path exists); find it or report, do not loosen the test.
- Implementing this requires touching wrap/avoidance math — that is plan 005; stop and report the entanglement instead.

## Maintenance notes

- `endGame(reason)` is now the ONLY legal way to end a run; future death causes (body-segment collisions, hazards) must call it.
- Plan 008 will restyle the death screen; it builds on `endGame` and must keep its idempotence.
- The backwards loop + append-during-iteration semantics ("new spawns act next frame") is intentional; document-worthy if anyone adds mid-frame spawn logic.
