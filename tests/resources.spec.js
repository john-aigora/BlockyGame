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

  // Endless streams chunk geometry on movement; measure after warm-up so the
  // pool is settled (plan 017): run one full spawn/remove cycle, then wait
  // for the terrain build queue to drain before sampling `before` (boot-time
  // chunk builds otherwise register mid-measurement).
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) window.__game.debug.spawnNearPlayer();
    const s = window.__game.state;
    s.collectibles.forEach((c) => s.scene.remove(c));
    s.collectibles = [];
  });
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  await page.waitForTimeout(200); // A settled frame registers late geometries
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

// Tiered DPR rule (plan 020 P-10): cap 2 on desktop (fine pointer), 1.5 on
// coarse-pointer devices. This desktop context asserts the desktop tier;
// the mobile tier has its own emulated context below.
test('renderer pixel ratio matches the desktop tier: min(devicePixelRatio, 2)', async ({ page }) => {
  const { isMobile, actual, expected } = await page.evaluate(() => ({
    isMobile: window.__game.state.isMobile,
    actual: window.__game.state.renderer.getPixelRatio(),
    expected: Math.min(window.devicePixelRatio, 2)
  }));
  expect(isMobile).toBe(false); // This context really is the desktop tier
  expect(actual).toBe(expected);
});

// Mobile render tier (plan 020 P-10): a coarse-pointer device gets DPR cap
// 1.5, no MSAA, and no shadow map — phone GPUs were paying desktop-tier
// fill cost. Emulated phone context: hasTouch flips `pointer: coarse`.
test.describe('mobile render tier', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('coarse-pointer devices get the mobile tier: DPR cap 1.5, no MSAA, no shadows', async ({ page }) => {
    const t = await page.evaluate(() => ({
      isMobile: window.__game.state.isMobile,
      actual: window.__game.state.renderer.getPixelRatio(),
      expected: Math.min(window.devicePixelRatio, 1.5),
      shadows: window.__game.state.renderer.shadowMap.enabled,
      antialias: window.__game.state.renderer.getContext().getContextAttributes().antialias
    }));
    expect(t.isMobile).toBe(true); // The emulated context reads as coarse-pointer
    expect(t.actual).toBe(t.expected);
    expect(t.shadows).toBe(false);
    expect(t.antialias).toBe(false);
  });
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
