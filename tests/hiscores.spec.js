import { test, expect } from '@playwright/test';
import { startGame, waitForGameOver } from './helpers.js';

// Local high scores (plan 009): recording, ranking, trimming, and storage
// resilience. Each test seeds localStorage via addInitScript BEFORE goto,
// then plays an idle run to death (collect-clock expiry or enemy collision
// — either way, score 0).

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
});

async function idleRunToDeath(page) {
  await page.goto('/');
  await startGame(page);
  await waitForGameOver(page); // Game-clock death; load-proof ceiling (helpers.js)
}

test('records the run and ranks it below an existing better score', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('blocky.hiscores.v1', JSON.stringify([{ score: 50, date: '2026-01-01' }]));
  });
  await idleRunToDeath(page);
  const rows = page.locator('#hiscore-slot .hiscore-list li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('50');
  await expect(rows.nth(1)).toHaveClass(/is-new/);
  await expect(rows.nth(1)).toContainText('0');
  // The better pre-existing score is NOT the new one.
  await expect(rows.nth(0)).not.toHaveClass(/is-new/);
});

test('first-ever run shows the NEW BEST! badge at rank 0', async ({ page }) => {
  await idleRunToDeath(page); // fresh context — empty storage; score 0 places first
  await expect(page.locator('#hiscore-slot .hiscore-badge')).toHaveText('NEW BEST!');
  await expect(page.locator('#hiscore-slot .hiscore-list li').first()).toHaveClass(/is-new/);
});

test('list is trimmed to top 5 and a worse run does not displace them', async ({ page }) => {
  await page.addInitScript(() => {
    const five = [50, 40, 30, 20, 10].map((score) => ({ score, date: '2026-01-01' }));
    localStorage.setItem('blocky.hiscores.v1', JSON.stringify(five));
  });
  await idleRunToDeath(page);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('blocky.hiscores.v1')));
  expect(stored.length).toBe(5);
  expect(Math.min(...stored.map((e) => e.score))).toBe(10); // 0 didn't place
});

test('corrupt storage never crashes: death screen still renders', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('blocky.hiscores.v1', '{corrupt');
  });
  await idleRunToDeath(page); // the beforeEach pageerror trap enforces "no crash"
  await expect(page.locator('#death-title')).toHaveText('GAME OVER');
  // Corrupt data reads as an empty list; this run is recorded as its only entry.
  await expect(page.locator('#hiscore-slot .hiscore-list li')).toHaveCount(1);
});
