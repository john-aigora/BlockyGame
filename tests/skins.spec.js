import { test, expect } from '@playwright/test';
import { bypassGate, openGame } from './helpers.js';

// --- Hero skins + milestone unlocks (plan 035) ---
// Palettes are a look (characters.js SKIN_PALETTES); unlocks derive LIVE
// from the solo boards (no unlock storage); the SKIN button cycles EARNED
// palettes only; seat 0's default must stay byte-identical to the classic
// ember hero; P2's teal identity is untouchable.

const EMBER = 0xFF4500;
const LIME = 0x9CCC65;
const TEAL = 0x26C6DA; // P2_BODY_COLOR

function heroColor(page, seat = 0) {
  return page.evaluate((n) =>
    window.__game.state.players[n].mesh.userData.bodyMesh.material.color.getHex(), seat);
}

function skinInfo(page) {
  return page.evaluate(() => window.__game.debug.skinInfo());
}

function clickSkin(page) {
  return page.locator('#skin-button').click();
}

test('fresh profile: the default hero is byte-identical classic ember', async ({ page }) => {
  await openGame(page);
  expect(await heroColor(page)).toBe(EMBER);
  await expect(page.locator('#skin-button')).toHaveText('SKIN: EMBER');
  const i = await skinInfo(page);
  expect(i.unlocked).toEqual(['ember']);
});

test('with nothing unlocked the cycle button has nowhere to go', async ({ page }) => {
  await openGame(page);
  await clickSkin(page);
  await clickSkin(page);
  expect(await heroColor(page)).toBe(EMBER);
  await expect(page.locator('#skin-button')).toHaveText('SKIN: EMBER');
});

test('a 600u board row unlocks LIME; cycling selects it and reskins the hero in place', async ({ page }) => {
  await bypassGate(page);
  await page.addInitScript(() => {
    localStorage.setItem('blocky.hiscores.endless.v1',
      JSON.stringify([{ score: 40, distance: 600, date: '2026-08-01' }]));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect((await skinInfo(page)).unlocked).toEqual(['ember', 'lime']);
  await clickSkin(page);
  await expect(page.locator('#skin-button')).toHaveText('SKIN: LIME');
  expect(await heroColor(page)).toBe(LIME);
  expect((await skinInfo(page)).selected).toBe('lime');
});

test('the selection persists across a reload', async ({ page }) => {
  await bypassGate(page);
  await page.addInitScript(() => {
    localStorage.setItem('blocky.hiscores.endless.v1',
      JSON.stringify([{ score: 40, distance: 600, date: '2026-08-01' }]));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  await clickSkin(page); // -> lime
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await heroColor(page)).toBe(LIME);
  await expect(page.locator('#skin-button')).toHaveText('SKIN: LIME');
});

test('a stored-but-locked selection falls back to ember (boards cleared)', async ({ page }) => {
  await bypassGate(page);
  await page.addInitScript(() => {
    localStorage.setItem('blocky.skin.v1', 'gold'); // No boards back it up
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await heroColor(page)).toBe(EMBER);
  await expect(page.locator('#skin-button')).toHaveText('SKIN: EMBER');
});

test('cycling twice through every unlocked skin leaks nothing into the scene', async ({ page }) => {
  await bypassGate(page);
  await page.addInitScript(() => {
    // Unlock everything: distance 1200 (lime+midnight), score 1500 (gold),
    // an ascended row (celestial).
    localStorage.setItem('blocky.hiscores.endless.v1', JSON.stringify([
      { score: 1500, distance: 1200, date: '2026-08-01', asc: true }
    ]));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect((await skinInfo(page)).unlocked)
    .toEqual(['ember', 'lime', 'midnight', 'gold', 'celestial']);
  // Let the title-screen world finish materializing first — terrain chunks
  // (~2/frame) and their seeded clouds land for a while after boot and
  // would drown the comparison in unrelated (legitimate) growth. Stability
  // = the SAME top-level child count across two spaced samples.
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  await expect.poll(async () => {
    const a = await page.evaluate(() => window.__game.state.scene.children.length);
    await page.evaluate(() => new Promise((r) => {
      let left = 30;
      const step = () => (--left <= 0 ? r() : requestAnimationFrame(step));
      step();
    }));
    const b = await page.evaluate(() => window.__game.state.scene.children.length);
    return b - a;
  }, { timeout: 30000 }).toBe(0);
  const before = await page.evaluate(() => ({
    children: window.__game.state.scene.children.length,
    geometries: window.__game.debug.perfInfo().geometries
  }));
  for (let i = 0; i < 10; i++) await clickSkin(page); // 2 full laps of 5
  const after = await page.evaluate(() => ({
    children: window.__game.state.scene.children.length,
    geometries: window.__game.debug.perfInfo().geometries
  }));
  expect(after.children).toBe(before.children); // Old heroes removed, no strays
  // ±1 tolerance: renderer-memory registration of a late chunk/cloud can
  // land between samples under load (same jitter class as the ascension and
  // ghost plateau specs). Ten reskins of a leaking path would add far more.
  expect(after.geometries).toBeLessThanOrEqual(before.geometries + 1);
  expect(await heroColor(page)).toBe(EMBER); // 10 clicks = back to the start
});

test('P2 is ALWAYS teal, whatever P1 wears', async ({ page }) => {
  await bypassGate(page);
  await page.addInitScript(() => {
    localStorage.setItem('blocky.hiscores.endless.v1',
      JSON.stringify([{ score: 40, distance: 600, date: '2026-08-01' }]));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  await clickSkin(page); // P1 -> lime
  await page.evaluate(() => window.__game.debug.startTwoPlayer());
  await page.waitForFunction(() => window.__game.state.players.length === 2 &&
    window.__game.state.players.every((p) => p.mesh));
  expect(await heroColor(page, 0)).toBe(LIME);
  expect(await heroColor(page, 1)).toBe(TEAL);
});
