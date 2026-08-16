import { test, expect } from '@playwright/test';
import { openGame, startGame, waitGameSeconds, settleFrames } from './helpers.js';

// --- Ascension (plan 029) ---
// Growth's destination: at ASCENSION_SCALE (10) the hero ascends — a
// game-clock ceremony that ends the run as a WIN. These specs drive the
// REAL trigger path (a collect crossing the threshold) via debug.advance —
// never wall-clock waits — and pin: below-threshold neutrality, the
// foreshadow beat, ceremony invulnerability + clock exemption, the solo
// ascended end (title, reason, board mark, bonus), the GAME OVER restore
// invariant, the 2P settle (partner plays on), pause freezing the ceremony,
// and the GPU resource plateau across repeated ceremonies.

async function bootSolo(page) {
  await openGame(page);
  await startGame(page);
}

// Sets seat 0's gameplay scale and forces one real collect at the hero's
// feet — the ONLY growth path, so foreshadow/trigger checks run exactly as
// they do live.
async function growPast(page, scale) {
  await page.evaluate((s) => {
    const g = window.__game;
    g.state.playerScale = s;
    // Mirror the render scale like every real growth does (game.js collect
    // path) — the pickup box measures the RENDER scale, and spawnAtPosition
    // scatters ±1.5u.
    g.state.player.scale.set(s, s, s);
    const p = g.state.player.position;
    g.debug.spawnAtPosition({ x: p.x, y: 0, z: p.z });
  }, scale);
  await page.evaluate(() => window.__game.debug.advance(0.5));
  // A collect grows the gameplay scale by exactly 0.1 — polling the scale is
  // deterministic no matter WHICH nearby food the giant box swept first
  // (live frames run between evaluate round-trips).
  await expect.poll(() => page.evaluate(() => window.__game.state.playerScale))
    .toBeGreaterThanOrEqual(scale + 0.099);
}

function seatInfo(page, seat = 0) {
  return page.evaluate((n) => window.__game.debug.ascensionInfo().seats[n], seat);
}

// Clears the live threat field (the coop.spec pattern): a stationary
// partner must not be eaten by giants while the OTHER hero's ceremony runs
// — this spec asserts ceremony semantics, not partner survival skills.
async function clearThreats(page) {
  await page.evaluate(() => {
    const s = window.__game.state;
    s.enemies.forEach((e) => s.scene.remove(e));
    s.enemies = [];
    window.__game.debug.clearPendingSpawns();
  });
}

test('growth below the foreshadow threshold is byte-neutral: no halo, no ceremony', async ({ page }) => {
  await bootSolo(page);
  await growPast(page, 8.5); // -> 8.6, under ASCENSION_FORESHADOW_SCALE
  const info = await seatInfo(page);
  expect(info.active).toBe(false);
  expect(info.ascended).toBe(false);
  expect(info.foreshadowShown).toBe(false);
  expect(info.haloVisible).toBe(false);
  expect(await page.evaluate(() => window.__game.state.gameActive)).toBe(true);
});

test('crossing scale 9 foreshadows: halo appears and THE SKY AWAITS... fires once', async ({ page }) => {
  await bootSolo(page);
  await growPast(page, 8.95); // -> 9.05 crosses the foreshadow scale
  const info = await seatInfo(page);
  expect(info.foreshadowShown).toBe(true);
  expect(info.haloVisible).toBe(true);
  expect(info.active).toBe(false); // Foreshadow is a warning, not the ceremony
  const popup = await page.evaluate(() => window.__game.debug.effectsInfo().lastPopupText);
  expect(popup).toBe('THE SKY AWAITS...');
});
test('repeated 0.1 growth crosses scale 9 and 10 without an extra pickup', async ({ page }) => {
  await bootSolo(page);
  await growPast(page, Number('8.899999999999986')); // 1 + 79 * 0.1 before pickup 80
  expect((await seatInfo(page)).foreshadowShown).toBe(true);
  await growPast(page, Number('9.899999999999982')); // 1 + 89 * 0.1 before pickup 90
  expect((await seatInfo(page)).active).toBe(true);
});


test('the 90th block triggers the ceremony; the hero is untouchable and unhungry mid-rise', async ({ page }) => {
  test.setTimeout(120000);
  await bootSolo(page);
  await growPast(page, 9.95); // -> 10.05 >= ASCENSION_SCALE
  let info = await seatInfo(page);
  expect(info.active).toBe(true);
  expect(info.phase).toBe('lift');
  // A giant grunt materialized ON the ascending hero: contact must not end
  // the run (ceremony collision exemption) — scale 20 body is far taller
  // than the scale-10 hero, so outside the ceremony this is instant death.
  await page.evaluate(() => {
    const p = window.__game.state.player.position;
    window.__game.debug.spawnSpecies('grunt', p.x, p.z, 20);
  });
  const clockBefore = await page.evaluate(() => window.__game.state.collectTimeLeft);
  await page.evaluate(() => window.__game.debug.advance(2));
  expect(await page.evaluate(() => window.__game.state.gameActive)).toBe(true);
  expect(await page.evaluate(() => window.__game.state.players[0].alive)).toBe(true);
  // The collect clock froze for the ceremony (transcended hunger).
  const clockAfter = await page.evaluate(() => window.__game.state.collectTimeLeft);
  expect(clockAfter).toBeCloseTo(clockBefore, 5);
  info = await seatInfo(page);
  expect(info.active).toBe(true);
  expect(info.rise).toBeGreaterThan(0); // The climb is real
  // The ceremony uses the rendered hero scale once. A double scale would
  // place the halo tens of units above the hero at scale 10.
  expect(info.haloY - info.heroY).toBeLessThan(20);
  expect(info.haloScale).toBeLessThan(20);
});

test('solo completion: ASCENDED! screen, crowned reason, +500 bonus, marked board row', async ({ page }) => {
  test.setTimeout(120000);
  await bootSolo(page);
  await growPast(page, 9.95);
  const scoreAtTrigger = await page.evaluate(() => window.__game.state.score);
  await page.evaluate(() => window.__game.debug.advance(8)); // Ceremony total is 6.5 game-seconds
  expect(await page.evaluate(() => window.__game.state.gameActive)).toBe(false);
  expect(await page.evaluate(() => window.__game.state.players[0].ascended)).toBe(true);
  // The end screen arrives after the cinematic beat (wall setTimeout in ui.js).
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#death-title')).toHaveText('ASCENDED!');
  await expect(page.locator('#death-reason')).toContainText('beyond this world');
  expect(await page.evaluate(() => window.__game.state.score)).toBe(scoreAtTrigger + 500);
  const topRow = await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('blocky.hiscores.endless.v1') || '[]');
    return rows[0] || null;
  });
  expect(topRow).not.toBeNull();
  expect(topRow.asc).toBe(true);
  // The board renders the mark.
  await expect(page.locator('#hiscore-slot .hiscore-list li').first()).toContainText('✦');
});

test('a death after an ascension restores the exact GAME OVER title (the invariant)', async ({ page }) => {
  test.setTimeout(150000);
  await bootSolo(page);
  await growPast(page, 9.95);
  await page.evaluate(() => window.__game.debug.advance(8));
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#death-title')).toHaveText('ASCENDED!');
  // Restart, then die normally: the title must be exactly GAME OVER again.
  await page.locator('#restart-button').click();
  await expect(page.locator('#start-overlay')).toBeVisible();
  await startGame(page);
  await page.evaluate(() => window.__game.debug.advance(16)); // Collect clock expires
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#death-title')).toHaveText('GAME OVER');
});

test('2P: P2 ascends mid-run — the partner plays on under an ASCENDED chip; the team end is crowned', async ({ page }) => {
  test.setTimeout(150000);
  await openGame(page);
  await page.evaluate(() => window.__game.debug.startTwoPlayer());
  await startGame(page);
  await expect(page.locator('#coop-hud')).toBeVisible();
  // Grow P2 past the threshold with a real collect at THEIR feet.
  await page.evaluate(() => {
    const g = window.__game;
    g.state.players[1].scale = 9.95;
    g.state.players[1].mesh.scale.set(9.95, 9.95, 9.95); // Render mirror (see growPast)
    const p = g.state.players[1].mesh.position;
    g.debug.spawnAtPosition({ x: p.x, y: 0, z: p.z });
  });
  await page.evaluate(() => window.__game.debug.advance(0.5));
  await expect.poll(() => page.evaluate(() => window.__game.state.players[1].scale))
    .toBeGreaterThanOrEqual(10);
  await expect.poll(() => seatInfo(page, 1).then((s) => s.active)).toBe(true);
  // Keep P1 alive through the ceremony: fed (their clock keeps running —
  // only the ascending hero's freezes) and unhunted (P1 stands still at
  // scale 1 while giants roam — partner survival is not what this asserts).
  await clearThreats(page);
  await page.evaluate(() => { window.__game.state.players[0].collectTimeLeft = 60; });
  await page.evaluate(() => window.__game.debug.advance(8));
  // Settled: P2 is done (a winner, not a casualty); the run continues.
  expect(await page.evaluate(() => window.__game.state.gameActive)).toBe(true);
  const p2 = await page.evaluate(() => ({
    alive: window.__game.state.players[1].alive,
    ascended: window.__game.state.players[1].ascended
  }));
  expect(p2.alive).toBe(false);
  expect(p2.ascended).toBe(true);
  await expect(page.locator('.waiting-chip[data-seat="1"]')).toBeVisible();
  await expect(page.locator('.waiting-chip[data-seat="1"]')).toContainText('ASCENDED');
  // P1's clock runs out: the team end shows, crowned, with the coop mark.
  // No debug.advance here — 0.05 game-seconds elapse on live frames before
  // another evaluate could even land (advance would race the run's end).
  await page.evaluate(() => { window.__game.state.players[0].collectTimeLeft = 0.05; });
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#death-title')).toHaveText('ASCENDED!');
  const coopRow = await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('blocky.hiscores.coop.v1') || '[]');
    return rows[0] || null;
  });
  expect(coopRow).not.toBeNull();
  expect(coopRow.ascCount).toBe(1);
});

test('pause freezes the ceremony mid-rise; resume continues it', async ({ page }) => {
  test.setTimeout(120000);
  await bootSolo(page);
  await growPast(page, 9.95);
  await page.evaluate(() => window.__game.debug.advance(1));
  await page.locator('#pause-button').click();
  const riseA = await seatInfo(page).then((s) => s.rise);
  await settleFrames(page, 5); // Wall frames flow; the game clock must not
  const riseB = await seatInfo(page).then((s) => s.rise);
  expect(riseB).toBe(riseA);
  await page.locator('#pause-button').click(); // Resume
  await waitGameSeconds(page, 0.5); // The live loop carries the ceremony again
  const riseC = await seatInfo(page).then((s) => s.rise);
  expect(riseC).toBeGreaterThan(riseB);
});

test('ceremony GPU resources plateau: a second crowned run allocates nothing new', async ({ page }) => {
  test.setTimeout(150000);
  await bootSolo(page);
  await growPast(page, 9.95);
  await page.evaluate(() => window.__game.debug.advance(8));
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 20000 });
  await settleFrames(page, 3); // Let the renderer register everything once
  const first = await page.evaluate(() => window.__game.debug.perfInfo());
  await page.locator('#restart-button').click();
  await expect(page.locator('#start-overlay')).toBeVisible();
  await startGame(page);
  await growPast(page, 9.95);
  await page.evaluate(() => window.__game.debug.advance(8));
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 20000 });
  await settleFrames(page, 3);
  const second = await page.evaluate(() => window.__game.debug.perfInfo());
  // ±1 tolerance: the terrain chunk pool can grow by one mesh across runs
  // (build/release timing under load) — unrelated to the ceremony. A real
  // halo/beam rebuild would register +2 geometries per run and still fail.
  expect(second.geometries).toBeLessThanOrEqual(first.geometries + 1);
  expect(second.textures).toBe(first.textures);
});
