import { test, expect } from '@playwright/test';

// Toroidal world correctness (plan 005): wrapping preserves overshoot, all
// food spawns land inside the world, and enemy AI takes the short way across
// the wrap seam. Pattern: pause (the game boots paused), set positions via
// evaluate, unpause, sample — with generous bounds for the random drift.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1);
});

test('all food spawns stay inside the world even with the player at the edge', async ({ page }) => {
  await page.evaluate(() => {
    const s = window.__game.state;
    s.player.position.set(99.5, 0, 99.5);
    for (let i = 0; i < 50; i++) {
      window.__game.debug.spawnNearPlayer();
      window.__game.debug.spawnAtPosition(s.player.position);
    }
  });
  const positions = await page.evaluate(() =>
    window.__game.state.collectibles.map((c) => ({ x: c.position.x, z: c.position.z }))
  );
  expect(positions.length).toBeGreaterThanOrEqual(100);
  for (const { x, z } of positions) {
    expect(Math.abs(x)).toBeLessThanOrEqual(100);
    expect(Math.abs(z)).toBeLessThanOrEqual(100);
  }
});

test('player wrap preserves overshoot (no snap to the edge)', async ({ page }) => {
  await page.locator('#pause-button').click(); // Unpause (game boots paused)
  await page.evaluate(() => { window.__game.state.player.position.x = 100.4; });
  await page.waitForTimeout(100); // Let at least one update frame run
  const x = await page.evaluate(() => window.__game.state.player.position.x);
  // wrapCoord(100.4) = -99.6 — overshoot preserved, not clamped to -99.9
  expect(x).toBeGreaterThan(-99.6 - 0.5);
  expect(x).toBeLessThan(-99.6 + 0.5);
});

test('enemy AI chases the short way across the wrap seam', async ({ page }) => {
  await page.evaluate(() => {
    const s = window.__game.state;
    // Player near the -x edge, enemy near the +x edge: short path is +x
    // across the seam (torus distance 10), long path is -x (190 units).
    s.player.position.set(-95, 0, 0);
    const enemy = s.enemies[0];
    enemy.position.set(95, 0, 0);
    // Make the run deterministic: freeze the random drift component.
    enemy.randomVelocity.set(0, 0, 0);
    enemy.timeToChangeRandomVelocity = 999;
  });
  await page.locator('#pause-button').click(); // Unpause
  await page.waitForTimeout(1000);
  const finalX = await page.evaluate(() => window.__game.state.enemies[0].position.x);
  // The (non-killable) enemy must move toward +x / the seam, not the long
  // way toward -x. Speed is ~1.5 u/s with an orbit component, so expect a
  // clearly positive advance but stay generous about the exact amount.
  expect(finalX).toBeGreaterThan(95.2);
  expect(finalX).toBeLessThan(100);
});
