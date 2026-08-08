import { test, expect } from '@playwright/test';
import { bypassGate, startGame, waitGameSeconds, waitForGameOver } from './helpers.js';

// World identity & late game (plan 025): seeded worlds (?seed= / the DAILY
// world), the daily board, named biome regions, gold food, and the 1000u
// titan. Seeded determinism makes every case reproducible; waits ride the
// game clock (state.runTime) — never wall time.

// Per-test navigation (the cases differ by URL query), so no shared
// openGame beforeEach — just the pageerror trap.
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
});

async function openWorld(page, query = '') {
  await bypassGate(page);
  await page.goto('/' + query);
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
}

// The local YYYYMMDD the page's own clock resolves for the daily world —
// computed in-page so a midnight-crossing runner and the game always agree.
function pageDailySeed(page) {
  return page.evaluate(() => {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  });
}

test('?seed= drives the world: same seed reproduces terrain, another seed changes it', async ({ page }) => {
  await openWorld(page, '?seed=123');
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: 123, daily: false });
  await expect(page.locator('#seed-line')).toHaveText('SEED 123');
  const sample = () => page.evaluate(() =>
    [[10, 10], [123.4, -567.8], [-3210.7, 77.7]].map(([x, z]) => window.__game.debug.terrainHeight(x, z)));
  const first = await sample();

  // Reload, same seed: bit-identical heights.
  await page.reload();
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await sample()).toEqual(first);

  // A different seed is a different world.
  await page.goto('/?seed=124');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: 124, daily: false });
  const other = await sample();
  expect(other).not.toEqual(first);
});

test("TODAY'S WORLD toggle flips the daily seed on and off across its reload", async ({ page }) => {
  await openWorld(page);
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: 20260726, daily: false });
  await expect(page.locator('#daily-toggle')).not.toHaveClass(/mode-selected/);

  // ON: the click persists the flag and reloads; the seed becomes today's
  // local YYYYMMDD. evaluate() may race the navigation — poll through it.
  await page.locator('#daily-toggle').click();
  await expect.poll(
    () => page.evaluate(() => window.__game?.debug?.worldSeedInfo?.().daily).catch(() => null),
    { timeout: 30000 }
  ).toBe(true);
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  const daily = await pageDailySeed(page);
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: daily, daily: true });
  await expect(page.locator('#seed-line')).toHaveText(`SEED ${daily} · DAILY`);
  await expect(page.locator('#daily-toggle')).toHaveClass(/mode-selected/);
  // The toggle press must NOT have started a run (the overlay's own
  // pointerdown starts runs; the button stops propagation).
  await expect(page.locator('#start-overlay')).toBeVisible();

  // OFF: back to the default world.
  await page.locator('#daily-toggle').click();
  await expect.poll(
    () => page.evaluate(() => window.__game?.debug?.worldSeedInfo?.().daily).catch(() => null),
    { timeout: 30000 }
  ).toBe(false);
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: 20260726, daily: false });
  await expect(page.locator('#seed-line')).toHaveText('SEED 20260726');
});

test("a daily death records BOTH boards, shows TODAY'S BEST, and prunes stale seeds", async ({ page }) => {
  await bypassGate(page);
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('blocky.daily', '1');
      // A stale-world row (another day's seed): must neither render nor
      // survive the next write — pruned on read.
      localStorage.setItem('blocky.hiscores.daily.v1', JSON.stringify([
        { score: 99, distance: 9999, seed: 20200101, date: '2020-01-01' }
      ]));
      localStorage.removeItem('blocky.hiscores.endless.v1');
    } catch { /* storage unavailable — the assertions below would fail loudly */ }
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo().daily)).toBe(true);

  await startGame(page);
  // End the run immediately: the collect clock is the fastest legal death.
  await page.evaluate(() => { window.__game.state.collectTimeLeft = 0.05; });
  await waitForGameOver(page);

  const boards = await page.evaluate(() => ({
    daily: JSON.parse(localStorage.getItem('blocky.hiscores.daily.v1')),
    endless: JSON.parse(localStorage.getItem('blocky.hiscores.endless.v1'))
  }));
  const daily = await pageDailySeed(page);
  expect(boards.endless).toHaveLength(1); // A daily run is an endless run too
  expect(boards.daily).toHaveLength(1); // The stale 20200101 row was pruned by the record's read
  expect(boards.daily[0].seed).toBe(daily);
  expect(boards.daily[0].score).toBe(boards.endless[0].score);

  await expect(page.locator('#hiscore-slot')).toContainText("TODAY'S BEST");
  await expect(page.locator('#hiscore-slot')).not.toContainText('9999'); // Stale row never renders
});

test('crossing into a new region fires DISCOVERED and the death screen counts REGIONS', async ({ page }) => {
  await openWorld(page);
  // Region identity is deterministic pure math in TRUE coords.
  const region = await page.evaluate(() => ({
    home: window.__game.debug.biomeRegion(0, 0),
    again: window.__game.debug.biomeRegion(0, 0),
    far: window.__game.debug.biomeRegion(400, 0),
    // H13 (plan 028 batch): the per-frame identity path must agree with the
    // full display object byte-for-byte — a fork between them would let a
    // hero "re-discover" (or never re-enter) a region the visited set
    // already knows under the other spelling.
    homeKey: window.__game.debug.biomeRegionKey(0, 0),
    farKey: window.__game.debug.biomeRegionKey(400, 0)
  }));
  expect(region.again).toEqual(region.home);
  expect(region.far.key).not.toBe(region.home.key); // 400u crosses the 300u cell grid
  expect(region.far.name).toMatch(/^[A-Z' ]+$/);
  expect(region.homeKey).toBe(region.home.key); // Hot path === display path (H13)
  expect(region.farKey).toBe(region.far.key);

  await startGame(page);
  expect(await page.evaluate(() => window.__game.state.regionsVisited.size)).toBe(1); // Spawn region pre-seeded, no banner
  // Teleport 400u out: a different region cell for certain. The candidate
  // must HOLD for the 1.5 game-second debounce before the banner fires
  // (the idle player stays put, so it does).
  await page.evaluate(() => {
    const s = window.__game.state;
    s.collectTimeLeft = 90; // The idle wait must not starve the run
    s.player.position.x = 400;
  });
  await expect.poll(
    () => page.evaluate(() => window.__game.debug.effectsInfo().lastPopupText),
    { timeout: 60000 }
  ).toMatch(/^DISCOVERED: [A-Z' ]+$/);
  const seen = await page.evaluate(() => ({
    count: window.__game.state.regionsVisited.size,
    popup: window.__game.debug.effectsInfo().lastPopupText,
    name: window.__game.debug.biomeRegion(400 + window.__game.state.worldOrigin.x, 0).name
  }));
  expect(seen.count).toBe(2);
  expect(seen.popup).toBe(`DISCOVERED: ${seen.name}`); // The banner names the region under the player

  // Wandering home is a RE-entry — no second discovery of a known place.
  await page.evaluate(() => { window.__game.state.player.position.x = 0; });
  await waitGameSeconds(page, 2.5);
  expect(await page.evaluate(() => window.__game.state.regionsVisited.size)).toBe(2);

  // The death screen's distance line carries the REGIONS stat.
  await page.evaluate(() => { window.__game.state.collectTimeLeft = 0.05; });
  await waitForGameOver(page);
  await expect(page.locator('#final-distance-line')).toContainText('REGIONS 2');
});

test('gold food: seeded scatter grows it; collecting pays +5 with the gold beat', async ({ page }) => {
  await openWorld(page);
  // Production path: the DEFAULT world's boot window (49 chunks) grows gold
  // deterministically — live-probed fixture at seed 20260726: 3 gold blocks,
  // nearest (23.5, 5.6) in the synchronously-built inner ring. A changed
  // default seed re-fixtures this test (re-probe via state.collectibles).
  await page.waitForFunction(() => window.__game.debug.terrainInfo().activeChunks >= 49, null, { timeout: 30000 });
  const gold = await page.evaluate(() =>
    window.__game.state.collectibles
      .filter((c) => c.userData.gold === true)
      .map((c) => ({ x: c.position.x, z: c.position.z })));
  expect(gold.length).toBeGreaterThanOrEqual(1);
  const nearest = gold.reduce((a, b) => (Math.hypot(a.x, a.z) <= Math.hypot(b.x, b.z) ? a : b));
  expect(Math.hypot(nearest.x, nearest.z)).toBeLessThan(40); // Reachable fixture, not a horizon rumor

  await startGame(page);
  const before = await page.evaluate((n) => {
    const s = window.__game.state;
    s.collectTimeLeft = 5; // A LOW clock proves the gold collect fully resets it
    s.player.position.x = n.x; // Teleport ONTO the gold block — collected next frame
    s.player.position.z = n.z;
    return { score: s.score, count: s.collectibles.length };
  }, nearest);
  await expect.poll(
    () => page.evaluate(() => window.__game.debug.effectsInfo().lastPopupText),
    { timeout: 30000 }
  ).toBe('+5 GOLD!');
  const after = await page.evaluate(() => ({
    score: window.__game.state.score,
    clock: window.__game.state.collectTimeLeft,
    goldLeft: window.__game.state.collectibles.filter((c) => c.userData.gold === true).length
  }));
  // >= not ===: the teleport may sweep an adjacent normal block in the same
  // frame (+1); the popup above already pins that the GOLD branch paid.
  expect(after.score - before.score).toBeGreaterThanOrEqual(5);
  expect(after.clock).toBeGreaterThan(10); // Full reset toward 15, same as normal food
  expect(after.goldLeft).toBe(gold.length - 1); // The prize is gone — collected, not respawned
});

test('1000u titan: long warn + dread banner, despawn immunity, and a restart clears it', async ({ page }) => {
  test.setTimeout(120000);
  await openWorld(page);
  await startGame(page);
  // Cross the mark through the REAL trigger path: a progress frame at 1005u.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.collectTimeLeft = 900;
    s.player.position.x = 1005;
  });
  await expect.poll(
    () => page.evaluate(() => window.__game.debug.pendingSpawnInfo().some((p) => p.boss)),
    { timeout: 30000 }
  ).toBe(true);
  const warn = await page.evaluate(() => ({
    entry: window.__game.debug.pendingSpawnInfo().find((p) => p.boss),
    popup: window.__game.debug.effectsInfo().lastPopupText
  }));
  expect(warn.popup).toBe('SOMETHING BIG COMES...'); // Headline over the same-frame DISTANCE chime
  expect(warn.entry.warnTime).toBeCloseTo(0.95 * 2, 5); // 2x the (1x-speed) warn — dread takes time
  // Boss size = the live giant formula x 1.6: ramp level 6 at 1005u →
  // (1.0 x 1.5 x 2.2 / 1.2) x 1.6 = 4.4.
  expect(warn.entry.scaleFactor).toBeCloseTo(4.4, 2);
  expect(warn.entry.species).toBe('grunt');

  // Wait out warn + materialize; the titan arrives INEDIBLE, crown gold.
  await expect.poll(
    () => page.evaluate(() => window.__game.state.enemies.some(
      (e) => e.userData.boss && e.userData.materializing === undefined)),
    { timeout: 60000 }
  ).toBe(true);
  const arrived = await page.evaluate(() => {
    const boss = window.__game.state.enemies.find((e) => e.userData.boss);
    return {
      killable: window.__game.state.playerScale * 1.0 > 1.2 * boss.scale.y,
      capHex: boss.userData.capMaterial.color.getHex()
    };
  });
  expect(arrived.killable).toBe(false); // No edibility bypass — it towers, you grow
  expect(arrived.capHex).toBe(0xFFD700);

  // Despawn immunity: flee 150u — every normal enemy streams out past 80u,
  // the titan keeps marching. And no SECOND titan arms (flag consumed).
  await page.evaluate(() => { window.__game.state.player.position.x += 150; });
  await waitGameSeconds(page, 1.5);
  const fled = await page.evaluate(() => {
    const s = window.__game.state;
    const boss = s.enemies.find((e) => e.userData.boss);
    return {
      bossAlive: !!boss,
      bossDist: boss ? Math.hypot(boss.position.x - s.player.position.x, boss.position.z - s.player.position.z) : 0,
      pendingBoss: window.__game.debug.pendingSpawnInfo().filter((p) => p.boss).length,
      flag: s.bossSpawned
    };
  });
  expect(fled.bossAlive).toBe(true);
  expect(fled.bossDist).toBeGreaterThan(80); // Beyond the radius every other enemy despawns at
  expect(fled.pendingBoss).toBe(0);
  expect(fled.flag).toBe(true);

  // STOP-condition check (plan 025): a mid-run restart must clear the
  // exempt titan — setupNewGame disposes it with the rest of the roster.
  await page.locator('#restart-game-button').click();
  await expect(page.locator('#start-overlay')).toBeVisible();
  const cleared = await page.evaluate(() => ({
    bosses: window.__game.state.enemies.filter((e) => e.userData.boss).length,
    pendingBoss: window.__game.debug.pendingSpawnInfo().filter((p) => p.boss).length,
    flag: window.__game.state.bossSpawned
  }));
  expect(cleared).toEqual({ bosses: 0, pendingBoss: 0, flag: false });
});

test('titan kill: 3x payout, the 10-food feast ring, TITAN DOWN!, and no second titan', async ({ page }) => {
  test.setTimeout(150000);
  await openWorld(page);
  await startGame(page);
  await page.evaluate(() => {
    const s = window.__game.state;
    s.collectTimeLeft = 900;
    s.player.position.x = 1005;
  });
  await expect.poll(
    () => page.evaluate(() => window.__game.state.enemies.some(
      (e) => e.userData.boss && e.userData.materializing === undefined)),
    { timeout: 60000 }
  ).toBe(true);

  // Come home to the spawn mesa (dry, rock-cleared) and let the streaming
  // window fully settle so the food count is a stable baseline.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.collectTimeLeft = 900;
    s.player.position.x = 0;
    s.player.position.z = 0;
  });
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  await waitGameSeconds(page, 0.5);

  // Atomic kill setup (one evaluate — no frame races): bystanders shipped
  // out (they despawn unpaid), the titan placed at +5u — inside the
  // gameplay contact reach (player half 3.12 + boss half 2.64 = 5.76u) but
  // far enough that the feast ring (radius <= 3.1 around the fall) lands
  // beyond ANY pickup-box reach. The player is made TALL in gameplay terms
  // only — playerScale drives edibility and the enemy-contact box, while
  // the pickup box reads the RENDER scale (plan-026/H6: the body-block
  // builder with scale = mesh.scale.y — the render/gameplay split is
  // deliberate and this test depends on it; unifying pickup onto the
  // GAMEPLAY scale is geometrically incompatible with this choreography:
  // contact reach 5.76u < the 6.67u the ring would need to clear a
  // 3.12u-half pickup box, and the kill and the collect sweep share one
  // update() frame, so no post-kill shrink can interleave) — so the winner
  // cannot gulp its own feast and all 10 pieces are countable. (Historical:
  // at an 0.9u offset the OLD render-tree setFromObject raced — a
  // min-radius ring roll could graze the scarf-side render box, one bite
  // synced the render scale via the collect path and the giant hoovered
  // all 10. The body-block builder has no scarf; +5u stays for margin.)
  const before = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    const boss = s.enemies.find((e) => e.userData.boss);
    for (const e of s.enemies) {
      if (!e.userData.boss) { e.position.x = s.player.position.x + 500; }
    }
    boss.position.set(5, g.debug.groundHeightAt(5, 0), 0);
    s.playerScale = 1.2 * boss.scale.y + 0.5; // Taller than the titan — killable
    s.collectTimeLeft = 900;
    return {
      score: s.score,
      combo: s.comboCount,
      food: s.collectibles.length,
      bossScaleY: boss.scale.y
    };
  });
  expect(before.combo).toBe(0); // Fresh chain: the payout below is combo x1

  await expect.poll(
    () => page.evaluate(() => window.__game.state.enemies.some((e) => e.userData.boss)),
    { timeout: 30000 }
  ).toBe(false);
  const after = await page.evaluate(() => ({
    score: window.__game.state.score,
    food: window.__game.state.collectibles.length,
    popup: window.__game.debug.effectsInfo().lastPopupText,
    flag: window.__game.state.bossSpawned
  }));
  // Payout = (KILL_POINTS 25 + 5 x floor(1.2 x scaleY)) x combo 1 x BOSS 3.
  const bounty = 25 + 5 * Math.floor(1.2 * before.bossScaleY);
  expect(after.score - before.score).toBeGreaterThanOrEqual(3 * bounty);
  expect(after.score - before.score).toBeLessThanOrEqual(3 * bounty + 2); // Headroom only for a stray crumb
  expect(after.food - before.food).toBe(10); // The feast ring, intact on the mesa
  expect(after.popup).toBe('TITAN DOWN!');
  expect(after.flag).toBe(true);

  // Further distance never wakes a second titan this run.
  await page.evaluate(() => { window.__game.state.player.position.x = 1300; });
  await waitGameSeconds(page, 1);
  const again = await page.evaluate(() => ({
    bosses: window.__game.state.enemies.filter((e) => e.userData.boss).length,
    pendingBoss: window.__game.debug.pendingSpawnInfo().filter((p) => p.boss).length
  }));
  expect(again).toEqual({ bosses: 0, pendingBoss: 0 });
});

test('?daily=1 resolves the daily seed without the toggle', async ({ page }) => {
  await openWorld(page, '?daily=1');
  const daily = await pageDailySeed(page);
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: daily, daily: true });
  // ?seed= outranks the daily flag: an explicit world is never re-seeded.
  await page.goto('/?seed=55&daily=1');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__game.debug.worldSeedInfo())).toEqual({ seed: 55, daily: false });
});
