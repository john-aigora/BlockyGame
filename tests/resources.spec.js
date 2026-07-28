import { test, expect } from '@playwright/test';
import { openGame, startGame } from './helpers.js';

// Rendering & resource hygiene (plan 007): shared GPU resources (no geometry
// growth across the food cycle), device pixel ratio applied, and a kill-flash
// cadence around 1Hz (photosensitivity-safe, actually visible).

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
});

test('food spawn/remove cycle does not grow the geometry count', async ({ page }) => {
  // Let the first frames render so all boot-time geometries are registered.
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.__game.state.renderer.info.memory.geometries);

  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) window.__game.debug.spawnNearPlayer();
  });
  await page.waitForTimeout(200); // Render with the 30 extra collectibles
  await page.evaluate(() => {
    const s = window.__game.state;
    s.collectibles.forEach((c) => s.scene.remove(c));
    s.collectibles = [];
  });
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => window.__game.state.renderer.info.memory.geometries);
  // Shared geometry: the cycle must not allocate (delta ≤ 1 allows three.js
  // internals noise; before this plan the delta was ~30).
  expect(after - before).toBeLessThanOrEqual(1);
});

test('renderer pixel ratio matches min(devicePixelRatio, 2)', async ({ page }) => {
  const { actual, expected } = await page.evaluate(() => ({
    actual: window.__game.state.renderer.getPixelRatio(),
    expected: Math.min(window.devicePixelRatio, 2)
  }));
  expect(actual).toBe(expected);
});

test('kill indicator flashes at ~1Hz when an enemy is killable', async ({ page }) => {
  await page.evaluate(() => {
    const s = window.__game.state;
    s.playerScale = 10; // Taller than every enemy → killable state
    s.player.scale.set(10, 10, 10);
  });
  await startGame(page); // Begin the run so the indicator updates
  await expect(page.locator('#kill-indicator')).toBeVisible();

  // Sample every 0.1 GAME seconds (2.0 game seconds total): the flash runs
  // on killFlashClock += dt, so wall-clock sampling under parallel-suite
  // load would compress the observed game-time window and miss toggles.
  // dt is clamped to MAX_DELTA = 0.05 < 0.1, so no frame skips a sample.
  const opacities = await page.evaluate(() => new Promise((resolve) => {
    const s = window.__game.state;
    const indicator = document.getElementById('kill-indicator');
    const out = [];
    let nextSampleAt = s.runTime;
    function frame() {
      if (s.runTime >= nextSampleAt) {
        out.push(indicator.style.opacity);
        nextSampleAt += 0.1;
      }
      if (out.length < 20) requestAnimationFrame(frame);
      else resolve(out);
    }
    requestAnimationFrame(frame);
  }));
  const distinct = new Set(opacities);
  expect(distinct).toEqual(new Set(['1', '0.35'])); // Both flash states observed
  let changes = 0;
  for (let i = 1; i < opacities.length; i++) {
    if (opacities[i] !== opacities[i - 1]) changes++;
  }
  expect(changes).toBeGreaterThanOrEqual(2); // It really toggles...
  expect(changes).toBeLessThanOrEqual(6); // ...but at ~1Hz, not a strobe
});
