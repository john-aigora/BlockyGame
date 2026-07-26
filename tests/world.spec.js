import { test, expect } from '@playwright/test';
import { startGame } from './helpers.js';

// Toroidal world correctness (plan 005): wrapping preserves overshoot, all
// food spawns land inside the world, and enemy AI takes the short way across
// the wrap seam. Pattern: set positions via evaluate while the game sits on
// the start overlay (paused), start the run, sample — with generous bounds
// for the random drift.

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
  await startGame(page); // Begin the run (game boots on the start overlay)
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
  await startGame(page); // Begin the run
  await page.waitForTimeout(1000);
  // Rendered positions are player-relative torus images (seamless torus
  // rendering) — read the CANONICAL coordinate for the assertion.
  const finalX = await page.evaluate(() => {
    const x = window.__game.state.enemies[0].position.x;
    return ((x + 100) % 200 + 200) % 200 - 100;
  });
  // The (non-killable) enemy must move toward +x / the seam, not the long
  // way toward -x. Speed is ~1.5 u/s with an orbit component, so expect a
  // clearly positive advance but stay generous about the exact amount.
  expect(finalX).toBeGreaterThan(95.2);
  expect(finalX).toBeLessThan(100);
});

test('enemies render at the player-nearest image across the seam', async ({ page }) => {
  await page.evaluate(() => {
    const s = window.__game.state;
    // Player near the +x edge, enemy canonically near the -x edge: only 2
    // units apart across the seam, but ~198 apart in canonical coords.
    s.player.position.set(99, 0, 0);
    const enemy = s.enemies[0];
    enemy.position.set(-99, 0, 0);
    enemy.randomVelocity.set(0, 0, 0);
    enemy.timeToChangeRandomVelocity = 999;
  });
  await startGame(page);
  await page.waitForTimeout(100); // A few frames — the re-image runs per frame
  const { enemyX, playerX } = await page.evaluate(() => ({
    enemyX: window.__game.state.enemies[0].position.x,
    playerX: window.__game.state.player.position.x
  }));
  // The RENDERED enemy must sit at the near image (~101, just across the
  // boundary from the player) — NOT ~198 units away at its canonical -99.
  expect(Math.abs(enemyX - playerX)).toBeLessThan(5);
  expect(enemyX).toBeGreaterThan(100 - 5);
});

test('ground grid offset stays continuous when the player wraps', async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => { window.__game.state.player.position.set(99.9, 0, 0); });
  await page.keyboard.down('ArrowRight'); // Walk +x, straight through the seam
  // Sample player x and the grid texture offset each frame while crossing.
  const samples = await page.evaluate(() => new Promise((resolve) => {
    const s = window.__game.state;
    const tex = s.ground.material.map;
    const out = [];
    function frame() {
      out.push({ x: s.player.position.x, frac: ((tex.offset.x % 1) + 1) % 1 });
      if (out.length < 40) requestAnimationFrame(frame);
      else resolve(out);
    }
    requestAnimationFrame(frame);
  }));
  await page.keyboard.up('ArrowRight');
  // The run must actually cross the wrap seam...
  expect(samples.some((sample) => sample.x < -99)).toBe(true);
  // ...and the grid offset's fractional part must stay continuous across it:
  // per frame the offset moves ≤ speed * MAX_DELTA / GROUND_TILE ≈ 0.0075.
  // A GROUND_TILE that doesn't divide worldSize would jump by 0.5 here.
  for (let i = 1; i < samples.length; i++) {
    const d = Math.abs(samples[i].frac - samples[i - 1].frac);
    expect(Math.min(d, 1 - d)).toBeLessThan(0.05);
  }
});
