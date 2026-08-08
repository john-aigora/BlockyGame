import { test, expect } from '@playwright/test';
import { openGame, startGame, waitForGameOver, GATE_PASSWORD } from './helpers.js';

// Audio (plan 010): real output can't be asserted headlessly, so these
// tests assert STATE (mute persistence, context lifecycle, music
// scheduler activity) and RESILIENCE (no sfx call may ever throw).

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
});

test('mute persists: localStorage flag, label, and aria survive a reload', async ({ page }) => {
  await openGame(page);
  await page.locator('#mute-button').click();
  expect(await page.evaluate(() => localStorage.getItem('blocky.muted'))).toBe('1');
  await expect(page.locator('#mute-button')).toHaveText('\u{1F507}');
  await page.reload();
  await expect(page.locator('#mute-button')).toHaveText('\u{1F507}');
  await expect(page.locator('#mute-button')).toHaveAttribute('aria-pressed', 'true');
});

test('sfx before any gesture are safe no-ops (no context, no crash)', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => {
    window.__game.debug.sfx.collect();
    window.__game.debug.sfx.kill();
    window.__game.debug.sfx.death();
    window.__game.debug.sfx.start();
    window.__game.debug.sfx.click();
  });
  // No gesture ran unlockAudio, so no AudioContext may exist yet.
  // (audioState() returns an object since plan 023 — .state is the old string.)
  expect(await page.evaluate(() => window.__game.debug.audioState().state)).toBe('none');
});

test('starting a run unlocks the AudioContext', async ({ page }) => {
  await openGame(page);
  await startGame(page);
  // Chromium normally reports 'running' after a real click gesture; CI can
  // lag at 'suspended' — the plan-sanctioned assertion is "context exists".
  expect(await page.evaluate(() => window.__game.debug.audioState().state)).not.toBe('none');
});

test('full playthrough with mute ON stays silent-safe to the death screen', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('blocky.muted', '1'));
  await openGame(page);
  await startGame(page);
  await waitForGameOver(page);
  expect(await page.evaluate(() => window.__game.debug.isMuted())).toBe(true);
});

test('title warmth: a real gate submit feeds the overlay bed at half gain; START restores full volume', async ({ page }) => {
  // REAL gate flow — no bypass: the trusted submit CLICK is the audio
  // gesture index.html rides unlockAudio on (plan 023 Step 5).
  await page.goto('/');
  await page.locator('#gate-password').fill(GATE_PASSWORD);
  await page.locator('#gate-submit').click();
  await expect(page.locator('#start-overlay')).toBeVisible();
  await page.waitForFunction(() => window.__game?.state?.onStartScreen === true);

  const audio = await page.evaluate(() => window.__game.debug.audioState());
  expect(audio.state).not.toBe('none'); // The gate gesture at least created the context
  if (audio.state === 'running') {
    // Autoplay accepted the gesture: the quiet bed must actually be looping.
    expect(await page.evaluate(() => window.__game.debug.musicActive())).toBe(true);
    expect(audio.musicVolume).toBe(0.5);
  } // 'suspended' (CI lag): the bed skips SILENTLY by design — nothing to assert.

  await page.locator('#start-button').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  // startRun always restores full volume and starts (or keeps) the loop.
  await expect
    .poll(() => page.evaluate(() => window.__game.debug.audioState().musicVolume))
    .toBe(1);
  expect(await page.evaluate(() => window.__game.debug.musicActive())).toBe(true);
});

test('overlay FAMILY BEST shows the endless board top distance (distance-ranked)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('blocky.hiscores.endless.v1', JSON.stringify([
    { score: 40, distance: 1234, date: '2026-08-01' },
    { score: 99, distance: 800, date: '2026-08-02' } // Richer but shorter — must NOT win
  ])));
  await openGame(page);
  await expect(page.locator('#family-best')).toBeVisible();
  await expect(page.locator('#family-best')).toContainText('1234u');
});

test('overlay FAMILY BEST stays hidden with no recorded runs', async ({ page }) => {
  await openGame(page);
  await expect(page.locator('#family-best')).toBeHidden();
});

test('music lifecycle: off before start, on during the run, off after death; never on while muted', async ({ page }) => {
  await openGame(page);
  const musicActive = () => page.evaluate(() => window.__game.debug.musicActive());
  expect(await musicActive()).toBe(false);
  await startGame(page);
  expect(await musicActive()).toBe(true);
  await waitForGameOver(page);
  await page.waitForTimeout(1000); // let the 0.3s fadeout finish
  expect(await musicActive()).toBe(false);
  // Muted at boot: the scheduler must never start at all.
  await page.addInitScript(() => localStorage.setItem('blocky.muted', '1'));
  await openGame(page);
  await startGame(page);
  await page.waitForTimeout(300);
  expect(await musicActive()).toBe(false);
});
