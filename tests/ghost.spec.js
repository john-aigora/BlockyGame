import { test, expect } from '@playwright/test';
import { bypassGate, openGame, startGame, bootEndless, settleFrames } from './helpers.js';

// --- Ghost runs (plan 034) ---
// Record the best run per seed, replay it as a spectral hero. These specs
// drive the REAL pipeline (record on the game clock → finalize at endGame →
// replay on the next same-seed run) via debug.advance — no wall-clock waits.
// Multi-run cases stay inside ONE page: Playwright gives each test a fresh
// browser context, so localStorage carries across restarts/gotos only
// within the test.

function info(page) {
  return page.evaluate(() => window.__game.debug.ghostInfo());
}

function storedGhost(page) {
  return page.evaluate(() => {
    const seed = window.__game.debug.worldSeedInfo().seed;
    const raw = localStorage.getItem(`blocky.ghost.${seed}.v1`);
    return raw ? JSON.parse(raw) : null;
  });
}

// Dies by collect-clock expiry after optionally teleporting through a path.
async function dieAt(page, hops = []) {
  for (const [x, z] of hops) {
    await page.evaluate(([hx, hz]) => {
      const p = window.__game.state.player.position;
      p.x = hx;
      p.z = hz;
    }, [x, z]);
    await page.evaluate(() => window.__game.debug.advance(1));
  }
  await page.evaluate(() => window.__game.debug.advance(16)); // Clock expiry
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 20000 });
  await settleFrames(page, 2); // The finalize signal is consumed on a live frame
}

test('a solo run records its path on the game clock', async ({ page }) => {
  await bootEndless(page);
  await page.evaluate(() => window.__game.debug.advance(3));
  const i = await info(page);
  expect(i.recording).toBeGreaterThanOrEqual(15); // ~3s / 0.15s cadence
  expect(i.replaying).toBe(false); // No stored ghost yet
});

test('the run end persists a valid ghost; a WORSE later run never overwrites it', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);
  await dieAt(page, [[20, 0], [50, 0]]); // furthest ≈ 50
  const g1 = await storedGhost(page);
  expect(g1).not.toBeNull();
  expect(g1.v).toBe(1);
  expect(g1.points.length % 3).toBe(0);
  expect(g1.points.length).toBeGreaterThanOrEqual(6);
  expect(g1.distance).toBeGreaterThanOrEqual(50);
  // A worse (stationary) run must keep the incumbent.
  await page.locator('#restart-button').click();
  await expect(page.locator('#start-overlay')).toBeVisible();
  await startGame(page);
  await dieAt(page);
  const g2 = await storedGhost(page);
  expect(g2.distance).toBe(g1.distance);
  expect(g2.points).toEqual(g1.points);
});

test('the next same-seed run races the ghost: replay tracks the stored path on the run clock', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);
  await dieAt(page, [[5, 0], [10, 0]]);
  const g = await storedGhost(page);
  expect(g).not.toBeNull();
  // The overlay announces the race...
  await page.locator('#restart-button').click();
  await expect(page.locator('#ghost-line')).toBeVisible();
  await startGame(page);
  // ...and the spirit is on the field, tracking the recorded positions.
  await page.evaluate(() => window.__game.debug.advance(2.5));
  const i = await info(page);
  expect(i.replaying).toBe(true);
  // At runTime 2.5 the run-1 hero had already teleported to x=10 (hop 2 at
  // ~1s, sampled within 0.15s). worldOrigin is 0 here, so local == true.
  expect(Math.abs(i.x - 10)).toBeLessThanOrEqual(0.6);
  expect(Math.abs(i.z - 0)).toBeLessThanOrEqual(0.6);
});

test('?ghost=0 hides the race for the session (recording continues)', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);
  await dieAt(page, [[15, 0]]);
  expect(await storedGhost(page)).not.toBeNull();
  await bypassGate(page);
  await page.goto('/?ghost=0');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  await expect(page.locator('#ghost-line')).toBeHidden();
  await startGame(page);
  await page.evaluate(() => window.__game.debug.advance(1));
  const i = await info(page);
  expect(i.disabled).toBe(true);
  expect(i.replaying).toBe(false);
  expect(i.recording).toBeGreaterThan(0); // The recorder never turns off
});

test('a different seed has no ghost to race', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);
  await dieAt(page, [[15, 0]]);
  await bypassGate(page);
  await page.goto('/?seed=999');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  await expect(page.locator('#ghost-line')).toBeHidden();
  await startGame(page);
  await page.evaluate(() => window.__game.debug.advance(1));
  expect((await info(page)).replaying).toBe(false);
});

test('2P never records or replays (solo feature by design)', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => window.__game.debug.startTwoPlayer());
  await page.locator('#start-button').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await page.evaluate(() => window.__game.debug.advance(2));
  const i = await info(page);
  expect(i.recording).toBe(0);
  expect(i.replaying).toBe(false);
});

test('ghost GPU resources plateau across repeated races', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);
  await dieAt(page, [[12, 0]]);
  // Race 1 (builds the one-time ghost mesh), then die.
  await page.locator('#restart-button').click();
  await expect(page.locator('#start-overlay')).toBeVisible();
  await startGame(page);
  await page.evaluate(() => window.__game.debug.advance(1));
  expect((await info(page)).replaying).toBe(true);
  await dieAt(page);
  await settleFrames(page, 3);
  const first = await page.evaluate(() => window.__game.debug.perfInfo());
  // Race 2: nothing new may allocate.
  await page.locator('#restart-button').click();
  await expect(page.locator('#start-overlay')).toBeVisible();
  await startGame(page);
  await page.evaluate(() => window.__game.debug.advance(1));
  await dieAt(page);
  await settleFrames(page, 3);
  const second = await page.evaluate(() => window.__game.debug.perfInfo());
  // ±1 tolerance for terrain-pool timing jitter (see ascension.spec) — a
  // per-race ghost rebuild would register several geometries and still fail.
  expect(second.geometries).toBeLessThanOrEqual(first.geometries + 1);
  expect(second.textures).toBe(first.textures);
});

test('the sample buffer caps by decimating and doubling its cadence', async ({ page }) => {
  test.setTimeout(300000);
  await bootEndless(page);
  // Survive ~640 game-seconds: cap = 4000 samples × 0.15s = 600s of path.
  // Chunked advances keep the stationary hero alive (clock refill + threat
  // sweep per chunk — bubble spawns need >13s to reach the mesa core).
  for (let c = 0; c < 48; c++) {
    await page.evaluate(() => {
      const s = window.__game.state;
      s.enemies.forEach((e) => s.scene.remove(e));
      s.enemies = [];
      window.__game.debug.clearPendingSpawns();
      s.players[0].collectTimeLeft = 15;
    });
    await page.evaluate(() => window.__game.debug.advance(13.5));
  }
  const i = await info(page);
  expect(i.recording).toBeLessThanOrEqual(4000);
  expect(i.interval).toBeGreaterThan(0.15); // The cadence doubled at the cap
});
