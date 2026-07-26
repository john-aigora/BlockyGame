import { test, expect } from '@playwright/test';
import { startGame } from './helpers.js';

// Tension systems (awesome pass): the panic timer tags the HUD when the
// collect countdown enters its last 5 seconds, and the danger vignette's
// opacity rises when a non-killable enemy stalks inside DANGER_RADIUS.

test('panic class engages under 5s and the danger vignette rises near an enemy', async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1);
  await startGame(page);

  // PANIC: drop the countdown into the final 5 seconds; the next game-clock
  // tick must tag the timer display with the pulsing class.
  await page.evaluate(() => { window.__game.state.collectTimeLeft = 4; });
  await expect(page.locator('#collect-timer-display')).toHaveClass(/timer-panic/);

  // DANGER: refill the clock (so collect-expiry can't end the run mid-poll),
  // then park the boot enemy — non-killable, and counted even while it is
  // still materializing — just inside DANGER_RADIUS. The vignette's eased
  // opacity must rise above zero within a few frames.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.collectTimeLeft = 14;
    const enemy = s.enemies[0];
    enemy.position.x = s.player.position.x + 6;
    enemy.position.z = s.player.position.z;
  });
  await expect
    .poll(
      () => page.evaluate(() => Number(document.getElementById('danger-vignette').style.opacity)),
      { timeout: 5000 }
    )
    .toBeGreaterThan(0);
});
