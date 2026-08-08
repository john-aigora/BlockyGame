import { test, expect } from '@playwright/test';
import { openGame, startGame, waitGameSeconds, settleFrames } from './helpers.js';

// Visual juice (plan 015): the particle engine must be a true pool (no GPU
// allocation per burst/collect), and the reduced-motion code paths must
// execute cleanly.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
});

test('50 bursts + 10 collects do not grow the geometry count (pool discipline)', async ({ page }) => {
  await openGame(page);
  await settleFrames(page, 3); // Boot-time geometries register at render, so wait FRAMES

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
      // Endless sizes bubble spawns to the player, so taller hunters exist
      // at ANY scale and the cross-chunk collect chase can end the run
      // under parallel-suite load (observed: "The enemy caught you" mid-
      // loop, then the frozen death clock hangs every game-clock wait).
      // The measurement is pool discipline, not survival — despawn them
      // each hop. Enemy bodies share geometry (characters.js), so removal
      // cannot move the geometry count (plan 017). The warn PIPELINE must
      // clear too: a pending disc despawn-proofing missed could materialize
      // a giant right on a teleport landing and end the run mid-loop
      // (observed under 3-worker load — death at 0:03 froze every
      // game-clock wait; the warn queue holds no geometry either).
      s.enemies.forEach((e) => s.scene.remove(e));
      s.enemies = [];
      window.__game.debug.clearPendingSpawns();
      const food = s.collectibles[0];
      if (food) s.player.position.set(food.position.x, 0, food.position.z);
    });
    await waitGameSeconds(page, 0.1); // The collect lands on a game-clock frame
  }
  await waitGameSeconds(page, 1);
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  await settleFrames(page, 3); // A rendered frame registers late geometries
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
  await settleFrames(page, 3); // Render with particles live (registration is per-frame)

  // And the real path: 10 collects via teleporting onto food
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => {
      const s = window.__game.state;
      // Same death-proofing as the warm-up loop (shared geometry — no
      // effect on the measured count), warn pipeline included.
      s.enemies.forEach((e) => s.scene.remove(e));
      s.enemies = [];
      window.__game.debug.clearPendingSpawns();
      const food = s.collectibles[0];
      if (food) s.player.position.set(food.position.x, 0, food.position.z);
    });
    await waitGameSeconds(page, 0.1); // The collect lands on a game-clock frame
  }
  const score = await page.evaluate(() => window.__game.state.score);
  expect(score).toBeGreaterThan(scoreBefore); // The MEASURED collect path (burst + squash) really ran

  const after = await page.evaluate(() => window.__game.state.renderer.info.memory.geometries);
  expect(after - before).toBeLessThanOrEqual(1); // Pooled, not allocated
});

test('score popups are pooled: repeated spawns never grow GPU resources', async ({ page }) => {
  await openGame(page);
  await settleFrames(page, 3); // Boot-time geometries/textures register at render

  // Warmup: cycle the whole 8-sprite ring once so every pooled canvas
  // texture (and the shared sprite geometry) registers with the renderer.
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) {
      window.__game.debug.spawnScorePopup({ x: i, y: 1, z: 0 }, 25 * (i + 1));
    }
  });
  await settleFrames(page, 3); // All 8 render at least one frame
  // Boot-time chunk builds may still be completing; sample `before` only
  // once the terrain build queue is empty (plan 017; terrainInfo().queued
  // is the build-queue-length signal), THEN let a settled frame render so
  // late registrations land before the snapshot — the same drain-then-
  // settle order the geometry-pool spec above uses (H4, B1 review).
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  await settleFrames(page, 3);
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
  await settleFrames(page, 3);
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
  // Play 5 GAME seconds: walk/glow/aura paths all execute under the flag.
  // Death-proofed for the game-clock wait (a huge hero flips every enemy
  // killable → they flee, which ALSO exercises the aura path; the fat
  // clock removes collect death), so the wait can never hang on a frozen
  // death clock.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.playerScale = 6;
    s.player.scale.set(6, 6, 6);
    s.players.forEach((p) => { p.collectTimeLeft = 900; });
  });
  await waitGameSeconds(page, 5);
  const active = await page.evaluate(() => window.__game.state.gameActive);
  expect(active).toBe(true); // The 5 simulated seconds ran clean to the end
});
