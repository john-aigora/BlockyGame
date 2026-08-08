import { test, expect } from '@playwright/test';
import { openGame, startGame } from './helpers.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
});

// H3 (B1 review): the click loops below ride a LIVE run — under parallel-
// suite load, dozens of wall-clock clicks left the idle hero exposed to the
// boot enemy (latent contact-death race). The measurement is the zoom
// clamp, not survival: silence every threat and fatten the collect clock
// so the run cannot end mid-loop. Fresh bubble spawns land ≥35u out and
// close at ~1.5u/s — far slower than any click loop.
async function calmRun(page) {
  await page.evaluate(() => {
    const s = window.__game.state;
    s.enemies.forEach((e) => s.scene.remove(e));
    s.enemies = [];
    window.__game.debug.clearPendingSpawns();
    s.players.forEach((p) => { p.collectTimeLeft = 900; });
  });
}

test('zoom out clamps at ZOOM_MAX and the scene stays inside the fog', async ({ page }) => {
  await startGame(page); // The overlay covers the corner buttons until a run starts
  await calmRun(page);
  for (let i = 0; i < 12; i++) {
    await page.locator('#zoom-out-button').click();
  }
  const zoomLevel = await page.evaluate(() => window.__game.state.zoomLevel);
  expect(zoomLevel).toBeLessThanOrEqual(3.01);
  expect(zoomLevel).toBeGreaterThan(2.9);
  // Fog tracks the camera: the far plane stays beyond the camera distance,
  // so the game is visible even at max zoom.
  const fogBeyondCamera = await page.evaluate(() => {
    const s = window.__game.state;
    return s.scene.fog.far > Math.hypot(s.camY, s.camZ);
  });
  expect(fogBeyondCamera).toBe(true);
});

test('zoom in clamps at ZOOM_MIN', async ({ page }) => {
  await startGame(page);
  await calmRun(page); // 32 clicks of live-run exposure without it (H3)
  for (let i = 0; i < 12; i++) {
    await page.locator('#zoom-out-button').click();
  }
  for (let i = 0; i < 20; i++) {
    await page.locator('#zoom-in-button').click();
  }
  const zoomLevel = await page.evaluate(() => window.__game.state.zoomLevel);
  expect(zoomLevel).toBeGreaterThanOrEqual(0.59);
  expect(zoomLevel).toBeLessThanOrEqual(0.61);
  // The run survived the whole loop — the clamp reads above weren't taken
  // off a dead, frozen game.
  expect(await page.evaluate(() => window.__game.state.gameActive)).toBe(true);
});

test('restart resets zoom to the default framing', async ({ page }) => {
  await startGame(page);
  await calmRun(page);
  for (let i = 0; i < 12; i++) {
    await page.locator('#zoom-out-button').click();
  }
  await page.locator('#restart-game-button').click();
  // Restart returns to the start overlay with the default framing restored.
  await expect(page.locator('#start-overlay')).toBeVisible();
  const zoomLevel = await page.evaluate(() => window.__game.state.zoomLevel);
  expect(zoomLevel).toBe(1);
});

test('camera pulls back as the player grows', async ({ page }) => {
  const camYAtScaleOne = await page.evaluate(() => window.__game.state.camY);
  await page.evaluate(() => { window.__game.state.playerScale = 5; });
  // Target at scale 5 is 15 * (1 + 4 * 0.35) = 36; the eased camera must
  // clear 1.5x its scale-1 height. Condition-based: the easing is dt-driven,
  // so under parallel-suite load a fixed 1s wall wait could sample too early.
  await expect
    .poll(() => page.evaluate(() => window.__game.state.camY), { timeout: 20000 })
    .toBeGreaterThan(camYAtScaleOne * 1.5);
});
