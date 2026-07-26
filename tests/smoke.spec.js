import { test, expect } from '@playwright/test';
import { startGame } from './helpers.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
});

test('game boots into the start overlay over a rendered scene', async ({ page }) => {
  await expect(page.locator('#game-container canvas')).toBeVisible();
  await expect(page.locator('#start-overlay')).toBeVisible();
  await expect(page.locator('#start-overlay')).toContainText('BLOCKY');
  await expect(page.locator('#start-button')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('0');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1);
});

test('START begins the run: the collect countdown ticks', async ({ page }) => {
  await startGame(page);
  await expect
    .poll(async () => Number(await page.locator('#collect-time').textContent()), { timeout: 5000 })
    .toBeLessThan(15);
});

test('pressing a key on the start overlay begins the run', async ({ page }) => {
  await page.keyboard.press('Enter');
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect
    .poll(async () => Number(await page.locator('#collect-time').textContent()), { timeout: 5000 })
    .toBeLessThan(15);
});

test('an idle game reaches game over', async ({ page }) => {
  await startGame(page);
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('#death-title')).toHaveText('GAME OVER');
  await expect(page.locator('#final-score')).toHaveText(/^\d+$/);
});

test('Play Again returns to the start overlay and a fresh run works', async ({ page }) => {
  await startGame(page);
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 25000 });
  await page.locator('#restart-button').click();
  await expect(page.locator('#message-box')).toBeHidden();
  await expect(page.locator('#start-overlay')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('0');
  // The overlay's START must begin an actually-simulating fresh run.
  await startGame(page);
  await expect
    .poll(async () => Number(await page.locator('#collect-time').textContent()), { timeout: 5000 })
    .toBeLessThan(15);
});
