import { test, expect } from '@playwright/test';
import { startGame } from './helpers.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
});

// Start the run and let it end (collect-clock expiry or enemy collision).
async function reachGameOver(page) {
  await startGame(page);
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 25000 });
}

test('the world freezes on death: no movement, no post-mortem spawning', async ({ page }) => {
  await reachGameOver(page);
  const snapshot = () =>
    page.evaluate(() => window.__game.state.enemies.map((e) => [e.position.x, e.position.z]));
  const positionsBefore = await snapshot();
  const countBefore = positionsBefore.length;
  await page.waitForTimeout(2000);
  const positionsAfter = await snapshot();
  expect(positionsAfter.length).toBe(countBefore);
  expect(positionsAfter).toEqual(positionsBefore);
});

test('the death screen renders once, structured, and stays stable', async ({ page }) => {
  await reachGameOver(page);
  await expect(page.locator('#death-title')).toHaveText('GAME OVER');
  const reason = await page.locator('#death-reason').textContent();
  expect(reason.length).toBeGreaterThan(0);
  await expect(page.locator('#final-score')).toHaveText(/^\d+$/);
  const score = await page.locator('#final-score').textContent();
  // #hiscore-slot hosts the plan-009 leaderboard now.
  await expect(page.locator('#hiscore-slot')).toBeAttached();
  await expect(page.locator('#hiscore-slot .hiscore-title')).toHaveText('BEST RUNS');
  // Stability: a second death trigger or stray frame must not rewrite it.
  await page.waitForTimeout(2000);
  await expect(page.locator('#death-title')).toHaveText('GAME OVER');
  await expect(page.locator('#death-reason')).toHaveText(reason);
  await expect(page.locator('#final-score')).toHaveText(score);
});

test('the death screen waits out the cinematic death beat (~0.9s)', async ({ page }) => {
  await startGame(page);
  // ONE in-page poll measures the gap from gameActive flipping false to
  // #message-box turning visible — no protocol round-trips can shrink or
  // stretch the measurement. 16ms sampling on both edges vs a 900ms delay
  // leaves a comfortable margin over the 850ms floor.
  const delayMs = await page.evaluate(() => new Promise((resolve) => {
    const box = document.getElementById('message-box');
    let deathAt = null;
    const timer = setInterval(() => {
      if (deathAt === null) {
        if (!window.__game.state.gameActive) deathAt = performance.now();
      } else if (getComputedStyle(box).display !== 'none') {
        clearInterval(timer);
        resolve(performance.now() - deathAt);
      }
    }, 16);
  }));
  expect(delayMs).toBeGreaterThan(850); // The beat really played...
  expect(delayMs).toBeLessThan(5000); // ...and the screen still arrived promptly
});

test('restart still works after the post-death freeze', async ({ page }) => {
  await reachGameOver(page);
  await page.locator('#restart-button').click();
  await expect(page.locator('#message-box')).toBeHidden();
  await expect(page.locator('#start-overlay')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('0');
  // The new run must actually simulate again despite the gameActive gate.
  await startGame(page);
  await expect
    .poll(async () => Number(await page.locator('#collect-time').textContent()), { timeout: 5000 })
    .toBeLessThan(15);
});

test('keyboard restart: Space on the death screen returns to the start overlay', async ({ page }) => {
  await reachGameOver(page);
  await page.keyboard.press('Space');
  await expect(page.locator('#message-box')).toBeHidden();
  await expect(page.locator('#start-overlay')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('0');
  // And a key press on the overlay begins the fresh run.
  await page.keyboard.press('Enter');
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect
    .poll(async () => Number(await page.locator('#collect-time').textContent()), { timeout: 5000 })
    .toBeLessThan(15);
});
