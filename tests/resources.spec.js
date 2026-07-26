import { test, expect } from '@playwright/test';

// Rendering & resource hygiene (plan 007): shared GPU resources (no geometry
// growth across the food cycle), device pixel ratio applied, and a kill-flash
// cadence around 1Hz (photosensitivity-safe, actually visible).

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1);
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
  await page.locator('#pause-button').click(); // Unpause so the indicator updates
  await expect(page.locator('#kill-indicator')).toBeVisible();

  const opacities = [];
  for (let i = 0; i < 20; i++) {
    opacities.push(await page.evaluate(() =>
      document.getElementById('kill-indicator').style.opacity
    ));
    await page.waitForTimeout(100);
  }
  const distinct = new Set(opacities);
  expect(distinct).toEqual(new Set(['1', '0.35'])); // Both flash states observed
  let changes = 0;
  for (let i = 1; i < opacities.length; i++) {
    if (opacities[i] !== opacities[i - 1]) changes++;
  }
  expect(changes).toBeGreaterThanOrEqual(2); // It really toggles...
  expect(changes).toBeLessThanOrEqual(6); // ...but at ~1Hz, not a strobe
});
