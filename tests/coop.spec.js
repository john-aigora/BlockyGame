import { test, expect } from '@playwright/test';
import { openGame, installMockPads, waitGameSeconds, waitForGameOver, hudFor } from './helpers.js';

// Two-player split-screen (plan 026). The roster flips via
// debug.startTwoPlayer() on the start overlay (the Stage F entry buttons
// land on the same setPlayerCount path), then the run starts through the
// real START button. All waits ride the game clock (state.runTime).

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
});

async function startTwoPlayerGame(page) {
  await page.evaluate(() => window.__game.debug.startTwoPlayer());
  await page.waitForFunction(() => window.__game.state.players.length === 2 &&
    window.__game.state.players.every((p) => p.mesh && p.camera));
  await page.locator('#start-button').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
}

// Choreography death-proofing (same pattern as the effects pool spec): the
// cases below measure INPUT ROUTING, not survival — despawn every body,
// clear the warn pipeline, and fatten both collect clocks.
async function clearThreats(page) {
  await page.evaluate(() => {
    const s = window.__game.state;
    s.enemies.forEach((e) => s.scene.remove(e));
    s.enemies = [];
    window.__game.debug.clearPendingSpawns();
    s.players.forEach((p) => { p.collectTimeLeft = 900; });
  });
}

function positions(page) {
  return page.evaluate(() => window.__game.state.players.map((p) => ({
    x: p.mesh.position.x,
    z: p.mesh.position.z
  })));
}

test('two mock pads claim seats and drive the two players apart', async ({ page }) => {
  await installMockPads(page, [{ id: 'Pad One' }, { id: 'Pad Two', index: 1 }]);
  await startTwoPlayerGame(page);
  await clearThreats(page);
  const start = await positions(page);

  // Real directional input claims seats in arrival order: pad 0 → P1,
  // pad 1 → P2. Commanded apart: P1 full east, P2 full west.
  await page.evaluate(() => {
    window.__mockPads.setAxis(0, 1, 0);
    window.__mockPads.setAxis(1, -1, 0);
  });
  await waitGameSeconds(page, 1.2);
  await page.evaluate(() => {
    window.__mockPads.setAxis(0, 0, 0);
    window.__mockPads.setAxis(1, 0, 0);
  });

  expect(await page.evaluate(() => window.__game.debug.seatInfo().claims)).toEqual([0, 1]);
  const end = await positions(page);
  expect(end[0].x - start[0].x).toBeGreaterThan(2); // P1 marched east...
  expect(end[1].x - start[1].x).toBeLessThan(-2); // ...P2 west — independent seats
});

test('one keyboard drives both: WASD moves P1 east while Arrows move P2 west', async ({ page }) => {
  await startTwoPlayerGame(page);
  await clearThreats(page);
  const start = await positions(page);

  await page.keyboard.down('d'); // Seat 0's half
  await page.keyboard.down('ArrowLeft'); // Seat 1's half
  await waitGameSeconds(page, 1.2);
  await page.keyboard.up('d');
  await page.keyboard.up('ArrowLeft');

  const end = await positions(page);
  expect(end[0].x - start[0].x).toBeGreaterThan(2); // WASD drove P1 only
  expect(end[1].x - start[1].x).toBeLessThan(-2); // Arrows drove P2 only
});

test('keyboard-active P1 sends the first live pad to seat 2; idle ghosts never claim', async ({ page }) => {
  await installMockPads(page, [{ id: 'Ghost DB9' }, { id: 'Live DB9', index: 1 }]);
  await startTwoPlayerGame(page);
  await clearThreats(page);

  // P1 plays on WASD first — their keyboard half is live this run.
  await page.keyboard.down('w');
  await waitGameSeconds(page, 0.3);
  await page.keyboard.up('w');

  // The idle ghost interface (dual-port DB9 adapters) must claim nothing.
  expect(await page.evaluate(() => window.__game.debug.seatInfo().claims)).toEqual([null, null]);

  // The pad that produces REAL input claims the OTHER seat — the keyboard
  // player keeps their hero (battle-paddle rule) — and drives P2 north.
  const start = await positions(page);
  await page.evaluate(() => window.__mockPads.setAxis(1, 0, -1));
  await waitGameSeconds(page, 0.8);
  await page.evaluate(() => window.__mockPads.setAxis(1, 0, 0));

  expect(await page.evaluate(() => window.__game.debug.seatInfo().claims)).toEqual([null, 1]);
  const end = await positions(page);
  expect(end[1].z - start[1].z).toBeLessThan(-1); // P2 walked north (stick up)
  expect(Math.abs(end[0].x - start[0].x)).toBeLessThan(0.5); // P1 untouched by the pad
});

test('jump keys split per seat: Space hops P1, Slash hops P2', async ({ page }) => {
  await startTwoPlayerGame(page);
  await clearThreats(page);

  await page.keyboard.press('Space');
  let air = await page.evaluate(() => window.__game.state.players.map((p) => p.jump.airborne));
  expect(air[0]).toBe(true); // P1 took off...
  expect(air[1]).toBe(false); // ...P2 stayed grounded

  // Land, then the mirror: Slash lifts only P2.
  await page.waitForFunction(() => !window.__game.state.players[0].jump.airborne, null, { timeout: 30000 });
  await page.keyboard.press('/');
  air = await page.evaluate(() => window.__game.state.players.map((p) => p.jump.airborne));
  expect(air[0]).toBe(false);
  expect(air[1]).toBe(true);
});

test('terrain and food stream around BOTH heroes 600u apart (union window)', async ({ page }) => {
  test.setTimeout(90000);
  await startTwoPlayerGame(page);
  await clearThreats(page);
  await page.evaluate(() => {
    const s = window.__game.state;
    s.players[0].mesh.position.x = 300; // P1 east...
    s.players[1].mesh.position.x = -300; // ...P2 west — disjoint windows
  });
  // The union window builds out around both anchors (2 chunks/frame).
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 60000 });
  const info = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    const chunkOf = (p) => `${Math.floor((p.mesh.position.x + s.worldOrigin.x) / 32)},${Math.floor((p.mesh.position.z + s.worldOrigin.z) / 32)}`;
    const foodNear = (p) => s.collectibles.filter((c) =>
      Math.hypot(c.position.x - p.mesh.position.x, c.position.z - p.mesh.position.z) < 60).length;
    return {
      keys: g.debug.terrainInfo().activeKeys,
      activeChunks: g.debug.terrainInfo().activeChunks,
      p1Chunk: chunkOf(s.players[0]),
      p2Chunk: chunkOf(s.players[1]),
      p1Food: foodNear(s.players[0]),
      p2Food: foodNear(s.players[1]),
      alive: s.players.map((p) => p.alive)
    };
  });
  expect(info.alive).toEqual([true, true]); // The wait ended with both standing
  expect(info.keys).toContain(info.p1Chunk); // Ground under P1's feet...
  expect(info.keys).toContain(info.p2Chunk); // ...AND under P2's, 600u away
  expect(info.p1Food).toBeGreaterThan(0); // Seeded chunk food grew near both
  expect(info.p2Food).toBeGreaterThan(0);
  expect(info.activeChunks).toBeGreaterThanOrEqual(90); // Two nearly-disjoint 7x7+ windows
});

test('rebase fires on the players\' midpoint and shifts both by the SAME delta', async ({ page }) => {
  await startTwoPlayerGame(page);
  await clearThreats(page);
  const before = await page.evaluate(() => {
    const s = window.__game.state;
    s.players[0].mesh.position.x = 2400; // Midpoint (2400+1800)/2 = 2100 > 2048
    s.players[1].mesh.position.x = 1800;
    return { origin: s.worldOrigin.x };
  });
  expect(before.origin).toBe(0);
  await waitGameSeconds(page, 0.3); // The next update frame rebases
  const after = await page.evaluate(() => {
    const s = window.__game.state;
    return {
      origin: s.worldOrigin.x,
      p1x: s.players[0].mesh.position.x,
      p2x: s.players[1].mesh.position.x,
      furthest: s.furthestDistance
    };
  });
  expect(after.origin).toBe(2112); // round(2100/32)*32 — one shared shift
  // Both heroes moved by exactly that delta (the world-integrity STOP probe):
  expect(after.p1x).toBeCloseTo(2400 - 2112, 5);
  expect(after.p2x).toBeCloseTo(1800 - 2112, 5);
  // True positions (local + origin) — and so the distance record — undented.
  expect(after.furthest).toBeGreaterThanOrEqual(2399);
  expect(after.furthest).toBeLessThan(2500);
});

test('2P HUD: per-seat columns replace the solo row and track their own runs', async ({ page }) => {
  await startTwoPlayerGame(page);
  await clearThreats(page);
  await expect(page.locator('#coop-hud')).toBeVisible();
  await expect(page.locator('#score-display')).toBeHidden(); // The solo row yields...
  await expect(page.locator('#collect-timer-display')).toBeHidden();
  await expect(page.locator('#distance-display')).toBeHidden();
  await expect(page.locator('#time-display')).toBeVisible(); // ...the shared clock stays
  const p1Hud = hudFor(page, 0);
  const p2Hud = hudFor(page, 1);
  await expect(p1Hud.score).toHaveText('0');
  await expect(p2Hud.score).toHaveText('0');

  // P2 eats (teleport onto their nearest food): THEIR column pays, P1's
  // stays put — score attribution is per seat.
  await page.evaluate(() => {
    const s = window.__game.state;
    const p = s.players[1].mesh.position;
    let best = null;
    let bd = Infinity;
    for (const c of s.collectibles) {
      const d = Math.hypot(c.position.x - p.x, c.position.z - p.z);
      if (d < bd) { bd = d; best = c; }
    }
    p.x = best.position.x;
    p.z = best.position.z;
  });
  await expect(p2Hud.score).not.toHaveText('0', { timeout: 30000 });
  await expect(p1Hud.score).toHaveText('0');

  // Back to solo: the classic id row returns, the columns retire.
  await page.locator('#restart-game-button').click();
  await expect(page.locator('#start-overlay')).toBeVisible();
  await page.evaluate(() => window.__game.debug.setPlayerCount(1));
  await expect(page.locator('#coop-hud')).toBeHidden();
  await expect(page.locator('#score-display')).toBeVisible();
});

test('per-player death: spectator chip while the partner plays, then the team death screen + coop board', async ({ page }) => {
  test.setTimeout(150000);
  await startTwoPlayerGame(page);
  await clearThreats(page);
  // Seed the SOLO ladders — a 2P run must never touch them (plan 026).
  await page.evaluate(() => {
    localStorage.setItem('blocky.hiscores.endless.v1',
      JSON.stringify([{ score: 11, distance: 22, date: '2026-01-01' }]));
  });
  // Tellable columns: different scores, and P2 carries the distance record.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.players[0].score = 3;
    s.players[1].score = 9;
    s.players[1].mesh.position.x = 40;
  });
  await waitGameSeconds(page, 0.3); // The distance frame registers 40u

  // P2's collect clock expires — THEIR death only: the run continues.
  await page.evaluate(() => { window.__game.state.players[1].collectTimeLeft = 0.05; });
  await page.waitForFunction(() => window.__game.state.players[1].alive === false, null, { timeout: 60000 });
  const mid = await page.evaluate(() => ({
    gameActive: window.__game.state.gameActive,
    p1Alive: window.__game.state.players[0].alive,
    messageBox: getComputedStyle(document.getElementById('message-box')).display,
    chip0: getComputedStyle(document.querySelector('.waiting-chip[data-seat="0"]')).display,
    chip1: getComputedStyle(document.querySelector('.waiting-chip[data-seat="1"]')).display
  }));
  expect(mid.gameActive).toBe(true); // P1 plays on
  expect(mid.p1Alive).toBe(true);
  expect(mid.messageBox).toBe('none'); // No death screen while one stands
  expect(mid.chip1).not.toBe('none'); // The fallen half waits...
  expect(mid.chip0).toBe('none'); // ...the living half doesn't

  // P1 falls too — NOW the run ends, with both columns on one screen.
  await page.evaluate(() => { window.__game.state.players[0].collectTimeLeft = 0.05; });
  await waitForGameOver(page);
  await expect(page.locator('#death-title')).toHaveText('GAME OVER');
  await expect(page.locator('#coop-final')).toBeVisible();
  await expect(page.locator('#coop-p1-score')).toHaveText('3');
  await expect(page.locator('#coop-p2-score')).toHaveText('9');
  await expect(page.locator('#coop-team-score')).toHaveText('12');
  await expect(page.locator('#hiscore-slot')).toContainText('TEAM RUNS');
  await expect(page.locator('#hiscore-slot')).toContainText('12 pts');

  const boards = await page.evaluate(() => ({
    coop: JSON.parse(localStorage.getItem('blocky.hiscores.coop.v1')),
    endless: JSON.parse(localStorage.getItem('blocky.hiscores.endless.v1')),
    daily: localStorage.getItem('blocky.hiscores.daily.v1'),
    classic: localStorage.getItem('blocky.hiscores.v1'),
    chip1: getComputedStyle(document.querySelector('.waiting-chip[data-seat="1"]')).display
  }));
  expect(boards.coop).toHaveLength(1); // The team run recorded...
  expect(boards.coop[0].p1Score).toBe(3);
  expect(boards.coop[0].p2Score).toBe(9);
  expect(boards.coop[0].teamScore).toBe(12);
  expect(boards.coop[0].maxDistance).toBeGreaterThanOrEqual(40);
  expect(boards.endless).toEqual([{ score: 11, distance: 22, date: '2026-01-01' }]); // ...solo ladders untouched
  expect(boards.daily).toBeNull();
  expect(boards.classic).toBeNull();
  expect(boards.chip1).toBe('none'); // The spectator chip died with the run
});

test('solo input is untouched: WASD and Arrows both drive the single hero', async ({ page }) => {
  // No startTwoPlayer — the classic merged keyboard must still hold.
  await page.locator('#start-button').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await clearThreats(page);
  const before = await page.evaluate(() => window.__game.state.player.position.x);
  await page.keyboard.down('ArrowRight');
  await waitGameSeconds(page, 0.6);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('d');
  await waitGameSeconds(page, 0.6);
  await page.keyboard.up('d');
  const after = await page.evaluate(() => window.__game.state.player.position.x);
  expect(after - before).toBeGreaterThan(3); // Both halves reached the one hero
});
