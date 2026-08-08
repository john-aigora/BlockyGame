import { test, expect } from '@playwright/test';
import { bypassGate, startGame, waitForGameOver } from './helpers.js';

// World identity & late game (plan 025): seeded worlds (?seed= / the DAILY
// world), the daily board, named biome regions, gold food, and the 1000u
// titan. Seeded determinism makes every case reproducible; waits ride the
// game clock (state.runTime) — never wall time.

// Per-test navigation (the cases differ by URL query), so no shared
// openGame beforeEach — just the pageerror trap.
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
});

async function openWorld(page, query = '') {
  await bypassGate(page);
  await page.goto('/' + query);
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
}

// The local YYYYMMDD the page's own clock resolves for the daily world —
// computed in-page so a midnight-crossing runner and the game always agree.
function pageDailySeed(page) {
  return page.evaluate(() => {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  });
}

test('?seed= drives the world: same seed reproduces terrain, another seed changes it', async ({ page }) => {
  await openWorld(page, '?seed=123');
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: 123, daily: false });
  await expect(page.locator('#seed-line')).toHaveText('SEED 123');
  const sample = () => page.evaluate(() =>
    [[10, 10], [123.4, -567.8], [-3210.7, 77.7]].map(([x, z]) => window.__game.debug.terrainHeight(x, z)));
  const first = await sample();

  // Reload, same seed: bit-identical heights.
  await page.reload();
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await sample()).toEqual(first);

  // A different seed is a different world.
  await page.goto('/?seed=124');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: 124, daily: false });
  const other = await sample();
  expect(other).not.toEqual(first);
});

test("TODAY'S WORLD toggle flips the daily seed on and off across its reload", async ({ page }) => {
  await openWorld(page);
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: 20260726, daily: false });
  await expect(page.locator('#daily-toggle')).not.toHaveClass(/mode-selected/);

  // ON: the click persists the flag and reloads; the seed becomes today's
  // local YYYYMMDD. evaluate() may race the navigation — poll through it.
  await page.locator('#daily-toggle').click();
  await expect.poll(
    () => page.evaluate(() => window.__game?.debug?.worldSeedInfo?.().daily).catch(() => null),
    { timeout: 30000 }
  ).toBe(true);
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  const daily = await pageDailySeed(page);
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: daily, daily: true });
  await expect(page.locator('#seed-line')).toHaveText(`SEED ${daily} · DAILY`);
  await expect(page.locator('#daily-toggle')).toHaveClass(/mode-selected/);
  // The toggle press must NOT have started a run (the overlay's own
  // pointerdown starts runs; the button stops propagation).
  await expect(page.locator('#start-overlay')).toBeVisible();

  // OFF: back to the default world.
  await page.locator('#daily-toggle').click();
  await expect.poll(
    () => page.evaluate(() => window.__game?.debug?.worldSeedInfo?.().daily).catch(() => null),
    { timeout: 30000 }
  ).toBe(false);
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: 20260726, daily: false });
  await expect(page.locator('#seed-line')).toHaveText('SEED 20260726');
});

test("a daily death records BOTH boards, shows TODAY'S BEST, and prunes stale seeds", async ({ page }) => {
  await bypassGate(page);
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('blocky.daily', '1');
      // A stale-world row (another day's seed): must neither render nor
      // survive the next write — pruned on read.
      localStorage.setItem('blocky.hiscores.daily.v1', JSON.stringify([
        { score: 99, distance: 9999, seed: 20200101, date: '2020-01-01' }
      ]));
      localStorage.removeItem('blocky.hiscores.endless.v1');
    } catch { /* storage unavailable — the assertions below would fail loudly */ }
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo().daily)).toBe(true);

  await startGame(page);
  // End the run immediately: the collect clock is the fastest legal death.
  await page.evaluate(() => { window.__game.state.collectTimeLeft = 0.05; });
  await waitForGameOver(page);

  const boards = await page.evaluate(() => ({
    daily: JSON.parse(localStorage.getItem('blocky.hiscores.daily.v1')),
    endless: JSON.parse(localStorage.getItem('blocky.hiscores.endless.v1'))
  }));
  const daily = await pageDailySeed(page);
  expect(boards.endless).toHaveLength(1); // A daily run is an endless run too
  expect(boards.daily).toHaveLength(1); // The stale 20200101 row was pruned by the record's read
  expect(boards.daily[0].seed).toBe(daily);
  expect(boards.daily[0].score).toBe(boards.endless[0].score);

  await expect(page.locator('#hiscore-slot')).toContainText("TODAY'S BEST");
  await expect(page.locator('#hiscore-slot')).not.toContainText('9999'); // Stale row never renders
});

test('?daily=1 resolves the daily seed without the toggle', async ({ page }) => {
  await openWorld(page, '?daily=1');
  const daily = await pageDailySeed(page);
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: daily, daily: true });
  // ?seed= outranks the daily flag: an explicit world is never re-seeded.
  await page.goto('/?seed=55&daily=1');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: 55, daily: false });
});
