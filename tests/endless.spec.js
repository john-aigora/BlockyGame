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

test('floating-origin rebase preserves the local bubble in one frame', async ({ page }) => {
  await page.locator('#mode-endless').click();
  await startGame(page);
  await waitGameSeconds(page, 0.2);
  // Stage 2 streams gameplay: enemies despawn beyond 80u and food lives
  // with its chunk, so a bare 2500u teleport would (correctly) replace the
  // whole neighborhood. To test the REBASE itself we carry the local
  // bubble along — enemies teleport WITH the player, exactly as if the run
  // had walked there — and assert their player-relative deltas survive the
  // origin shift. (The old-origin chunk food is chunk-owned and streams
  // out; fresh food streaming in at the destination is asserted after.)
  const result = await page.evaluate(() => new Promise((resolve) => {
    const s = window.__game.state;
    const dx = 2500 - s.player.position.x;
    const dz = -100 - s.player.position.z;
    s.player.position.x = 2500;
    s.player.position.z = -100;
    const tracked = s.enemies.map((e) => {
      e.position.x += dx;
      e.position.z += dz;
      return { ref: e, relX: e.position.x - 2500, relZ: e.position.z - -100 };
    });
    // Two RAFs: the game's animate (registered earlier) runs the rebase
    // frame first; the second RAF reads the settled world.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const survivors = tracked.filter((t) => s.enemies.includes(t.ref));
      resolve({
        trackedCount: tracked.length,
        survivorCount: survivors.length,
        drift: survivors.map((t) => ({
          x: (t.ref.position.x - s.player.position.x) - t.relX,
          z: (t.ref.position.z - s.player.position.z) - t.relZ
        })),
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
  // The co-teleported bubble is inside the despawn ring — nobody vanishes,
  // and no visual jump: player-relative deltas survive the rebase
  // (tolerance covers up to two frames of live enemy AI movement).
  expect(result.trackedCount).toBeGreaterThan(0);
  expect(result.survivorCount).toBe(result.trackedCount);
  for (const d of result.drift) {
    expect(Math.abs(d.x)).toBeLessThan(0.6);
    expect(Math.abs(d.z)).toBeLessThan(0.6);
  }
  // Grounding still tracks the terrain through the new origin.
  expect(result.groundDelta).toBeLessThan(0.001);
  // The destination's chunk food streams in under the rebased origin — and
  // every piece of it sits on dry land.
  await page.waitForFunction(() => window.__game.state.collectibles.length > 5, null, { timeout: 30000 });
  const foodOnLand = await page.evaluate(() => {
    const g = window.__game;
    return g.state.collectibles.every((c) =>
      g.debug.groundHeightAt(c.position.x, c.position.z) >= -0.9 + 0.15);
  });
  expect(foodOnLand).toBe(true);
});
