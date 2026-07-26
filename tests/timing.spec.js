import { test, expect } from '@playwright/test';
import { startGame } from './helpers.js';

// Movement/timer specs measure against the GAME clock (state.runTime, the
// same dt the movement integrates), never performance.now(): under
// parallel-suite load the MAX_DELTA frame clamp (src/game.js) dilates game
// time well below wall time, which would shrink the measured movement while
// a wall-clock denominator kept growing. Wall-clock values appear only as
// generous wait ceilings.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
});

test('pausing and resuming does not refill the collect countdown', async ({ page }) => {
  await startGame(page); // Dismiss the start overlay and begin the run
  await expect
    .poll(async () => Number(await page.locator('#collect-time').textContent()), { timeout: 30000 })
    .toBeLessThanOrEqual(12);
  await page.locator('#pause-button').click(); // pause
  await page.locator('#pause-button').click(); // resume
  // Regression for the old exploit: resuming must NOT reset the timer to 15
  const shown = Number(await page.locator('#collect-time').textContent());
  expect(shown).toBeLessThanOrEqual(12);
});

test('hiding the tab auto-pauses a running game', async ({ page }) => {
  await startGame(page);
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(false);
  // Emulate the tab being hidden: override document.hidden and fire the event
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(true);
  await expect(page.locator('#pause-button')).toHaveText('Resume');
  // Restore so the page behaves normally for the rest of the test
  await page.evaluate(() => {
    delete document.hidden;
  });
});

test('ArrowUp moves the player at roughly actualPlayerSpeed units/second', async ({ page }) => {
  await startGame(page);
  await page.keyboard.down('ArrowUp');
  const start = await page.evaluate(() => ({
    z: window.__game.state.player.position.z,
    speed: window.__game.state.actualPlayerSpeed,
    t: window.__game.state.runTime,
  }));
  // Hold the key until at least 1 GAME second has simulated
  await page.waitForFunction(
    (t0) => window.__game.state.runTime >= t0 + 1,
    start.t,
    { timeout: 60000 }
  );
  const end = await page.evaluate(() => ({
    z: window.__game.state.player.position.z,
    t: window.__game.state.runTime,
  }));
  await page.keyboard.up('ArrowUp');
  const moved = start.z - end.z; // ArrowUp moves toward -z
  const expected = start.speed * (end.t - start.t); // Both samples are frame-consistent
  // Generous ±30% bounds: catches double-integration (2x) or missing-dt (60x) bugs
  expect(moved).toBeGreaterThan(expected * 0.7);
  expect(moved).toBeLessThan(expected * 1.3);
});

test('WASD alias: holding D moves the player toward +x', async ({ page }) => {
  await startGame(page);
  await page.keyboard.down('d');
  const start = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    speed: window.__game.state.actualPlayerSpeed,
    t: window.__game.state.runTime,
  }));
  await page.waitForFunction(
    (t0) => window.__game.state.runTime >= t0 + 0.5,
    start.t,
    { timeout: 60000 }
  );
  const end = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    t: window.__game.state.runTime,
  }));
  await page.keyboard.up('d');
  const moved = end.x - start.x; // D aliases ArrowRight: toward +x
  const expected = start.speed * (end.t - start.t);
  expect(moved).toBeGreaterThan(expected * 0.7);
  expect(moved).toBeLessThan(expected * 1.3);
});
