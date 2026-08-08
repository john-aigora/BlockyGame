import { test, expect } from '@playwright/test';
import { openGame, startGame, waitForGameOver, settleFrames } from './helpers.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
});

// Start the run and let it end (collect-clock expiry or enemy collision).
async function reachGameOver(page) {
  await startGame(page);
  await waitForGameOver(page); // Game-clock death; load-proof ceiling (helpers.js)
}

test('the world freezes on death: no movement, no post-mortem spawning', async ({ page }) => {
  await reachGameOver(page);
  const snapshot = () =>
    page.evaluate(() => window.__game.state.enemies.map((e) => [e.position.x, e.position.z]));
  const positionsBefore = await snapshot();
  const countBefore = positionsBefore.length;
  // The game clock is DEAD here — rendered frames are the honest axis: the
  // loop keeps drawing the frozen scene, and across 60 real frames nothing
  // may move or spawn.
  await settleFrames(page, 60);
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
  // Stability: a second death trigger or stray frame must not rewrite it —
  // 60 more RENDERED frames (the game clock is dead; frames are the axis).
  await settleFrames(page, 60);
  await expect(page.locator('#death-title')).toHaveText('GAME OVER');
  await expect(page.locator('#death-reason')).toHaveText(reason);
  await expect(page.locator('#final-score')).toHaveText(score);
});

test('the death screen waits out the cinematic death beat (~0.9s)', async ({ page }) => {
  // Reaching death takes 15 GAME seconds — far more wall time under
  // parallel-suite load (see helpers.js). The beat itself is a wall-clock
  // setTimeout, so the measured delay bounds below stay load-independent.
  test.setTimeout(150000);
  await startGame(page);
  // ONE in-page measurement captures the gap from gameActive flipping false
  // to #message-box turning visible — no protocol round-trips can shrink or
  // stretch it, and neither can main-thread starvation: a polled sampler
  // (e.g. a 16ms setInterval) under-reads the beat when parallel-suite load
  // stretches its firing gaps. Death edge: deaths only happen inside the
  // game's rAF update, and a test rAF callback runs in the SAME frame batch
  // right after it — near-zero capture lag at any load. Display edge: the
  // show is a style mutation, so a MutationObserver fires synchronously
  // with the setTimeout callback that reveals the death screen.
  const delayMs = await page.evaluate(() => new Promise((resolve) => {
    const box = document.getElementById('message-box');
    function frame() {
      if (window.__game.state.gameActive) {
        requestAnimationFrame(frame);
        return;
      }
      const deathAt = performance.now();
      new MutationObserver(() => {
        if (getComputedStyle(box).display !== 'none') {
          resolve(performance.now() - deathAt);
        }
      }).observe(box, { attributes: true, attributeFilter: ['style'] });
    }
    requestAnimationFrame(frame);
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
    .poll(async () => Number(await page.locator('#collect-time').textContent()), { timeout: 15000 })
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
    .poll(async () => Number(await page.locator('#collect-time').textContent()), { timeout: 15000 })
    .toBeLessThan(15);
});
