import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
});

test('game boots: canvas renders, score 0, starts paused', async ({ page }) => {
  await expect(page.locator('#game-container canvas')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#pause-button')).toBeVisible();
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1);
});

test('unpausing starts the collect countdown', async ({ page }) => {
  await page.locator('#pause-button').click();
  await expect
    .poll(async () => Number(await page.locator('#collect-time').textContent()), { timeout: 5000 })
    .toBeLessThan(15);
});

test('an idle game reaches game over', async ({ page }) => {
  await page.locator('#pause-button').click();
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('#message-text')).toContainText('GAME OVER');
});

test('Play Again resets the game', async ({ page }) => {
  await page.locator('#pause-button').click();
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 25000 });
  await page.locator('#restart-button').click();
  await expect(page.locator('#message-box')).toBeHidden();
  await expect(page.locator('#score')).toHaveText('0');
});
