import { test, expect } from '@playwright/test';
import { openGame, startGame, waitForGameOver } from './helpers.js';

// Local high scores (plan 009): recording, ranking, trimming, and storage
// resilience. Each test seeds localStorage via addInitScript BEFORE goto,
// then plays an idle run to death (collect-clock expiry or enemy collision
// — either way, score 0).

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
});

async function idleRunToDeath(page) {
  await openGame(page);
  await startGame(page);
  await waitForGameOver(page); // Game-clock death; load-proof ceiling (helpers.js)
}

test('records the run and ranks it below existing runs — distance-first, not score-first', async ({ page }) => {
  // Endless board (the one the death screen renders) ranks by DISTANCE first
  // (src/hiscores.js sortBoard); an idle run scores 0 points and ~0 distance,
  // so both seeded entries stay above it (plan 017 endless-semantics rewrite).
  // H2 (B1 review): the seeds are rank-DIVERGENT — the poorest run carries
  // the longest distance, and is stored BELOW the rich one — so this spec
  // discriminates distance-first ranking from score ordering (score-first,
  // or a deleted distance term, would put the 50-pointer on top).
  await page.addInitScript(() => {
    localStorage.setItem('blocky.hiscores.endless.v1', JSON.stringify([
      { score: 50, date: '2026-01-01', distance: 400 },
      { score: 5, date: '2026-01-02', distance: 900 } // Broke but far — must win the board
    ]));
  });
  await idleRunToDeath(page);
  const rows = page.locator('#hiscore-slot .hiscore-list li');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('900u — 5 pts'); // Distance beats score...
  await expect(rows.nth(1)).toContainText('400u — 50 pts'); // ...the rich run sits second
  await expect(rows.nth(2)).toHaveClass(/is-new/);
  await expect(rows.nth(2)).toContainText('0');
  // The better pre-existing runs are NOT the new one.
  await expect(rows.nth(0)).not.toHaveClass(/is-new/);
  await expect(rows.nth(1)).not.toHaveClass(/is-new/);
});

test('first-ever run shows the NEW BEST! badge at rank 0', async ({ page }) => {
  await idleRunToDeath(page); // fresh context — empty storage; score 0 places first
  await expect(page.locator('#hiscore-slot .hiscore-badge')).toHaveText('NEW BEST!');
  await expect(page.locator('#hiscore-slot .hiscore-list li').first()).toHaveClass(/is-new/);
});

test('list is trimmed to top 5 and a worse run does not displace them', async ({ page }) => {
  // Endless key + descending distance values: the board ranks by distance,
  // so the idle run's ~0u entry lands last and is trimmed (plan 017).
  await page.addInitScript(() => {
    const five = [50, 40, 30, 20, 10].map((score, i) => ({ score, date: '2026-01-01', distance: 500 - i * 100 }));
    localStorage.setItem('blocky.hiscores.endless.v1', JSON.stringify(five));
  });
  await idleRunToDeath(page);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('blocky.hiscores.endless.v1')));
  expect(stored.length).toBe(5);
  expect(Math.min(...stored.map((e) => e.score))).toBe(10); // 0 didn't place
});

test('corrupt storage never crashes: death screen still renders', async ({ page }) => {
  await page.addInitScript(() => {
    // H1 (B1 review): corrupt the ENDLESS key — the board this death screen
    // actually reads — so loadHiscores' try/catch is genuinely exercised.
    // (The old seed corrupted the retired classic key, which nothing reads.)
    localStorage.setItem('blocky.hiscores.endless.v1', '{corrupt');
  });
  await idleRunToDeath(page); // the beforeEach pageerror trap enforces "no crash"
  await expect(page.locator('#death-title')).toHaveText('GAME OVER');
  // Corrupt data reads as an empty list; this run is recorded as its only entry.
  await expect(page.locator('#hiscore-slot .hiscore-list li')).toHaveCount(1);
});

test('board rows record the run\'s chosen speed multiplier — and only when it was used (plan 036)', async ({ page }) => {
  await page.addInitScript(() => {
    // A legacy row (no mult field) must render exactly as before.
    localStorage.setItem('blocky.hiscores.endless.v1',
      JSON.stringify([{ score: 7, distance: 120, date: '2026-01-01' }]));
  });
  await openGame(page);
  await startGame(page);
  // Choose 2x through the real control path, then die by clock expiry.
  await page.evaluate(() => {
    window.__game.debug.cycleSpeed(0); // 1x -> 1.5x
    window.__game.debug.cycleSpeed(0); // 1.5x -> 2x
    window.__game.debug.advance(16);
  });
  await waitForGameOver(page);
  const rows = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('blocky.hiscores.endless.v1')));
  const fresh = rows.find((r) => r.date !== '2026-01-01');
  const legacy = rows.find((r) => r.date === '2026-01-01');
  expect(fresh.mult).toBe(2);
  expect(legacy.mult).toBeUndefined(); // Untouched
  // The rendered board says so too — and ONLY for the run that used it.
  await expect(page.locator('#hiscore-slot .hiscore-list')).toContainText('· 2x');
  const legacyRowText = await page.locator('#hiscore-slot .hiscore-list li')
    .filter({ hasText: '2026-01-01' }).textContent();
  expect(legacyRowText).not.toContain('·');

  // An untouched 1x run stores NO mult field and renders NO suffix. The
  // seat's speed index PERSISTS across restarts (pre-existing behavior),
  // so drop back to 1x BEFORE restarting — the high-water reseeds at setup.
  await page.evaluate(() => {
    window.__game.state.players[0].speedMultiplierIndex = 0;
    window.__game.debug.applySpeedMultiplier();
  });
  await page.locator('#restart-button').click();
  await startGame(page);
  await page.evaluate(() => window.__game.debug.advance(16));
  await waitForGameOver(page);
  const rows2 = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('blocky.hiscores.endless.v1')));
  const oneX = rows2.filter((r) => r.date !== '2026-01-01' && r.mult === undefined);
  expect(oneX.length).toBeGreaterThanOrEqual(1);
});
