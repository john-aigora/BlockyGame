import { test, expect } from '@playwright/test';
import { GATE_PASSWORD, unlockGate } from './helpers.js';

test('gate rejects a wrong password and accepts blocky', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#gate-overlay')).toBeVisible();
  // main.js has not loaded yet — start UI is not interactive behind the gate
  await expect(page.locator('#gate-password')).toBeVisible();

  await page.locator('#gate-password').fill('wrong');
  await page.locator('#gate-form').evaluate((form) => form.requestSubmit());
  await expect(page.locator('#gate-error')).toBeVisible();
  await expect(page.locator('#gate-overlay')).toBeVisible();

  await unlockGate(page);
  await expect(page.locator('#start-overlay')).toBeVisible();
  await expect(page.locator('#start-button')).toBeVisible();
  expect(GATE_PASSWORD).toBe('blocky');
});
