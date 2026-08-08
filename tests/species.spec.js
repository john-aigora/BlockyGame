import { test, expect } from '@playwright/test';
import { openGame, startGame, forceClassic, waitGameSeconds } from './helpers.js';

// Enemy species (plan 024): the ENEMY_SPECIES stats bag drives per-enemy
// speed (sprinter), the harmless-contact rule and reduced food drop (juja),
// the threat-only prey-supply gate (DT-4), the chainable second kill-spawn
// (DT-2), and the speed-aware warn rings (DT-9). Everything runs through
// the real sim via debug.spawnSpecies (formed enemy, no warn/materialize)
// and game-clock waits — no mocks, no wall-clock timing.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
});

test('PENDING giant warns count as threats: scheduled dread suppresses the next top-up (DT-4, pending half)', async ({ page }) => {
  // H12: the DT-4 gate has two halves — live bodies (specced below) and the
  // PENDING queue. Deterministic on the paused start overlay: schedule 4
  // discs sized against a scale-2.5 player, then shrink to scale 1 — every
  // disc now materializes TALLER than the player (even the prey band's low
  // roll is 0.55*2.5 = 1.375x the shrunken height), so the pending queue
  // alone carries 4 threats = the full per-player target at ramp 0. The
  // next top-up tick must schedule NOTHING; clearing the queue must reopen
  // the gate. Delete the pendingSpawns loop from the gate's tally and the
  // suppression assert fails.
  const r = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    s.enemies.forEach((e) => s.scene.remove(e));
    s.enemies = [];
    g.debug.clearPendingSpawns();
    g.debug.resetEnemyStreaming();
    s.playerScale = 2.5; // Small enough for easy dry placement, big enough to shrink under
    s.player.scale.set(2.5, 2.5, 2.5);
    g.debug.spawnNewEnemies(); // 2 discs (classic giant + chainable prey band)
    g.debug.spawnNewEnemies(); // 2 more — 4 total, all judged against scale 2.5
    s.playerScale = 1;
    s.player.scale.set(1, 1, 1);
    const pendingBefore = g.debug.pendingSpawnInfo().length;
    const allFutureGiants = g.debug.pendingSpawnInfo()
      .every((w) => 1.2 * w.scaleFactor > s.playerScale); // The gate's own height rule
    g.debug.updateEnemyStreaming(5); // Cooldown cleared; the gate must still refuse
    const afterSuppressed = g.debug.pendingSpawnInfo().length;
    g.debug.clearPendingSpawns(); // Queue emptied — threats 0 again
    g.debug.updateEnemyStreaming(5);
    const afterReopened = g.debug.pendingSpawnInfo().length;
    return { pendingBefore, allFutureGiants, afterSuppressed, afterReopened };
  });
  expect(r.pendingBefore).toBe(4);
  expect(r.allFutureGiants).toBe(true); // Every disc is a future threat for the shrunken hero
  expect(r.afterSuppressed).toBe(4); // Suppressed: pending threats alone held the gate shut
  expect(r.afterReopened).toBe(1); // Discriminator: the identical tick schedules once the queue clears
});

test('a sprinter closes distance faster than a grunt (speedFactor threading)', async ({ page }) => {
  // Symmetric choreography on the CLASSIC flat arena: the endless terrain's
  // seeded boulders can wedge one contender's chase line (measured: the
  // +40u sprinter sat blocked while the -40u grunt ran free), which would
  // test the map, not the speed. Classic has no obstacles and no streaming,
  // and the speciesSpeed threading under test is the same code path in both
  // modes. Two NON-killable scale-2 hunters at +/-40u chase a stationary
  // player in pure-chase range (outside the 15u engagement radius, so no
  // orbit blending). Drift is disarmed per enemy (zeroed velocity + a
  // far-future re-roll), leaving closing speed as the only variable:
  // sprinter 2.2x vs grunt 1x of the same global enemy speed.
  await forceClassic(page);
  const idx = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    const p = s.player.position;
    s.collectTimeLeft = 60;
    s.enemies[0].position.set(p.x, 0, p.z + 60); // Boot giant out of the measurement lane
    return {
      sprinter: g.debug.spawnSpecies('sprinter', p.x + 40, p.z, 2),
      grunt: g.debug.spawnSpecies('grunt', p.x - 40, p.z, 2)
    };
  });
  await startGame(page);
  // Disarm drift AFTER the run starts (the boot enemy's first drift re-roll
  // lands 1-3s into the run; 9999 pushes every re-roll past the test).
  await page.evaluate(() => {
    for (const e of window.__game.state.enemies) {
      e.randomVelocity.set(0, 0, 0);
      e.timeToChangeRandomVelocity = 9999;
    }
  });
  const readDistances = (which) => page.evaluate((w) => {
    const s = window.__game.state;
    const p = s.player.position;
    const dist = (i) => Math.hypot(s.enemies[i].position.x - p.x, s.enemies[i].position.z - p.z);
    return { sprinter: dist(w.sprinter), grunt: dist(w.grunt) };
  }, which);
  const d0 = await readDistances(idx);
  await waitGameSeconds(page, 2);
  const d2 = await readDistances(idx);
  const closedSprinter = d0.sprinter - d2.sprinter;
  const closedGrunt = d0.grunt - d2.grunt;
  // Expected over 2 game-seconds at 1x: sprinter ~6.6u vs grunt ~3.0u (both
  // may gain a little from frames between the reads — identically). The gap
  // is the threading; 2u of margin absorbs residual jitter.
  expect(closedGrunt).toBeGreaterThan(1); // The control really chased
  expect(closedSprinter).toBeGreaterThan(closedGrunt + 2);
  // Owner speed rule check (plan 024 STOP condition): the sprinter harasses,
  // it can NEVER outpace the 1x player's 6 u/s — closing speed stays under
  // 4.2 u/s (2.2 x 1.5 x the 1.25 separation cap) even before drift.
  expect(closedSprinter / 2).toBeLessThan(4.2);
});

test('juja contact never ends the game, and a killable juja keeps its green body', async ({ page }) => {
  // The harmless guard: an OVERSIZED (non-killable) juja overlaps the player
  // for a full game-second of contact frames. The rotation never produces
  // one (jujas spawn at 0.35x the player) — the guard is the species rule
  // under test. A second, small juja checks the color-flip bypass: killable,
  // yet its body stays species green instead of repainting yellow.
  const idx = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    const p = s.player.position;
    s.collectTimeLeft = 60;
    s.enemies[0].position.set(p.x + 70, s.enemies[0].position.y, p.z); // Boot giant out of the scene
    const giant = g.debug.spawnSpecies('juja', p.x, p.z, 2); // Height 2.4 > player 1 -> NOT killable
    const small = g.debug.spawnSpecies('juja', p.x + 20, p.z, 0.3); // Height 0.36 -> killable prey
    return { giant, small };
  });
  await startGame(page);
  await waitGameSeconds(page, 1); // ~60 contact frames on the overlapping giant juja
  const result = await page.evaluate(({ giant, small }) => {
    const s = window.__game.state;
    const g = s.enemies[giant];
    const sm = s.enemies[small];
    return {
      gameActive: s.gameActive,
      giantAlive: !!g,
      giantKillable: g && g.userData.killable,
      smallKillable: sm && sm.userData.killable,
      smallBody: sm && sm.userData.bodyMesh.material.color.getHex()
    };
  }, idx);
  expect(result.gameActive).toBe(true); // A harmless species never ends the run
  expect(result.giantAlive).toBe(true); // ...and never dies to mere contact either
  expect(result.giantKillable).toBe(false); // The guard really ran on the NON-killable branch
  expect(result.smallKillable).toBe(true);
  expect(result.smallBody).toBe(0x66BB6A); // Killable, yet species green — flip bypassed
});

test('hunting cannot starve the prey supply: killable bodies do not block the rotation (DT-4)', async ({ page }) => {
  // The owner's exact post-hunt state (audit DT-4): the bubble holds SIX
  // killable bodies — a successful hunt mid-feast, more mouths than the
  // bubble target of 4. Under the old gate (enemies + pending >= target)
  // this scene never schedules again: eating well suspended the rotation
  // that guarantees prey. Under the threat gate, killable bodies hold no
  // slot, so within 2 x ENDLESS_SPAWN_INTERVAL of streaming time the
  // rotation resumes — and its first spawn is the opening PREY band.
  // Everything runs in ONE evaluate (atomic vs the live loop) on the debug
  // streaming/warn ticks, exactly like the endless-stream rotation spec.
  await startGame(page);
  const out = await page.evaluate(() => {
    const g = window.__game;
    const d = g.debug;
    const s = g.state;
    s.collectTimeLeft = 60;
    // Fresh slate ON the spawn mesa (guaranteed dry land within 48u — a
    // player teleport would gamble the 35-50u spawn ring on unscouted
    // terrain; probed at +600 it was ALL lake and every placement failed).
    // Run stale boot-time warns to materialize, expel every live enemy past
    // the 80u ring, despawn them, and restart the rotation.
    const p = s.player.position;
    for (let i = 0; i < 40; i++) d.updateSpawnWarnings(0.05);
    for (const e of s.enemies) e.position.x = p.x + 200;
    d.updateEnemyStreaming(0); // Despawn pass — the bubble is now empty
    d.resetEnemyStreaming();
    for (let i = 0; i < 6; i++) d.spawnSpecies('grunt', p.x + 20 + i * 4, p.z, 0.5); // Killable feast
    // Two top-up windows: each big dt clears the cooldown, then the warn
    // pipeline runs 2.0 game-seconds so the scheduled spawn goes live.
    d.updateEnemyStreaming(1.25);
    for (let i = 0; i < 40; i++) d.updateSpawnWarnings(0.05);
    d.updateEnemyStreaming(1.25);
    for (let i = 0; i < 40; i++) d.updateSpawnWarnings(0.05);
    const first = s.enemies[6]; // Indices 0-5 are the feast; 6 = first rotation spawn
    return {
      count: s.enemies.length,
      firstIsPreyBand: !!first &&
        (first.userData.materializeTarget ?? first.scale.y) * 1.2 < s.playerScale
    };
  });
  // Was: starved at 6 forever. Now: the rotation scheduled again (>= 1 new
  // body; 2 when both windows found land on the first tries).
  expect(out.count).toBeGreaterThanOrEqual(7);
  expect(out.firstIsPreyBand).toBe(true); // The resumed rotation opens on prey
});

test('after one kill, a chainable killable enemy exists within 30u (DT-2)', async ({ page }) => {
  // A scale-3 hero eats the boot giant (height 1.5 -> killable) through the
  // real collision branch; the kill wave's SECOND replacement is a
  // prey-band grunt at KILL_SPAWN_PREY_MIN..MAX (18-25u). Poll until a LIVE
  // killable body stands within 30u — 25 max plus a breath of flee drift
  // while it materializes. Streaming spawns land at 35-50u and the wave's
  // giant is 4.5 tall vs the 3.0 player, so only the chainable prey can
  // satisfy the poll. Food is cleared so pickups don't grow the player into
  // side effects mid-scene.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.playerScale = 3;
    s.player.scale.set(3, 3, 3);
    s.collectTimeLeft = 60;
    s.collectibles.forEach((c) => s.scene.remove(c));
    s.collectibles = [];
  });
  await startGame(page);
  await page.evaluate(() => {
    const s = window.__game.state;
    const e = s.enemies[0];
    s.player.position.set(e.position.x, s.player.position.y, e.position.z);
  });
  await page.waitForFunction(() => window.__game.state.score >= 25, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const s = window.__game.state;
    const p = s.player.position;
    return s.enemies.some((e) => e.userData.killable === true &&
      Math.hypot(e.position.x - p.x, e.position.z - p.z) <= 30);
  }, null, { timeout: 10000 });
  expect(await page.evaluate(() => window.__game.state.gameActive)).toBe(true);
});

test('warn rings scale with player speed: 5x multiplier doubles the notice (DT-9)', async ({ page }) => {
  // Deterministic on the paused start overlay: nothing ticks the warn
  // pipeline, so scheduled entries hold their full lifetime for reading.
  // Baseline at 1x (ratio exactly 1.0 -> the classic 0.95s), then the 5x
  // multiplier (actualPlayerSpeed 30 -> ratio 5, clamped to 2.2): every new
  // warn must live at least twice the 1x notice.
  const out = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    g.debug.spawnNewEnemies(); // Queues warns at 1x
    const base = g.debug.pendingSpawnInfo().map((w) => w.warnTime);
    s.currentSpeedMultiplierIndex = 4; // speedMultipliers[4] = 5.0
    g.debug.applySpeedMultiplier();
    const before = base.length;
    g.debug.spawnNewEnemies(); // Queues warns at 5x
    const fast = g.debug.pendingSpawnInfo().slice(before).map((w) => w.warnTime);
    return { base, fast };
  });
  expect(out.base.length).toBeGreaterThanOrEqual(1);
  expect(out.fast.length).toBeGreaterThanOrEqual(1);
  for (const w of out.base) expect(w).toBeCloseTo(0.95, 5); // SPAWN_WARN_TIME x 1.0 exactly
  for (const w of out.fast) {
    expect(w).toBeGreaterThanOrEqual(2 * 0.95 - 1e-9); // At least 2x the 1x notice...
    expect(w).toBeLessThanOrEqual(2.2 * 0.95 + 1e-9); // ...and clamped at the 2.2 ceiling
  }
});

test('a juja kill drops exactly its species foodDrop (2 food)', async ({ page }) => {
  // CLASSIC mode on purpose: endless food placement validates spots and can
  // silently fail near rocks/water (spawnCollectible), which would make an
  // exact count flaky; classic placement always lands. The kill path under
  // test (killEnemy -> species foodDrop) is mode-agnostic. Every other food
  // item is cleared first, so the count is pure: the kill drops 2, and any
  // block the player then eats is replaced 1:1 by spawnNearPlayer (out of
  // reach at >= 5u) — the length holds at exactly 2 no matter the timing.
  await forceClassic(page);
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    const p = s.player.position;
    s.collectTimeLeft = 60;
    s.enemies[0].position.set(p.x + 80, 0, p.z); // Boot giant far inside the arena
    s.collectibles.forEach((c) => s.scene.remove(c));
    s.collectibles = [];
    g.debug.spawnSpecies('juja', p.x + 0.3, p.z, 0.3); // Killable, in contact on frame 1
  });
  await startGame(page);
  // The kill pays KILL_POINTS 25 (size bounty floor(1.2 x 0.3) = 0) plus at
  // most a couple of +1 food collects — reaching 25 proves the kill landed.
  await page.waitForFunction(() => window.__game.state.score >= 25, null, { timeout: 10000 });
  await expect
    .poll(() => page.evaluate(() => window.__game.state.collectibles.length), { timeout: 10000 })
    .toBe(2);
  const after = await page.evaluate(() => ({
    gameActive: window.__game.state.gameActive,
    jujas: window.__game.state.enemies.filter((e) => e.userData.speciesKey === 'juja').length
  }));
  expect(after.gameActive).toBe(true); // Killable contact was a kill, never a death
  expect(after.jujas).toBe(0); // The snack was really eaten
});
