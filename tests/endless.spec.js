import { test, expect } from '@playwright/test';
import { startGame, waitGameSeconds } from './helpers.js';

// Endless world (terrain engine stage): the start-overlay mode picker, the
// streamed deterministic terrain, and the floating-origin rebase. The
// original suites all run in classic mode and cover its (unchanged)
// behavior; everything here opts into endless via the real UI.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1);
});

test('boots into classic by default with the mode picker on the overlay', async ({ page }) => {
  await expect(page.locator('#mode-classic')).toBeVisible();
  await expect(page.locator('#mode-endless')).toBeVisible();
  await expect(page.locator('#mode-classic')).toHaveClass(/mode-selected/);
  await expect(page.locator('#mode-endless')).not.toHaveClass(/mode-selected/);
  expect(await page.evaluate(() => window.__game.state.worldMode)).toBe('classic');
  // Classic environment: the flat arena plane, no terrain streaming.
  expect(await page.evaluate(() => window.__game.state.ground.visible)).toBe(true);
  expect(await page.evaluate(() => window.__game.debug.terrainInfo().streaming)).toBe(false);
});

test('mode picker boots an endless run: terrain streams, player stands on it', async ({ page }) => {
  // Shader-patch safety net: a broken onBeforeCompile surfaces as a
  // console.error from three, not a pageerror — trap those too.
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.locator('#mode-endless').click();
  await expect(page.locator('#mode-endless')).toHaveClass(/mode-selected/);
  // Picking a mode must NOT start the run (the overlay-press start guard).
  await expect(page.locator('#start-overlay')).toBeVisible();
  expect(await page.evaluate(() => window.__game.state.worldMode)).toBe('endless');
  expect(await page.evaluate(() => localStorage.getItem('blocky.worldMode'))).toBe('endless');
  expect(await page.evaluate(() => window.__game.state.ground.visible)).toBe(false);

  // The full 7x7 window streams in (2 builds/frame) on the title screen.
  await page.waitForFunction(() => window.__game.debug.terrainInfo().activeChunks >= 49, null, { timeout: 30000 });
  const info = await page.evaluate(() => window.__game.debug.terrainInfo());
  expect(info.hasWater).toBe(true);
  expect(info.streaming).toBe(true);

  await startGame(page);
  await waitGameSeconds(page, 0.5);
  // The player is grounded on the terrain, on dry land (the spawn mesa).
  const grounded = await page.evaluate(() => {
    const s = window.__game.state;
    return {
      py: s.player.position.y,
      ground: window.__game.debug.groundHeightAt(s.player.position.x, s.player.position.z)
    };
  });
  expect(Math.abs(grounded.py - grounded.ground)).toBeLessThan(0.001);
  expect(grounded.py).toBeGreaterThan(-0.9); // Not in a lake

  // Moving to a new chunk keeps streaming: teleport across a chunk border.
  const buildsBefore = info.builds;
  await page.evaluate(() => { window.__game.state.player.position.x += 70; });
  await page.waitForFunction(
    (n) => window.__game.debug.terrainInfo().builds > n,
    buildsBefore,
    { timeout: 30000 }
  );
  // Release discipline: the active set stays bounded by the release ring.
  const after = await page.evaluate(() => window.__game.debug.terrainInfo());
  expect(after.activeChunks).toBeLessThanOrEqual(81);
  expect(consoleErrors).toEqual([]);
});

test('endless choice persists across a reload (and can switch back)', async ({ page }) => {
  await page.locator('#mode-endless').click();
  await page.reload();
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1);
  expect(await page.evaluate(() => window.__game.state.worldMode)).toBe('endless');
  await expect(page.locator('#mode-endless')).toHaveClass(/mode-selected/);
  // Switching back restores the classic arena environment.
  await page.locator('#mode-classic').click();
  expect(await page.evaluate(() => window.__game.state.worldMode)).toBe('classic');
  expect(await page.evaluate(() => window.__game.state.ground.visible)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('blocky.worldMode'))).toBe('classic');
});

test('terrain height is deterministic: same coords, same height, across reloads', async ({ page }) => {
  const coords = [[0, 0], [123.4, -567.8], [2500.25, 10000.5], [-3210.7, 77.7], [16.001, 16.001]];
  const sample = (cs) => page.evaluate(
    (list) => list.map(([x, z]) => window.__game.debug.terrainHeight(x, z)),
    cs
  );
  const first = await sample(coords);
  const second = await sample(coords);
  expect(second).toEqual(first); // Not random per call
  await page.reload();
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1);
  const third = await sample(coords);
  expect(third).toEqual(first); // Seeded — identical across sessions
});

test('floating-origin rebase preserves the relative world in one frame', async ({ page }) => {
  await page.locator('#mode-endless').click();
  await startGame(page);
  await waitGameSeconds(page, 0.2);
  const result = await page.evaluate(() => new Promise((resolve) => {
    const s = window.__game.state;
    // Teleport far past REBASE_DISTANCE (2048). The next update frame must
    // rebase: origin absorbs the nearest CHUNK_SIZE multiple.
    s.player.position.x = 2500;
    s.player.position.z = -100;
    const rel = (list) => list.map((o) => ({
      x: o.position.x - s.player.position.x,
      z: o.position.z - s.player.position.z
    }));
    const before = { enemies: rel(s.enemies), food: rel(s.collectibles) };
    // Two RAFs: the game's animate (registered earlier) runs the rebase
    // frame first; the second RAF reads the settled world.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve({
        before,
        after: { enemies: rel(s.enemies), food: rel(s.collectibles) },
        origin: { x: s.worldOrigin.x, z: s.worldOrigin.z },
        px: s.player.position.x,
        pz: s.player.position.z,
        groundDelta: Math.abs(
          s.player.position.y -
          window.__game.debug.groundHeightAt(s.player.position.x, s.player.position.z)
        )
      });
    }));
  }));
  // round(2500/32)*32 = 2496; round(-100/32)*32 = -96.
  expect(result.origin.x).toBe(2496);
  expect(result.origin.z).toBe(-96);
  expect(Math.abs(result.px - 4)).toBeLessThan(1); // 2500 - 2496 (idle player)
  expect(Math.abs(result.pz - -4)).toBeLessThan(1);
  // No visual jump: player-relative deltas survive the rebase (tolerance
  // covers up to two frames of live enemy AI movement).
  expect(result.after.enemies.length).toBe(result.before.enemies.length);
  expect(result.after.food.length).toBe(result.before.food.length);
  for (let i = 0; i < result.before.enemies.length; i++) {
    expect(Math.abs(result.after.enemies[i].x - result.before.enemies[i].x)).toBeLessThan(0.6);
    expect(Math.abs(result.after.enemies[i].z - result.before.enemies[i].z)).toBeLessThan(0.6);
  }
  for (let i = 0; i < result.before.food.length; i++) {
    expect(Math.abs(result.after.food[i].x - result.before.food[i].x)).toBeLessThan(0.01);
    expect(Math.abs(result.after.food[i].z - result.before.food[i].z)).toBeLessThan(0.01);
  }
  // Grounding still tracks the terrain through the new origin.
  expect(result.groundDelta).toBeLessThan(0.001);
});
