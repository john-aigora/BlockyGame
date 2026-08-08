import { test, expect } from '@playwright/test';
import { openGame, startGame, waitForGameOver, settleFrames } from './helpers.js';

// Warn pipeline end-to-end (plan 027 Step 4): schedule → pulsing red disc →
// materialize, the disc pool's zero-allocation discipline, the dead-run
// freeze (plan 019's C-1 guard: a death mid-warn FREEZES the pipeline — no
// monster ever materializes over the death screen; the discs themselves
// clear on restart via setupNewGame), and the speed-scaled warn window
// (plan 024 DT-9) surviving the whole pipeline at 5x. All time is stepped
// through debug.advance — zero wall-clock dependence.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
});

// Empties the world so the pipeline under test is the only actor: bodies,
// pending discs, and the collect-death clock all silenced.
function silenceWorld(page) {
  return page.evaluate(() => {
    const s = window.__game.state;
    s.enemies.forEach((e) => s.scene.remove(e));
    s.enemies = [];
    window.__game.debug.clearPendingSpawns();
    s.players.forEach((p) => { p.collectTimeLeft = 900; });
  });
}

test('schedule → visible warn disc, zero enemies during the window, exactly one after', async ({ page }) => {
  await startGame(page);
  await silenceWorld(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    const ringAt = (x, z) => s.scene.children.some((c) =>
      c.visible && c.geometry && c.geometry.type === 'RingGeometry' &&
      Math.abs(c.position.x - x) < 0.01 && Math.abs(c.position.z - z) < 0.01);
    g.debug.resetEnemyStreaming();
    g.debug.updateEnemyStreaming(5); // Schedules exactly ONE warn (slot 0: prey)
    const warn = g.debug.pendingSpawnInfo()[0];
    const scheduled = {
      pending: g.debug.pendingSpawnInfo().length,
      discVisible: ringAt(warn.x, warn.z),
      enemies: s.enemies.length
    };
    g.debug.advance(0.5); // Mid-window (warn is 0.95s at 1x)
    const midWindow = {
      pending: g.debug.pendingSpawnInfo().length,
      discVisible: ringAt(warn.x, warn.z),
      enemies: s.enemies.length
    };
    g.debug.advance(0.6); // 1.1s total: past the warn, before the next top-up (1.25s)
    const after = {
      pending: g.debug.pendingSpawnInfo().length,
      discVisible: ringAt(warn.x, warn.z),
      enemies: s.enemies.length,
      atWarnSpot: s.enemies.length === 1 &&
        Math.hypot(s.enemies[0].position.x - warn.x, s.enemies[0].position.z - warn.z) < 2.5
    };
    return { scheduled, midWindow, after };
  });
  expect(r.scheduled.pending).toBe(1);
  expect(r.scheduled.discVisible).toBe(true); // The red ring is really in the scene
  expect(r.scheduled.enemies).toBe(0);
  expect(r.midWindow.pending).toBe(1); // Still telegraphing...
  expect(r.midWindow.discVisible).toBe(true);
  expect(r.midWindow.enemies).toBe(0); // ...zero monsters during the whole window
  expect(r.after.pending).toBe(0); // The warn expired...
  expect(r.after.discVisible).toBe(false); // ...its disc left the scene...
  expect(r.after.enemies).toBe(1); // ...and EXACTLY one monster exists
  expect(r.after.atWarnSpot).toBe(true); // ...standing where the disc promised
});

test('disc pool discipline: 10 schedule→materialize cycles never grow the geometry count', async ({ page }) => {
  // On the paused start overlay nothing else schedules; the pipeline is
  // driven by the debug ticks (the balance cap spec's pattern), with real
  // rendered frames between cycles so pooled discs register with the
  // renderer. One warm-up cycle first: the shared ring geometry (and any
  // late boot resources) registers, then the steady state must be FLAT.
  const cycle = () => page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    let guard = 0;
    while (g.debug.pendingSpawnInfo().length === 0 && guard++ < 25) {
      g.debug.updateEnemyStreaming(5); // Schedules one warn disc
    }
    for (let i = 0; i < 30; i++) g.debug.updateSpawnWarnings(0.05); // 1.5gs: warn expires, monster spawns
    // Despawn the materialized body: enemy GEOMETRY is shared
    // (characters.js), so removal cannot move the geometry count.
    s.enemies.forEach((e) => s.scene.remove(e));
    s.enemies = [];
    return g.debug.pendingSpawnInfo().length; // Must be 0 — the cycle completed
  });

  expect(await cycle()).toBe(0); // Warm-up cycle
  await settleFrames(page, 3); // Let everything the warm-up allocated render+register
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  const before = await page.evaluate(() => window.__game.state.renderer.info.memory.geometries);

  for (let i = 0; i < 9; i++) {
    expect(await cycle()).toBe(0);
    await settleFrames(page, 2); // Each cycle's disc gets a real rendered frame
  }
  const after = await page.evaluate(() => window.__game.state.renderer.info.memory.geometries);
  expect(after - before).toBeLessThanOrEqual(1); // Pooled discs: no per-cycle allocation (≤1 = internals noise)
});

test('death mid-warn freezes the pipeline; restart clears the discs; advance() guards the dead run', async ({ page }) => {
  await startGame(page);
  await silenceWorld(page);
  const death = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    g.debug.resetEnemyStreaming();
    g.debug.updateEnemyStreaming(5); // One warn disc in flight
    s.players.forEach((p) => { p.collectTimeLeft = 0.05; }); // Death in ~3 stepped frames
    g.debug.advance(0.5); // Death lands mid-warn; the remaining steps no-op on the dead run
    return {
      gameActive: s.gameActive,
      pending: g.debug.pendingSpawnInfo(),
      enemies: s.enemies.length
    };
  });
  expect(death.gameActive).toBe(false);
  expect(death.pending.length).toBe(1); // The disc survived the death FROZEN...
  expect(death.pending[0].t).toBeGreaterThan(0.8); // ...with its timer barely touched (no post-death ticking)
  expect(death.enemies).toBe(0);

  // Frames keep rendering behind the death screen; the pipeline must not
  // move at all (plan 019 C-1: no fresh monsters over the death screen).
  await settleFrames(page, 40);
  const later = await page.evaluate(() => ({
    pending: window.__game.debug.pendingSpawnInfo(),
    enemies: window.__game.state.enemies.length,
    // The dead run also locks the stepper: advance() must throw without
    // {allowMenu:true} — a spec stepping a dead clock is a spec bug.
    threw: (() => {
      try { window.__game.debug.advance(0.1); return false; }
      catch { return true; }
    })(),
    allowMenuOk: (() => {
      try { window.__game.debug.advance(0.1, { allowMenu: true }); return true; }
      catch { return false; }
    })()
  }));
  expect(later.pending).toEqual(death.pending); // Timer-exact freeze: not one tick advanced
  expect(later.enemies).toBe(0); // Nothing materialized behind the death screen
  expect(later.threw).toBe(true);
  expect(later.allowMenuOk).toBe(true);

  // Restart: setupNewGame drops every warn disc with the old run.
  await waitForGameOver(page);
  await page.locator('#restart-button').click();
  await expect(page.locator('#start-overlay')).toBeVisible();
  expect(await page.evaluate(() => window.__game.debug.pendingSpawnInfo().length)).toBe(0);
});

test('speed-scaled warn survives the pipeline: at 5x the window is 2.09s end-to-end (DT-9)', async ({ page }) => {
  await startGame(page);
  await silenceWorld(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    s.currentSpeedMultiplierIndex = 4; // 5.0x (speedMultipliers[4])
    g.debug.applySpeedMultiplier(); // Player speed 30 → warn clamp 2.2 (plan 024)
    g.debug.resetEnemyStreaming();
    g.debug.updateEnemyStreaming(5);
    const warnTime = g.debug.pendingSpawnInfo()[0].warnTime;
    g.debug.advance(1.9); // Twice the 1x window — the 5x disc must still be telegraphing
    const stillPending = {
      pending: g.debug.pendingSpawnInfo().length >= 1,
      enemies: s.enemies.length
    };
    g.debug.advance(0.3); // 2.2s total > 2.09 — now it lands
    return { warnTime, stillPending, enemies: s.enemies.length };
  });
  expect(r.warnTime).toBeCloseTo(0.95 * 2.2, 9); // SPAWN_WARN_TIME × the 2.2 clamp ceiling
  expect(r.stillPending.pending).toBe(true); // At 1.9s a 1x disc would be a monster already...
  expect(r.stillPending.enemies).toBe(0); // ...the 5x disc is still notice, not threat
  expect(r.enemies).toBe(1); // The pipeline delivered exactly the promised monster
});
