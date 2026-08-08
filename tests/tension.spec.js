import { test, expect } from '@playwright/test';
import { openGame, startGame, waitGameSeconds } from './helpers.js';

// Tension systems (awesome pass): the panic timer tags the HUD when the
// collect countdown enters its last 5 seconds, and the danger vignette's
// opacity rises when a non-killable enemy stalks inside DANGER_RADIUS.
// Plan 023 adds the survival axis on top: PHEW!/CLOSE ONE! beats, the TIME
// HUD, and the three-level music intensity.

// Statue mode: freezes every enemy in place so choreography is exact.
// actualEnemySpeed scales chase/orbit/avoid AND future random-drift rolls
// to zero; the one live randomVelocity is zeroed by hand. (A collect would
// recompute the speed — the parked player never collects.)
async function freezeEnemies(page) {
  await page.waitForFunction(() => window.__game.state.enemies[0]?.userData.materializing === undefined);
  await page.evaluate(() => {
    const s = window.__game.state;
    s.collectTimeLeft = 60; // No collect-expiry death mid-choreography
    s.actualEnemySpeed = 0;
    for (const e of s.enemies) e.randomVelocity.set(0, 0, 0);
  });
}

test('panic class engages under 5s and the danger vignette rises near an enemy', async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
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

test('survival TIME HUD ticks m:ss on the game clock and celebrates the minute', async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
  await expect(page.locator('#time')).toHaveText('0:00'); // Fresh boot
  await startGame(page);
  await freezeEnemies(page);

  await waitGameSeconds(page, 2);
  // Atomic read: the HUD must agree with the clock's whole second. (The wait
  // guarantees runTime >= 2; asserting the literal '0:02' would race a loaded
  // machine past the boundary between the wait and the read.)
  const { text, rt } = await page.evaluate(() => ({
    text: document.getElementById('time').textContent,
    rt: window.__game.state.runTime
  }));
  const sec = Math.floor(rt);
  expect(sec).toBeGreaterThanOrEqual(2);
  expect(sec).toBeLessThan(60); // Still in the first minute — format is 0:ss
  expect(text).toBe(`0:${String(sec % 60).padStart(2, '0')}`);

  // Minute beat: jump the clock to just under the boundary and let it cross.
  await page.evaluate(() => { window.__game.state.runTime = 59.5; });
  await waitGameSeconds(page, 1);
  await expect
    .poll(() => page.evaluate(() => window.__game.debug.effectsInfo().lastPopupText), { timeout: 15000 })
    .toBe('1 MINUTE!');
  await expect(page.locator('#time')).toHaveText(/^1:0\d$/);
});

test('PHEW! fires once when a real scare fully drains away', async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
  await startGame(page);
  await freezeEnemies(page);

  // Park the frozen boot giant well inside DANGER_RADIUS (9) but far outside
  // the near-miss band (~1.7u) — pure dread, no CLOSE ONE! competing for the
  // shared rate limit. Let the eased dangerOpacity climb past PHEW_PEAK_MIN
  // (0.15) so the scare counts as real.
  await page.evaluate(() => {
    const s = window.__game.state;
    const e = s.enemies[0];
    e.position.x = s.player.position.x + 5;
    e.position.z = s.player.position.z;
  });
  await expect
    .poll(() => page.evaluate(() => window.__game.state.dangerOpacity), { timeout: 15000 })
    .toBeGreaterThan(0.16);

  // Yank the threat away: the vignette drains to <=0.01 and the escape beat fires.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.enemies[0].position.x = s.player.position.x + 40;
  });
  await expect
    .poll(() => page.evaluate(() => window.__game.debug.effectsInfo().lastPopupText), { timeout: 15000 })
    .toBe('PHEW!');
});

test('CLOSE ONE! fires on a near-miss exit and rate-limits a second pass within 6s', async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
  await startGame(page);
  await freezeEnemies(page);

  // Pass 1: park the frozen hunter just outside contact. Boot giant scale
  // ~1.04 -> arm radius = 1.5 x (0.54 + 1.04x0.6) ~ 1.75u; contact (AABB
  // half-width sum) ~ 1.17u. 1.45u arms without touching.
  const nearThenAway = async () => {
    await page.evaluate(() => {
      const s = window.__game.state;
      const e = s.enemies[0];
      e.position.x = s.player.position.x + 1.45;
      e.position.z = s.player.position.z;
    });
    await waitGameSeconds(page, 0.15); // >=1 danger-pulse frame arms the beat
    await page.evaluate(() => {
      const s = window.__game.state;
      s.enemies[0].position.x = s.player.position.x + 40;
    });
  };
  await nearThenAway();
  await expect
    .poll(() => page.evaluate(() => window.__game.debug.effectsInfo().lastPopupText), { timeout: 15000 })
    .toBe('CLOSE ONE!');
  expect(await page.evaluate(() => window.__game.state.gameActive)).toBe(true); // Slipped away, not eaten

  // Pass 2, inside the 6s game-clock window: a sentinel popup (+7) proves
  // silence — if a second CLOSE ONE! fired it would overwrite lastPopupText.
  await page.evaluate(() => window.__game.debug.spawnScorePopup({ x: 0, y: 1, z: 0 }, 7));
  await nearThenAway();
  await waitGameSeconds(page, 0.5); // The exit frame has long since processed
  expect(await page.evaluate(() => window.__game.debug.effectsInfo().lastPopupText)).toBe('+7');
});
