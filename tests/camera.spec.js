import { test, expect } from '@playwright/test';
import { startGame } from './helpers.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.player);
});

test('zoom out clamps at ZOOM_MAX and the scene stays inside the fog', async ({ page }) => {
  await startGame(page); // The overlay covers the corner buttons until a run starts
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
  for (let i = 0; i < 12; i++) {
    await page.locator('#zoom-out-button').click();
  }
  for (let i = 0; i < 20; i++) {
    await page.locator('#zoom-in-button').click();
  }
  const zoomLevel = await page.evaluate(() => window.__game.state.zoomLevel);
  expect(zoomLevel).toBeGreaterThanOrEqual(0.59);
  expect(zoomLevel).toBeLessThanOrEqual(0.61);
});

test('restart resets zoom to the default framing', async ({ page }) => {
  await startGame(page);
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
  await page.waitForTimeout(1000);
  const camYAtScaleFive = await page.evaluate(() => window.__game.state.camY);
  // Target at scale 5 is 15 * (1 + 4 * 0.35) = 36; after 1s of easing the
  // camera should be well past 1.5x its scale-1 height.
  expect(camYAtScaleFive).toBeGreaterThan(camYAtScaleOne * 1.5);
});
