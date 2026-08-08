import { test, expect } from '@playwright/test';
import { openGame, startGame, waitGameSeconds } from './helpers.js';

// Movement/timer specs measure against the GAME clock (state.runTime, the
// same dt the movement integrates), never performance.now(): under
// parallel-suite load the MAX_DELTA frame clamp (src/game.js) dilates game
// time well below wall time, which would shrink the measured movement while
// a wall-clock denominator kept growing. Wall-clock values appear only as
// generous wait ceilings.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
});

test('pausing and resuming does not refill the collect countdown', async ({ page }) => {
  await startGame(page); // Dismiss the start overlay and begin the run
  await expect
    .poll(async () => Number(await page.locator('#collect-time').textContent()), { timeout: 30000 })
    .toBeLessThanOrEqual(12);
  await page.locator('#pause-button').click(); // pause
  await page.locator('#pause-button').click(); // resume
  // Regression for the old exploit: resuming must NOT reset the timer to 15
  const shown = Number(await page.locator('#collect-time').textContent());
  expect(shown).toBeLessThanOrEqual(12);
});

test('collecting food resets the collect clock and grows the player', async ({ page }) => {
  // The core survival loop, through the REAL collision path: let the
  // countdown burn down a few GAME seconds, teleport the player onto an
  // existing food block, and assert the clock refilled toward 15 while the
  // player got taller.
  await startGame(page);
  await waitGameSeconds(page, 3);
  const before = await page.evaluate(() => ({
    timeLeft: window.__game.state.collectTimeLeft,
    scale: window.__game.state.playerScale,
  }));
  expect(before.timeLeft).toBeLessThan(13); // The countdown really ran
  expect(before.scale).toBe(1);
  // Teleport onto the food block FARTHEST from the boot enemy (torus
  // distance — entity images are player-relative, so raw deltas can hide a
  // seam neighbor): the collect must land before any enemy-contact death.
  await page.evaluate(() => {
    const s = window.__game.state;
    const axis = (a, b) => {
      const d = Math.abs(a - b) % 200; // worldSize
      return Math.min(d, 200 - d);
    };
    const enemy = s.enemies[0];
    let best = s.collectibles[0];
    let bestD = -1;
    for (const c of s.collectibles) {
      const d = Math.hypot(axis(c.position.x, enemy.position.x), axis(c.position.z, enemy.position.z));
      if (d > bestD) { bestD = d; best = c; }
    }
    s.player.position.set(best.position.x, 0, best.position.z);
  });
  // Frame-driven: the collect lands on the first running frame. State and
  // DOM are captured inside the first poll that observes the growth, so the
  // refilled clock is read before it can tick meaningfully back down.
  const handle = await page.waitForFunction(
    () => {
      const s = window.__game.state;
      return s.playerScale > 1
        ? { scale: s.playerScale, timeLeft: s.collectTimeLeft, shown: document.getElementById('collect-time').textContent }
        : false;
    },
    null,
    { timeout: 10000 }
  );
  const after = await handle.jsonValue();
  expect(after.scale).toBeGreaterThanOrEqual(1.099); // += growthFactor (0.1), minus float drift
  expect(after.timeLeft).toBeGreaterThan(12); // Refilled toward initialCollectTime (15)
  expect(after.timeLeft).toBeGreaterThan(before.timeLeft);
  // Same-JS-turn snapshot: the HUD number must agree with the reset state.
  expect(Number(after.shown)).toBe(Math.ceil(after.timeLeft));
});

test('hiding the tab auto-pauses a running game', async ({ page }) => {
  await startGame(page);
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(false);
  // Emulate the tab being hidden: override document.hidden and fire the event
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(true);
  await expect(page.locator('#pause-button')).toHaveText('Resume');
  // Restore so the page behaves normally for the rest of the test
  await page.evaluate(() => {
    delete document.hidden;
  });
});

test('ArrowUp moves the player at roughly actualPlayerSpeed units/second', async ({ page }) => {
  await startGame(page);
  await page.keyboard.down('ArrowUp');
  const start = await page.evaluate(() => ({
    z: window.__game.state.player.position.z,
    speed: window.__game.state.actualPlayerSpeed,
    t: window.__game.state.runTime,
  }));
  // Hold the key until at least 1 GAME second has simulated
  await page.waitForFunction(
    (t0) => window.__game.state.runTime >= t0 + 1,
    start.t,
    { timeout: 60000 }
  );
  const end = await page.evaluate(() => ({
    z: window.__game.state.player.position.z,
    t: window.__game.state.runTime,
  }));
  await page.keyboard.up('ArrowUp');
  const moved = start.z - end.z; // ArrowUp moves toward -z
  const expected = start.speed * (end.t - start.t); // Both samples are frame-consistent
  // Generous ±30% bounds: catches double-integration (2x) or missing-dt (60x) bugs
  expect(moved).toBeGreaterThan(expected * 0.7);
  expect(moved).toBeLessThan(expected * 1.3);
});

test('WASD alias: holding D moves the player toward +x', async ({ page }) => {
  await startGame(page);
  await page.keyboard.down('d');
  const start = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    speed: window.__game.state.actualPlayerSpeed,
    t: window.__game.state.runTime,
  }));
  await page.waitForFunction(
    (t0) => window.__game.state.runTime >= t0 + 0.5,
    start.t,
    { timeout: 60000 }
  );
  const end = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    t: window.__game.state.runTime,
  }));
  await page.keyboard.up('d');
  const moved = end.x - start.x; // D aliases ArrowRight: toward +x
  const expected = start.speed * (end.t - start.t);
  expect(moved).toBeGreaterThan(expected * 0.7);
  expect(moved).toBeLessThan(expected * 1.3);
});

// --- Pause invariants (plan 027 Step 3) ---
// Pause freezes the GAME clock; real (wall) time keeps passing. These
// cases therefore wait on an in-page setTimeout — the one place wall time
// is the honest axis, because the assertion is precisely "wall time passed
// and the game state did NOT move".

test('pause freezes a live combo window and the music; resume releases both', async ({ page }) => {
  await startGame(page);
  // Open a real combo window: silence the world, then a deterministic
  // airborne kill over a debug-spawned grunt (same choreography as the
  // balance exactness cases — the flattened enemy box makes the contact,
  // the unflattened pickup box ignores the dropped food).
  // Kill and pause in ONE evaluate — live frames between CDP round-trips
  // would otherwise tick the window before the freeze lands.
  const kill = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    s.enemies.forEach((e) => s.scene.remove(e));
    s.enemies = [];
    g.debug.clearPendingSpawns();
    s.players.forEach((p) => { p.collectTimeLeft = 900; });
    const p0 = s.players[0];
    s.playerScale = 3;
    s.player.scale.set(3, 3, 3);
    p0.jump.airborne = true;
    p0.jump.offset = 2.5;
    p0.jump.velocity = 0;
    p0.jump.gravity = 45;
    g.debug.spawnSpecies('grunt', s.player.position.x, s.player.position.z, 2);
    g.debug.advance(3 / 60);
    document.getElementById('pause-button').click(); // Freeze via the real path
    return {
      combo: s.comboCount,
      window: s.players[0].comboTimeLeft, // The frozen value — nothing ticks past this line
      isPaused: s.isPaused,
      musicWhilePaused: g.debug.musicActive()
    };
  });
  expect(kill.combo).toBe(1);
  expect(kill.window).toBeGreaterThan(3.8); // A live ~4s window was on the clock
  expect(kill.isPaused).toBe(true);
  expect(kill.musicWhilePaused).toBe(false); // Music follows pause

  // A full wall second passes; the frozen game must not notice it.
  const frozen = await page.evaluate(() => new Promise((resolve) => {
    const s = window.__game.state;
    const before = { runTime: s.runTime, comboTimeLeft: s.players[0].comboTimeLeft };
    setTimeout(() => resolve({
      before,
      runTime: s.runTime,
      comboTimeLeft: s.players[0].comboTimeLeft
    }), 1000);
  }));
  expect(frozen.before.comboTimeLeft).toBe(kill.window); // Nothing moved since the freeze
  expect(frozen.runTime).toBe(frozen.before.runTime); // Game clock frozen solid
  expect(frozen.comboTimeLeft).toBe(frozen.before.comboTimeLeft); // Combo window frozen with it

  // Resume + step + read in ONE evaluate: the window ticks again on the
  // game clock, and has moved by EXACTLY the stepped 0.2s — the wall
  // second under pause cost it nothing.
  const resumed = await page.evaluate(() => {
    document.getElementById('pause-button').click(); // Real resume path
    const musicAfterResume = window.__game.debug.musicActive();
    window.__game.debug.advance(0.2);
    return { musicAfterResume, comboTimeLeft: window.__game.state.players[0].comboTimeLeft };
  });
  expect(resumed.musicAfterResume).toBe(true); // Music returns with the run
  expect(resumed.comboTimeLeft).toBeLessThan(kill.window - 0.15); // Ticking again...
  expect(resumed.comboTimeLeft).toBeGreaterThan(kill.window - 0.35); // ...from where it froze, not 1s poorer
});

test('pause freezes the endless spawn cooldown: no burst on resume', async ({ page }) => {
  await startGame(page);
  await page.locator('#pause-button').click(); // Freeze first, then empty the world
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(true);
  await page.evaluate(() => {
    const s = window.__game.state;
    s.enemies.forEach((e) => s.scene.remove(e));
    s.enemies = [];
    window.__game.debug.clearPendingSpawns();
    s.players.forEach((p) => { p.collectTimeLeft = 900; });
  });

  // ~5 wall seconds of pause: the empty bubble must stay empty (a wall-
  // clock cooldown would have banked 4 top-ups by now).
  const paused = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    const t0 = g.state.runTime;
    setTimeout(() => resolve({
      runTimeMoved: g.state.runTime - t0,
      enemies: g.state.enemies.length,
      pending: g.debug.pendingSpawnInfo().length
    }), 5000);
  }));
  expect(paused.runTimeMoved).toBe(0);
  expect(paused.enemies).toBe(0); // Nothing spawned...
  expect(paused.pending).toBe(0); // ...nothing even scheduled

  // Resume inside ONE evaluate (no live frames can interleave): the next
  // frame changes nothing, and at most ONE top-up fits inside the first
  // ENDLESS_SPAWN_INTERVAL (1.25s) — the cooldown resumed, it never banked.
  const resumed = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    document.getElementById('pause-button').click(); // Real resume path
    g.debug.advance(1 / 60);
    const nextFrameEnemies = s.enemies.length;
    g.debug.advance(1.1); // Total stepped ≈ 1.117s < 1.25
    const withinInterval = s.enemies.length + g.debug.pendingSpawnInfo().length;
    g.debug.advance(0.25); // Total ≈ 1.37s > 1.25 — streaming must be alive again
    const afterInterval = s.enemies.length + g.debug.pendingSpawnInfo().length;
    return { nextFrameEnemies, withinInterval, afterInterval };
  });
  expect(resumed.nextFrameEnemies).toBe(0); // No burst on the resume frame
  expect(resumed.withinInterval).toBeLessThanOrEqual(1); // ≤1 spawn in the first interval
  expect(resumed.afterInterval).toBeGreaterThanOrEqual(1); // ...and streaming really resumed
});

test('debug.advance steps the game clock deterministically and hands back a single rAF loop', async ({ page }) => {
  await startGame(page);
  // One synchronous evaluate = zero CDP races: clear the world, schedule
  // exactly ONE bubble warn, then step the REAL update() 2.0 game seconds —
  // the 0.95s warn plus the 0.5s materialize must complete inside it, so
  // the scheduled monster exists and is fully formed when the call returns.
  const stepped = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    s.enemies.forEach((e) => s.scene.remove(e));
    s.enemies = [];
    g.debug.clearPendingSpawns();
    s.players.forEach((p) => { p.collectTimeLeft = 900; }); // No collect death mid-step
    g.debug.resetEnemyStreaming();
    g.debug.updateEnemyStreaming(5); // Schedules exactly one warn disc (prey band)
    const warn = g.debug.pendingSpawnInfo()[0];
    const t0 = s.runTime;
    g.debug.advance(2.0);
    const dtFirst = s.runTime - t0;
    // Checkpoint at 2.0 game seconds: our warn (0.95s) + materialize (0.5s)
    // completed at 1.45; the live loop's own next bubble warn (cooldown
    // 1.25s + 0.95s warn) can't land before 2.2 — so the roster holds
    // EXACTLY our monster, fully formed, within its short flee drift
    // (prey is killable → it flees ≤ ~1.3u in the 0.55s since forming).
    const atCheckpoint = {
      enemies: s.enemies.length,
      formed: s.enemies[0] ? s.enemies[0].userData.materializing === undefined : false,
      distFromWarn: s.enemies[0]
        ? Math.hypot(s.enemies[0].position.x - warn.x, s.enemies[0].position.z - warn.z)
        : Infinity
    };
    g.debug.advance(2.5); // Second call: the resume/re-pause cycle must stack cleanly
    return { scheduled: !!warn, dt: s.runTime - t0, dtFirst, atCheckpoint };
  });
  expect(stepped.scheduled).toBe(true);
  expect(stepped.dtFirst).toBeGreaterThanOrEqual(1.95); // advance(2.0) moved the clock 2.0 ±0.05
  expect(stepped.dtFirst).toBeLessThanOrEqual(2.05);
  expect(stepped.dt).toBeGreaterThanOrEqual(4.45); // Total 4.5 ±0.05 across both calls
  expect(stepped.dt).toBeLessThanOrEqual(4.55);
  expect(stepped.atCheckpoint.enemies).toBe(1); // Zero during the warn window, exactly one after
  expect(stepped.atCheckpoint.formed).toBe(true); // Warn → materialize ran through the real pipeline
  expect(stepped.atCheckpoint.distFromWarn).toBeLessThan(2.5); // ...at the disc's own spot

  // The stepper must hand the loop back to EXACTLY ONE rAF driver (plan 027
  // STOP condition: no double-running). Chromium rAF handles increment by 1
  // per request, so over N probe frames the page consumes ~2 ids per frame
  // (game loop + this probe); a double-running game loop would consume ~3.
  const probe = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const idStart = requestAnimationFrame(function step() {
      frames++;
      if (frames < 30) { requestAnimationFrame(step); return; }
      const idEnd = requestAnimationFrame(() => {});
      cancelAnimationFrame(idEnd);
      resolve({ idDelta: idEnd - idStart, frames });
    });
  }));
  expect(probe.idDelta).toBeLessThanOrEqual(probe.frames * 2.5 + 2); // Not double-running...
  expect(probe.idDelta).toBeGreaterThanOrEqual(probe.frames * 1.5); // ...and the game loop really resumed
  // And the live loop keeps simulating without any further advance calls.
  await waitGameSeconds(page, 0.1);
});

test('Enter pauses and resumes mid-run', async ({ page }) => {
  await startGame(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('#pause-button')).toHaveText('Resume');
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('#pause-button')).toHaveText('Pause');
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(false);
});
