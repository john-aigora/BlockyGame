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
  // Water plane scales to the union footprint (Fugu P1): each hero at
  // ±300 from midpoint must sit inside waterHalf (base 280 left a dry gap).
  await page.evaluate(() => window.__game.debug.advance(0.1)); // One water update
  const water = await page.evaluate(() => {
    const t = window.__game.debug.terrainInfo();
    const s = window.__game.state;
    const midX = (s.players[0].mesh.position.x + s.players[1].mesh.position.x) / 2;
    const reach = Math.max(
      Math.abs(s.players[0].mesh.position.x - midX),
      Math.abs(s.players[1].mesh.position.x - midX));
    return { waterHalf: t.waterHalf, waterScale: t.waterScale, reach };
  });
  expect(water.waterScale).toBeGreaterThan(1);
  expect(water.waterHalf).toBeGreaterThan(water.reach + 50); // Margin past each hero
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

test('start-overlay entry: 2 PLAYERS flips and persists across reload; 1 PLAYER returns', async ({ page }) => {
  await expect(page.locator('#one-player-button')).toHaveClass(/mode-selected/);
  await page.locator('#two-player-button').click();
  await expect(page.locator('#two-player-button')).toHaveClass(/mode-selected/);
  await expect(page.locator('#start-overlay')).toBeVisible(); // The press must NOT start a run
  expect(await page.evaluate(() => window.__game.state.players.length)).toBe(2);
  expect(await page.evaluate(() => sessionStorage.getItem('blocky.playerCount'))).toBe('2');

  // A reload comes back in the remembered mode.
  await page.reload();
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__game.state.players.length)).toBe(2);
  await expect(page.locator('#two-player-button')).toHaveClass(/mode-selected/);

  // START launches the split run with both heroes standing.
  await page.locator('#start-button').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.__game.state.players.map((p) => !!p.mesh && p.alive)))
    .toEqual([true, true]);

  // Restart to the overlay; 1 PLAYER restores the solo roster.
  await page.locator('#restart-game-button').click();
  await expect(page.locator('#start-overlay')).toBeVisible();
  await page.locator('#one-player-button').click();
  await expect(page.locator('#one-player-button')).toHaveClass(/mode-selected/);
  expect(await page.evaluate(() => window.__game.state.players.length)).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('blocky.playerCount'))).toBe('1');
});

test('2 PLAYERS and TODAY\'S WORLD are mutually exclusive (coop has no daily board)', async ({ page }) => {
  // Turning daily on while 2P is remembered forces solo so the death screen
  // can show TODAY'S BEST (coop only writes TEAM RUNS).
  await page.locator('#two-player-button').click();
  expect(await page.evaluate(() => window.__game.state.players.length)).toBe(2);
  await page.locator('#daily-toggle').click();
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await page.evaluate(() => ({
    daily: window.__game.debug.worldSeedInfo().daily,
    players: window.__game.state.players.length,
    playerCount: sessionStorage.getItem('blocky.playerCount'),
    dailyFlag: sessionStorage.getItem('blocky.daily'),
  }))).toEqual({ daily: true, players: 1, playerCount: '1', dailyFlag: '1' });

  // Picking 2P while daily is on clears daily and reloads as coop.
  await page.locator('#two-player-button').click();
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
  expect(await page.evaluate(() => ({
    daily: window.__game.debug.worldSeedInfo().daily,
    players: window.__game.state.players.length,
    playerCount: sessionStorage.getItem('blocky.playerCount'),
    dailyFlag: sessionStorage.getItem('blocky.daily'),
  }))).toEqual({ daily: false, players: 2, playerCount: '2', dailyFlag: '0' });
});

test('live 2P widens the playfield so each half can match solo size', async ({ page }) => {
  // Title with 2P selected stays solo-width (single attract view). Starting
  // the run toggles coop-wide and roughly doubles the canvas max width.
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.locator('#two-player-button').click();
  const onTitle = await page.evaluate(() => {
    const box = document.getElementById('game-container');
    return {
      wide: box.classList.contains('coop-wide'),
      w: box.clientWidth,
      bodyWide: document.body.classList.contains('coop-wide'),
    };
  });
  expect(onTitle.wide).toBe(false);
  expect(onTitle.bodyWide).toBe(false);
  expect(onTitle.w).toBeLessThanOrEqual(800);

  await page.locator('#start-button').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
  const live = await page.evaluate(() => {
    const box = document.getElementById('game-container');
    const cams = window.__game.state.players.map((p) => p.camera?.aspect);
    return {
      wide: box.classList.contains('coop-wide'),
      w: box.clientWidth,
      h: box.clientHeight,
      bodyWide: document.body.classList.contains('coop-wide'),
      aspects: cams,
    };
  });
  expect(live.wide).toBe(true);
  expect(live.bodyWide).toBe(true);
  expect(live.w).toBeGreaterThan(1200); // Toward 2× solo (1600 max at this viewport)
  // Each half aspect ≈ (w/2)/h — close to a solo 800×h frame when wide.
  const halfAspect = (live.w / 2) / live.h;
  expect(live.aspects[0]).toBeCloseTo(halfAspect, 2);
  expect(live.aspects[1]).toBeCloseTo(halfAspect, 2);
});

test('each seat has its own speed multiplier (pad Y/X and debug seat arg)', async ({ page }) => {
  await startTwoPlayerGame(page);
  await clearThreats(page);
  // Defaults: both 1x (index 0). Speed P2 only.
  const stepped = await page.evaluate(() => {
    const g = window.__game;
    const ok = g.debug.speedUp(1);
    g.debug.applySpeedMultiplier();
    return {
      ok,
      i0: g.state.players[0].speedMultiplierIndex,
      i1: g.state.players[1].speedMultiplierIndex,
      s0: g.state.players[0].actualSpeed,
      s1: g.state.players[1].actualSpeed,
      label: document.getElementById('speed-cycle-button')?.textContent,
      // Solo-compat surface still tracks seat 0
      legacyIndex: g.state.currentSpeedMultiplierIndex,
    };
  });
  expect(stepped.ok).toBe(true);
  expect(stepped.i0).toBe(0);
  expect(stepped.i1).toBeGreaterThan(0);
  expect(stepped.s1).toBeGreaterThan(stepped.s0);
  expect(stepped.legacyIndex).toBe(0);
  expect(stepped.label).toMatch(/1x\s*\/\s*1\.5x/);

  // Seat 0 cycles without pulling seat 1 back down.
  const cycled = await page.evaluate(() => {
    const g = window.__game;
    g.debug.cycleSpeed(0);
    return {
      i0: g.state.players[0].speedMultiplierIndex,
      i1: g.state.players[1].speedMultiplierIndex,
      s0: g.state.players[0].actualSpeed,
      s1: g.state.players[1].actualSpeed,
    };
  });
  expect(cycled.i0).toBe(1);
  expect(cycled.i1).toBe(stepped.i1);
  expect(cycled.s0).toBeCloseTo(6 * 1.5, 5);
  expect(cycled.s1).toBeCloseTo(stepped.s1, 5);

  // Enemy mult uses max VALUE not max index ([1,1.5,2,3,5,0.5] — index 5 is 0.5x).
  const enemyMult = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    s.players[0].speedMultiplierIndex = 5; // 0.5x
    s.players[1].speedMultiplierIndex = 4; // 5.0x
    g.debug.applySpeedMultiplier();
    // BASE_ENEMY_SPEED 1.5 × 5 at 1x ramp, endless may apply ramp factor ≥1
    return {
      enemy: s.actualEnemySpeed,
      s0: s.players[0].actualSpeed,
      s1: s.players[1].actualSpeed,
    };
  });
  expect(enemyMult.s0).toBeCloseTo(6 * 0.5, 5);
  expect(enemyMult.s1).toBeCloseTo(6 * 5, 5);
  expect(enemyMult.enemy).toBeGreaterThanOrEqual(1.5 * 5 - 1e-6); // 5x wins over 0.5x
});

test('per-half danger vignette: a hunter stalking P2 reddens ONLY P2\'s half — and the CSS rule actually paints it', async ({ page }) => {
  await startTwoPlayerGame(page);
  await clearThreats(page);
  // Separate the heroes far beyond 2x DANGER_RADIUS (9), then park a giant
  // hunter 7u from P2 — inside P2's danger ring, 67u from P1. Bubble
  // top-ups land at >=35u (ENDLESS_SPAWN_MIN), so no ambient spawn can
  // leak danger onto P1 during the short window; at enemy speed 1.5u/s
  // the ~4u closing gap to contact buys several game-seconds of headroom.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.players[1].mesh.position.x = 60;
    window.__game.debug.spawnSpecies('grunt', 67, 0, 4); // Height 4.8 — pure hunter for either hero
  });
  await page.waitForFunction(() => window.__game.state.players[1].dangerOpacity > 0.15, null, { timeout: 30000 });
  const vig = await page.evaluate(() => {
    const read = (seat) => {
      const cs = getComputedStyle(document.querySelector(`.danger-vignette[data-seat="${seat}"]`));
      return {
        opacity: parseFloat(cs.opacity),
        display: cs.display,
        position: cs.position,
        background: cs.backgroundImage
      };
    };
    return { p1: read(0), p2: read(1) };
  });
  // P2's half glows — and is STYLED (B8 review BLOCK-1): the base vignette
  // rule must match the class-based coop element. A bare unstyled div would
  // still report the driven opacity while painting nothing, so the matched
  // rule itself (radial gradient + absolute frame position) is the assert.
  expect(vig.p2.opacity).toBeGreaterThan(0.05); // 0.15 base x breath >= 0.6
  expect(vig.p2.display).toBe('block');
  expect(vig.p2.position).toBe('absolute');
  expect(vig.p2.background).toContain('radial-gradient');
  // P1's half stays calm on the SAME styled rule.
  expect(vig.p1.opacity).toBeLessThan(0.02);
  expect(vig.p1.background).toContain('radial-gradient');
});

test('coop board: teamScore-desc ranking, maxDistance tiebreak, trimmed to top 5', async ({ page }) => {
  test.setTimeout(150000);
  await startTwoPlayerGame(page);
  await clearThreats(page);
  // Five seeded team runs. THREE runs will tie at teamScore 12 (two seeds +
  // the upcoming run) with divergent distances — only the maxDistance
  // tiebreak can order them. H14 (B8 review): the high-distance 12 is
  // stored AFTER the low-distance 12, so a stable sort WITHOUT the
  // tiebreak term keeps 15u above 999u and parks the new 40u run at the
  // bottom — deleting the tiebreak now fails three asserts below instead
  // of being masked by insertion order. The 5-pt row must fall off.
  await page.evaluate(() => {
    localStorage.setItem('blocky.hiscores.coop.v1', JSON.stringify([
      { p1Score: 25, p2Score: 25, teamScore: 50, maxDistance: 10, date: '2026-01-01' },
      { p1Score: 20, p2Score: 20, teamScore: 40, maxDistance: 10, date: '2026-01-02' },
      { p1Score: 6, p2Score: 6, teamScore: 12, maxDistance: 15, date: '2026-01-03' },
      { p1Score: 5, p2Score: 7, teamScore: 12, maxDistance: 999, date: '2026-01-04' },
      { p1Score: 3, p2Score: 2, teamScore: 5, maxDistance: 10, date: '2026-01-05' }
    ]));
  });
  // The mid-ranked run: team 3+9=12 at ~40u, then both clocks expire.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.players[0].score = 3;
    s.players[1].score = 9;
    s.players[1].mesh.position.x = 40;
  });
  await waitGameSeconds(page, 0.3); // The distance frame registers 40u
  await page.evaluate(() => {
    window.__game.state.players.forEach((p) => { p.collectTimeLeft = 0.05; });
  });
  await waitForGameOver(page);
  const board = await page.evaluate(() => JSON.parse(localStorage.getItem('blocky.hiscores.coop.v1')));
  expect(board).toHaveLength(5); // Trimmed: one of the six is gone...
  expect(board.some((e) => e.teamScore === 5)).toBe(false); // ...and it is the bottom row
  expect(board.map((e) => e.teamScore)).toEqual([50, 40, 12, 12, 12]); // teamScore desc
  expect(board[2].maxDistance).toBe(999); // The tiebreak PROMOTED the later-stored 999u row...
  expect(board[3].p1Score).toBe(3); // ...the new 12-pt/40u run sits in the middle...
  expect(board[3].p2Score).toBe(9);
  expect(board[3].maxDistance).toBeGreaterThanOrEqual(40);
  expect(board[3].maxDistance).toBeLessThan(999);
  expect(board[4].maxDistance).toBe(15); // ...and the earlier-stored 15u row ranks LAST (H14)
  // The death screen renders that ranking with the new run highlighted mid-list.
  await expect(page.locator('#hiscore-slot')).toContainText('TEAM RUNS');
  await expect(page.locator('#hiscore-slot .hiscore-list li').nth(3)).toHaveClass(/is-new/);
});

test('per-half arrows: each half\'s offscreen arrows stay inside ITS bounds and wear ITS viewer\'s colors', async ({ page }) => {
  await startTwoPlayerGame(page);
  await clearThreats(page);
  // A grown P1, a small P2 300u east, and ONE formed grunt 60u east of P1
  // (inside the 80u despawn ring): offscreen for BOTH cameras, edible for
  // P1 (2 > 1.44) but a hunter for P2 (1 < 1.44) — the same body must
  // paint yellow on the left half and blue on the right (B8 review
  // BLOCK-4: seat 0 owns pool slots 0-4, seat 1 owns 5-9, and the first
  // roster enemy claims the first slot of each half's slice).
  await page.evaluate(() => {
    const s = window.__game.state;
    s.players[0].scale = 2;
    s.players[1].mesh.position.x = 300;
    window.__game.debug.spawnSpecies('grunt', 60, 0, 1.2); // Height 1.44
  });
  await page.waitForFunction(() => {
    const inds = window.__game.state.enemyIndicators;
    return inds[0].style.display === 'block' && inds[5].style.display === 'block';
  }, null, { timeout: 30000 });
  const info = await page.evaluate(() => {
    const rect = window.__game.state.gameContainer.getBoundingClientRect();
    return {
      seam: rect.left + Math.floor(rect.width / 2),
      left: rect.left,
      right: rect.right,
      inds: window.__game.state.enemyIndicators.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          visible: el.style.display === 'block',
          centerX: (r.left + r.right) / 2,
          color: getComputedStyle(el).backgroundColor
        };
      })
    };
  });
  expect(info.inds.filter((i) => i.visible).length).toBeGreaterThanOrEqual(2);
  // Every seat-0 arrow inside the LEFT half, every seat-1 arrow inside the
  // RIGHT half — the seam is respected from both sides.
  for (const i of info.inds.slice(0, 5)) {
    if (!i.visible) continue;
    expect(i.centerX).toBeGreaterThan(info.left);
    expect(i.centerX).toBeLessThan(info.seam);
  }
  for (const i of info.inds.slice(5)) {
    if (!i.visible) continue;
    expect(i.centerX).toBeGreaterThan(info.seam);
    expect(i.centerX).toBeLessThan(info.right);
  }
  // Same enemy, two truths: P1's half shows it EDIBLE, P2's half HUNTER.
  expect(info.inds[0].color).toBe('rgba(255, 235, 59, 0.8)');
  expect(info.inds[5].color).toBe('rgba(3, 169, 244, 0.8)');
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

test('an oversized juja is nobody\'s nightmare: no dread, no arrow, and it FLEES the smaller hero (terminal review B-1)', async ({ page }) => {
  await startTwoPlayerGame(page);
  await clearThreats(page);
  // Divergent growth: P2 is the big hero (scale 4), P1 stays scale 1. A juja
  // sized off P2 (height 0.35 x 4 x 1.2 = 1.68) is NON-killable for P1
  // (height 1.0) — pre-fix this made a "harmless" critter read and act like
  // a lethal hunter for the smaller hero (vignette, CLOSE ONE!, blue arrow,
  // 2.6x-speed chase). Post-fix: harmless species never touch a threat
  // surface and always flee.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.players[1].scale = 4;
    s.players[1].mesh.scale.set(4, 4, 4);
    // Park the juja 6u from P1 — inside DANGER_RADIUS (9) and the arm band.
    window.__game.debug.spawnSpecies('juja', 6, 0, 1.4); // scale.y 1.4 -> height 1.68 > P1's 1.0
  });
  // Let the danger/AI passes run on the game clock.
  await page.evaluate(() => window.__game.debug.advance(1.5));
  const probe = await page.evaluate(() => {
    const s = window.__game.state;
    const juja = s.enemies.find((e) => e.userData.speciesKey === 'juja');
    return {
      exists: !!juja,
      p1Danger: s.players[0].dangerOpacity,
      p1NearMissArmed: juja ? juja.userData.nearMissArmed[0] === true : null,
      // The juja must be MOVING AWAY from P1 (flee), not closing: sample
      // its position delta over another advance below.
      x0: juja ? juja.position.x : null
    };
  });
  expect(probe.exists).toBe(true);
  expect(probe.p1Danger).toBeLessThan(0.02); // No vignette/heartbeat dread from a harmless critter
  expect(probe.p1NearMissArmed).toBe(false); // CLOSE ONE! can never arm on it
  const x1 = await page.evaluate(() => {
    window.__game.debug.advance(1.0);
    const juja = window.__game.state.enemies.find((e) => e.userData.speciesKey === 'juja');
    return juja ? juja.position.x : null;
  });
  expect(x1).not.toBeNull();
  expect(x1).toBeGreaterThan(probe.x0); // P1 is at x~0, juja at x 6+: fleeing means x GROWS
  // And no arrow points at it from P1's half. Ambient bubble spawns show
  // their own (legitimate) arrows, so isolate: shove every NON-juja enemy
  // past the despawn radius, let streaming reap them (0.2gs — under the
  // 1.25s top-up interval, and a freshly scheduled warn disc is not an
  // enemy), then probe with ONLY the juja offscreen east of P1.
  const arrows = await page.evaluate(() => {
    const s = window.__game.state;
    for (const e of s.enemies) {
      if (e.userData.speciesKey !== 'juja') e.position.set(500, e.position.y, 500);
    }
    const juja = s.enemies.find((e) => e.userData.speciesKey === 'juja');
    juja.position.x = 70; // Well outside P1's view, inside despawn radius
    juja.position.z = 0;
    window.__game.debug.advance(0.2);
    const onlyJuja = s.enemies.every((e) => e.userData.speciesKey === 'juja');
    return {
      onlyJuja,
      lit: s.enemyIndicators.slice(0, 5).filter((el) => el.style.display === 'block').length
    };
  });
  expect(arrows.onlyJuja).toBe(true); // Isolation held — the count below means the juja
  expect(arrows.lit).toBe(0); // Harmless + non-killable = no arrow at all
});
