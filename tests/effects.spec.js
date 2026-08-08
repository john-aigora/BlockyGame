import { test, expect } from '@playwright/test';
import { openGame, startGame, waitGameSeconds } from './helpers.js';

// Visual juice (plan 015): the particle engine must be a true pool (no GPU
// allocation per burst/collect), and the reduced-motion code paths must
// execute cleanly.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
});

test('50 bursts + 10 collects do not grow the geometry count (pool discipline)', async ({ page }) => {
  await openGame(page);
  await page.waitForTimeout(300); // Let boot-time geometries register

  // Big player: enemies flee, so teleport-collecting can't end the run.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.playerScale = 6;
    s.player.scale.set(6, 6, 6);
  });

  // Endless streams chunk geometry on movement; measure after warm-up so the
  // pool is settled (plan 017): run the whole teleport-collect loop once
  // first — the collect chase drags the player across chunks, and the chunk
  // mesh pool only reaches steady state after that same movement pattern —
  // then settle (game clock + empty terrain build queue) before sampling.
  await startGame(page);
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => {
      const s = window.__game.state;
      const food = s.collectibles[0];
      if (food) s.player.position.set(food.position.x, 0, food.position.z);
    });
    await page.waitForTimeout(100);
  }
  await waitGameSeconds(page, 1);
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  await page.waitForTimeout(200); // A settled frame registers late geometries
  const { before, scoreBefore } = await page.evaluate(() => ({
    before: window.__game.state.renderer.info.memory.geometries,
    scoreBefore: window.__game.state.score
  }));

  // Hammer the pool directly: 50 bursts, far more than the pool size/turnover
  await page.evaluate(() => {
    for (let i = 0; i < 50; i++) {
      window.__game.debug.spawnBurst({ x: 0, y: 1, z: 0 }, { count: 30 });
    }
  });
  await page.waitForTimeout(200); // Render with particles live

  // And the real path: 10 collects via teleporting onto food
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => {
      const s = window.__game.state;
      const food = s.collectibles[0];
      if (food) s.player.position.set(food.position.x, 0, food.position.z);
    });
    await page.waitForTimeout(100);
  }
  const score = await page.evaluate(() => window.__game.state.score);
  expect(score).toBeGreaterThan(scoreBefore); // The MEASURED collect path (burst + squash) really ran

  const after = await page.evaluate(() => window.__game.state.renderer.info.memory.geometries);
  expect(after - before).toBeLessThanOrEqual(1); // Pooled, not allocated
});

test('score popups are pooled: repeated spawns never grow GPU resources', async ({ page }) => {
  await openGame(page);
  await page.waitForTimeout(300); // Let boot-time geometries/textures register

  // Warmup: cycle the whole 8-sprite ring once so every pooled canvas
  // texture (and the shared sprite geometry) registers with the renderer.
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) {
      window.__game.debug.spawnScorePopup({ x: i, y: 1, z: 0 }, 25 * (i + 1));
    }
  });
  await page.waitForTimeout(250); // All 8 render at least one frame
  // Boot-time chunk builds may still be completing; sample `before` only
  // once the terrain build queue is empty (plan 017; terrainInfo().queued
  // is the build-queue-length signal).
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  const before = await page.evaluate(() => ({
    geometries: window.__game.state.renderer.info.memory.geometries,
    textures: window.__game.state.renderer.info.memory.textures
  }));

  // 30 more spawns — pure pool reuse: text redraw + upload, no allocations.
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) {
      window.__game.debug.spawnScorePopup({ x: i % 5, y: 1, z: 1 }, 100 + i);
    }
  });
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    geometries: window.__game.state.renderer.info.memory.geometries,
    textures: window.__game.state.renderer.info.memory.textures
  }));
  expect(after.textures - before.textures).toBeLessThanOrEqual(0); // Pooled canvases = fixed count
  expect(after.geometries - before.geometries).toBeLessThanOrEqual(1); // Shared sprite geometry + internals noise
});

test('boots and plays cleanly with prefers-reduced-motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGame(page);
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
