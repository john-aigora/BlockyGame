import { test, expect } from '@playwright/test';

// Shared game-start helper (plan 008). The game boots into the start
// overlay; every spec that needs a running game goes through the real
// entry point — the overlay's START button — never the pause button.
// Also used after "Play Again", which returns to the start overlay.
export async function startGame(page) {
  await page.locator('#start-button').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
}

// Plays an idle run out to the death screen (collect-clock expiry or enemy
// contact). The collect clock needs 15 GAME seconds — but game time is not
// wall time: under parallel-suite load, headless software rendering drops
// below 20fps and the MAX_DELTA=0.05 frame clamp (src/game.js) dilates game
// time to a fraction of wall time, so 15 game seconds can cost 40+ wall
// seconds. The wait is condition-based — green runs still finish the moment
// the death screen appears (~16s); the large ceilings only buy headroom
// when the machine is saturated.
export async function waitForGameOver(page) {
  test.setTimeout(150000);
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 120000 });
}

// Waits until the simulation advances `seconds` more GAME-clock seconds
// (state.runTime is dt-accumulated in update()). Use this — never a
// wall-clock waitForTimeout — before asserting on anything the game clock
// drives; the generous wall ceiling exists only for load headroom.
export async function waitGameSeconds(page, seconds) {
  const start = await page.evaluate(() => window.__game.state.runTime);
  await page.waitForFunction(
    ([t0, s]) => window.__game.state.runTime >= t0 + s,
    [start, seconds],
    { timeout: 60000 }
  );
}
