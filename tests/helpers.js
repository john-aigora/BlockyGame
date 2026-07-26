import { expect } from '@playwright/test';

// Shared game-start helper (plan 008). The game boots into the start
// overlay; every spec that needs a running game goes through the real
// entry point — the overlay's START button — never the pause button.
// Also used after "Play Again", which returns to the start overlay.
export async function startGame(page) {
  await page.locator('#start-button').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
}
