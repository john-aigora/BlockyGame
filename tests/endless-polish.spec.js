import { test, expect } from '@playwright/test';
import { openGame, startGame, waitGameSeconds } from './helpers.js';

// Endless world, stage 3 (spectacle + tuning): biome tint regions, the
// shoreline band, water depth tint (with its snap-recolor cadence), the
// distance-milestone popup, and the attract camera's terrain clearance.
// Everything opts into endless via the real UI; classic suites untouched.

const WL = -0.9; // WATER_LEVEL (constants.js) — inlined for in-page scans

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
});

test('crossing 250u fires the DISTANCE milestone popup (and again at 500u)', async ({ page }) => {
  await startGame(page);
  await waitGameSeconds(page, 0.2);
  expect(await page.evaluate(() => window.__game.debug.effectsInfo().lastPopupText)).toBeNull();

  // March past the first milestone boundary.
  await page.evaluate(() => { window.__game.state.player.position.x = 260; });
  await waitGameSeconds(page, 0.3);
  expect(await page.evaluate(() => window.__game.debug.effectsInfo().lastPopupText))
    .toBe('DISTANCE 250!');

  // And the next one. furthestDistance only grows, so walking home and back
  // out again must NOT re-fire 250 — only the fresh 500 boundary fires.
  await page.evaluate(() => { window.__game.state.player.position.x = 40; });
  await waitGameSeconds(page, 0.3);
  await page.evaluate(() => { window.__game.state.player.position.x = 510; });
  await waitGameSeconds(page, 0.3);
  expect(await page.evaluate(() => window.__game.debug.effectsInfo().lastPopupText))
    .toBe('DISTANCE 500!');
});

test('biome tint varies by region; the shoreline band brightens the waterline', async ({ page }) => {
  // Pure math on the deterministic terrain — no run needed.
  const scan = await page.evaluate((WL_) => {
    const tint = window.__game.debug.terrainTint;
    // Biome: sample mid-height land across a wide area and measure the
    // green/blue channel ratio spread (the biome shift moves g and b in
    // opposite directions; height alone moves them together).
    let loRatio = Infinity, hiRatio = -Infinity;
    for (let x = 0; x <= 2400; x += 150) {
      for (let z = -1200; z <= 1200; z += 150) {
        const t = tint(x, z);
        if (t.h < 0.2 || t.h > 0.6) continue;
        const ratio = t.g / t.b;
        if (ratio < loRatio) loRatio = ratio;
        if (ratio > hiRatio) hiRatio = ratio;
      }
    }
    // Shoreline: find a waterline-band vertex and a mid-height vertex close
    // by (same biome region) and compare the raw brightness channel (r
    // carries pure tint — the biome shift never touches it).
    let band = null, mid = null;
    for (let x = 40; x < 2000 && (!band || !mid); x += 0.5) {
      const t = tint(x, 33.5);
      if (!band && t.h > WL_ + 0.02 && t.h < WL_ + 0.1) band = t;
      if (!mid && t.h > 0.3 && t.h < 0.6) mid = t;
    }
    return { loRatio, hiRatio, bandR: band?.r, midR: mid?.r };
  }, WL);
  // Regions must be tellable apart, but stay family: a real spread, no wild swing.
  expect(scan.hiRatio - scan.loRatio).toBeGreaterThan(0.15);
  expect(scan.hiRatio).toBeLessThan(1.5);
  expect(scan.loRatio).toBeGreaterThan(0.6);
  // The waterline band is BRIGHTER than mid-height land, even though plain
  // height tinting is monotonic (brighter = higher) — the inversion IS the band.
  expect(scan.bandR).toBeDefined();
  expect(scan.midR).toBeDefined();
  expect(scan.bandR).toBeGreaterThan(scan.midR + 0.05);
});

test('water wears a depth tint and recolors on the follow-snap cadence, not per frame', async ({ page }) => {
  await startGame(page);
  await waitGameSeconds(page, 0.5);
  const boot = await page.evaluate(() => {
    const info = window.__game.debug.terrainInfo();
    let water = null;
    window.__game.state.scene.traverse((o) => {
      if (o.isMesh && o.geometry?.attributes?.position?.count === 81 * 81) water = o;
    });
    const col = water.geometry.attributes.color.array;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < col.length; i += 3) {
      if (col[i] < min) min = col[i];
      if (col[i] > max) max = col[i];
    }
    return { recolors: info.waterRecolors, min, max, vertexColors: water.material.vertexColors === true };
  });
  expect(boot.vertexColors).toBe(true);
  // The 560u footprint around the spawn always spans shallows AND deep lake.
  expect(boot.max).toBeGreaterThan(0.95);
  expect(boot.min).toBeLessThan(boot.max - 0.2);
  // Idling must not recolor (the snap cell is unchanged)...
  await waitGameSeconds(page, 0.5);
  const idle = await page.evaluate(() => window.__game.debug.terrainInfo().waterRecolors);
  expect(idle).toBe(boot.recolors);
  // ...and crossing a snap cell recolors exactly per step, not per frame.
  await page.evaluate(() => { window.__game.state.player.position.x += 40; });
  await waitGameSeconds(page, 0.5);
  const moved = await page.evaluate(() => window.__game.debug.terrainInfo().waterRecolors);
  expect(moved).toBeGreaterThan(idle);
  expect(moved - idle).toBeLessThanOrEqual(4); // 40u = at most a few 12u snap cells
});

test('the endless attract camera keeps its clearance over the terrain', async ({ page }) => {
  // Let the attract orbit blend in fully and the spawn window build.
  await page.waitForFunction(() => window.__game.debug.terrainInfo().activeChunks >= 25, null, { timeout: 30000 });
  const result = await page.evaluate(() => new Promise((resolve) => {
    const cam = window.__game.state.camera;
    const ground = window.__game.debug.groundHeightAt;
    let worst = Infinity;
    let frames = 0;
    const tick = () => {
      const clearance = cam.position.y - ground(cam.position.x, cam.position.z);
      if (clearance < worst) worst = clearance;
      if (++frames < 90) { requestAnimationFrame(tick); return; } // ~1.5s of orbit
      resolve({ worst, frames });
    };
    requestAnimationFrame(tick);
  }));
  expect(result.frames).toBe(90);
  // CAMERA_TERRAIN_CLEARANCE is 2.5; allow lerp slack, but never a clip.
  expect(result.worst).toBeGreaterThan(2.0);
});
