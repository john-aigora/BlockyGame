import { test, expect } from '@playwright/test';
import { openGame, startGame, waitGameSeconds } from './helpers.js';

// Movement/timer specs measure against the GAME clock (state.runTime, the
// same dt the movement integrates), never performance.now(): under
// parallel-suite load the MAX_DELTA frame clamp (src/game.js) dilates game
// time well below wall time, which would shrink the measured movement while
// a wall-clock denominator kept growing. Wall-clock values appear only as
// generous wait ceilings.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
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

test('collecting food resets the collect clock and grows the player', async ({ page }) => {
  // The core survival loop, through the REAL collision path: let the
  // countdown burn down a few GAME seconds, teleport the player onto an
  // existing food block, and assert the clock refilled toward 15 while the
  // player got taller.
  await startGame(page);
  await waitGameSeconds(page, 3);
  const before = await page.evaluate(() => ({
    timeLeft: window.__game.state.collectTimeLeft,
    scale: window.__game.state.playerScale,
  }));
  expect(before.timeLeft).toBeLessThan(13); // The countdown really ran
  expect(before.scale).toBe(1);
  // Teleport onto the food block FARTHEST from the boot enemy (torus
  // distance — entity images are player-relative, so raw deltas can hide a
  // seam neighbor): the collect must land before any enemy-contact death.
  await page.evaluate(() => {
    const s = window.__game.state;
    const axis = (a, b) => {
      const d = Math.abs(a - b) % 200; // worldSize
      return Math.min(d, 200 - d);
    };
    const enemy = s.enemies[0];
    let best = s.collectibles[0];
    let bestD = -1;
    for (const c of s.collectibles) {
      const d = Math.hypot(axis(c.position.x, enemy.position.x), axis(c.position.z, enemy.position.z));
      if (d > bestD) { bestD = d; best = c; }
    }
    s.player.position.set(best.position.x, 0, best.position.z);
  });
  // Frame-driven: the collect lands on the first running frame. State and
  // DOM are captured inside the first poll that observes the growth, so the
  // refilled clock is read before it can tick meaningfully back down.
  const handle = await page.waitForFunction(
    () => {
      const s = window.__game.state;
      return s.playerScale > 1
        ? { scale: s.playerScale, timeLeft: s.collectTimeLeft, shown: document.getElementById('collect-time').textContent }
        : false;
    },
    null,
    { timeout: 10000 }
  );
  const after = await handle.jsonValue();
  expect(after.scale).toBeGreaterThanOrEqual(1.099); // += growthFactor (0.1), minus float drift
  expect(after.timeLeft).toBeGreaterThan(12); // Refilled toward initialCollectTime (15)
  expect(after.timeLeft).toBeGreaterThan(before.timeLeft);
  // Same-JS-turn snapshot: the HUD number must agree with the reset state.
  expect(Number(after.shown)).toBe(Math.ceil(after.timeLeft));
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

test('Enter pauses and resumes mid-run', async ({ page }) => {
  await startGame(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('#pause-button')).toHaveText('Resume');
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('#pause-button')).toHaveText('Pause');
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(false);
});
