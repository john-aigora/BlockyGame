import { test, expect } from '@playwright/test';
import { startGame } from './helpers.js';

// Visual juice (plan 015): the particle engine must be a true pool (no GPU
// allocation per burst/collect), and the reduced-motion code paths must
// execute cleanly.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
});

test('50 bursts + 10 collects do not grow the geometry count (pool discipline)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1);
  await page.waitForTimeout(300); // Let boot-time geometries register

  // Big player: enemies flee, so teleport-collecting can't end the run.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.playerScale = 6;
    s.player.scale.set(6, 6, 6);
  });
  const before = await page.evaluate(() => window.__game.state.renderer.info.memory.geometries);

  // Hammer the pool directly: 50 bursts, far more than the pool size/turnover
  await page.evaluate(() => {
    for (let i = 0; i < 50; i++) {
      window.__game.debug.spawnBurst({ x: 0, y: 1, z: 0 }, { count: 30 });
    }
  });
  await page.waitForTimeout(200); // Render with particles live

  // And the real path: 10 collects via teleporting onto food
  await startGame(page);
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => {
      const s = window.__game.state;
      const food = s.collectibles[0];
      if (food) s.player.position.set(food.position.x, 0, food.position.z);
    });
    await page.waitForTimeout(100);
  }
  const score = await page.evaluate(() => window.__game.state.score);
  expect(score).toBeGreaterThan(0); // The collect path (burst + squash) really ran

  const after = await page.evaluate(() => window.__game.state.renderer.info.memory.geometries);
  expect(after - before).toBeLessThanOrEqual(1); // Pooled, not allocated
});

test('boots and plays cleanly with prefers-reduced-motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1);
  const info = await page.evaluate(() => window.__game.debug.effectsInfo());
  expect(info.reducedMotion).toBe(true); // The flag paths are actually armed

  await startGame(page);
  // Trigger a collect so the (skipped) squash branch executes under the flag
  await page.evaluate(() => {
    const s = window.__game.state;
    const food = s.collectibles[0];
    if (food) s.player.position.set(food.position.x, 0, food.position.z);
  });
  await page.waitForTimeout(5000); // Play 5s: walk/glow/aura paths all execute
  const active = await page.evaluate(() => window.__game.state.gameActive);
  expect(typeof active).toBe('boolean'); // No pageerror is the real assertion
});
