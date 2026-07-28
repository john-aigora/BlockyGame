import { test, expect } from '@playwright/test';
import { startGame } from './helpers.js';

// Mobile polish (plan 012): touches that start on UI never drive movement,
// exactly one tracked finger owns the drag, and the phone layout applies.
// Runs on an emulated phone: touch-capable, 390x844.
// The drag test drives the exported handlers with fabricated event objects
// (window.__game.debug.touchHandlers) — the identifier-tracking and
// UI-exclusion logic is the target, not browser event plumbing.

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1);
});

test('a tap on the pause button pauses without moving the player', async ({ page }) => {
  await startGame(page);
  const before = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    z: window.__game.state.player.position.z
  }));
  await page.tap('#pause-button');
  await expect(page.locator('#pause-button')).toHaveText('Resume'); // It really paused
  await page.waitForTimeout(300); // Any wrongly-started drag would move the player here
  const after = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    z: window.__game.state.player.position.z,
    touchActive: window.__game.state.touchActive
  }));
  expect(after.touchActive).toBe(false);
  expect(after.x).toBe(before.x);
  expect(after.z).toBe(before.z);
});

test('a canvas drag moves the player; a second finger cannot hijack it', async ({ page }) => {
  await startGame(page);
  const beforeX = await page.evaluate(() => window.__game.state.player.position.x);

  await page.evaluate(() => {
    const h = window.__game.debug.touchHandlers;
    const canvas = document.querySelector('#game-container canvas');
    const pauseButton = document.getElementById('pause-button');
    const touch = (id, x, y) => ({ identifier: id, clientX: x, clientY: y });
    const ev = (target, ...changed) => ({
      target, preventDefault() {}, changedTouches: changed, touches: changed
    });
    h.onTouchStart(ev(canvas, touch(7, 100, 300)));
    h.onTouchMove(ev(canvas, touch(7, 220, 300))); // 120px right — full-strength drag
    // Second finger taps Pause mid-drag: a button touch never drives movement.
    h.onTouchStart(ev(pauseButton, touch(8, 350, 30)));
    // A second finger on the canvas cannot restart the drag either...
    h.onTouchStart(ev(canvas, touch(9, 100, 700)));
    // ...and moves from a non-driving identifier are ignored.
    h.onTouchMove(ev(canvas, touch(9, 100, 500)));
  });

  const vector = await page.evaluate(() => window.__game.state.movementVector);
  expect(vector.x).toBeCloseTo(1); // Still the first finger's rightward drag
  expect(vector.y).toBeCloseTo(0);

  await page.waitForTimeout(400); // Let the run integrate the vector
  const afterX = await page.evaluate(() => window.__game.state.player.position.x);
  expect(afterX).toBeGreaterThan(beforeX);

  const endState = await page.evaluate(() => {
    const h = window.__game.debug.touchHandlers;
    const canvas = document.querySelector('#game-container canvas');
    const touch = (id, x, y) => ({ identifier: id, clientX: x, clientY: y });
    const ev = (target, ...changed) => ({
      target, preventDefault() {}, changedTouches: changed, touches: changed
    });
    // A non-driving finger lifting keeps the drag alive...
    h.onTouchEndOrCancel(ev(canvas, touch(9, 100, 500)));
    const midDrag = window.__game.state.touchActive;
    // ...and only the driving finger ends it.
    h.onTouchEndOrCancel(ev(canvas, touch(7, 220, 300)));
    return { midDrag, after: window.__game.state.touchActive, vector: window.__game.state.movementVector };
  });
  expect(endState.midDrag).toBe(true);
  expect(endState.after).toBe(false);
  expect(endState.vector).toEqual({ x: 0, y: 0 });
});

test('phone layout: instructions hidden, buttons at least 44px', async ({ page }) => {
  await expect(page.locator('#instructions')).toBeHidden();
  const pause = await page.evaluate(() => {
    const btn = document.getElementById('pause-button');
    return {
      minHeight: parseFloat(getComputedStyle(btn).minHeight),
      height: btn.getBoundingClientRect().height
    };
  });
  expect(pause.minHeight).toBeGreaterThanOrEqual(44);
  expect(pause.height).toBeGreaterThanOrEqual(44);
});
