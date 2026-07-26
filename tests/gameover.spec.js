import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
});

// Unpause and let the run end (collect-clock expiry or enemy collision).
async function reachGameOver(page) {
  await page.locator('#pause-button').click();
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

test('the game-over message renders once and stays stable', async ({ page }) => {
  await reachGameOver(page);
  const text = await page.locator('#message-text').textContent();
  expect(text.match(/GAME OVER/g)).toHaveLength(1);
  expect(text).toContain('Final Score');
  await page.waitForTimeout(2000);
  await expect(page.locator('#message-text')).toHaveText(text);
});

test('restart still works after the post-death freeze', async ({ page }) => {
  await reachGameOver(page);
  await page.locator('#restart-button').click();
  await expect(page.locator('#message-box')).toBeHidden();
  await expect(page.locator('#score')).toHaveText('0');
  // The new run must actually simulate again despite the gameActive gate.
  await page.locator('#pause-button').click();
  await expect
    .poll(async () => Number(await page.locator('#collect-time').textContent()), { timeout: 5000 })
    .toBeLessThan(15);
});
