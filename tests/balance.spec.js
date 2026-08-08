import { test, expect } from '@playwright/test';
import { openGame, startGame, waitGameSeconds } from './helpers.js';

// Scoring & balance (plan 011 + score-juice pass): defeating an enemy pays
// at least the KILL_POINTS bounty through the REAL collision path (the size
// bounty only adds), chained kills multiply the payout via the combo, the
// enemy population never exceeds MAX_ENEMIES, and score writes reach the HUD.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
});

// Force-kills one enemy through the real collision branch: make the player
// huge (every enemy killable), start the run, teleport onto an enemy, and
// wait for the kill bounty to land. No synthetic score writes.
async function killOneEnemy(page) {
  await page.evaluate(() => {
    const s = window.__game.state;
    s.playerScale = 20;
    s.player.scale.set(20, 20, 20);
  });
  await startGame(page);
  await page.evaluate(() => {
    const s = window.__game.state;
    const enemy = s.enemies[0];
    s.player.position.set(enemy.position.x, 0, enemy.position.z);
  });
  // Frame-driven (the kill lands on the first running frame); the ceiling is
  // generous only for parallel-suite load, where frames arrive slowly.
  await page.waitForFunction(() => window.__game.state.score >= 25, null, { timeout: 10000 });
}

test('defeating an enemy pays at least the 25-point kill bounty', async ({ page }) => {
  await killOneEnemy(page);
  // ≥ 25, not === 25: the size bounty adds SIZE_BOUNTY_PER_UNIT per whole
  // unit of enemy height, and the giant player may also sweep up food blocks.
  const score = await page.evaluate(() => window.__game.state.score);
  expect(score).toBeGreaterThanOrEqual(25);
});

test('two rapid kills pay more than 2x the single-kill bounty (combo)', async ({ page }) => {
  // First kill WITHOUT killOneEnemy's teleport (which can land the player on
  // a freshly spawned, taller enemy and end the run): at scale 20 the
  // player's AABB already covers the boot enemy at its (10, 10) start
  // offset, so the real collision kill fires on the first running frame.
  // All food is removed first — a giant player otherwise chain-collects
  // (every pickup respawns food inside its huge AABB), growing itself into
  // unplanned extra kills and eventually an enemy-contact death.
  await page.evaluate(() => {
    const s = window.__game.state;
    s.playerScale = 20;
    s.player.scale.set(20, 20, 20);
    s.collectibles.forEach((c) => s.scene.remove(c));
    s.collectibles = [];
  });
  await startGame(page);
  // The wave read rides INSIDE the first poll that observes the kill (B3
  // pattern): pending warns live only 0.95s, and a separate post-wait
  // evaluate could arrive after they materialize under parallel-suite load.
  const waveHandle = await page.waitForFunction(() => {
    const s = window.__game.state;
    if (s.score < 25) return false;
    const p = s.player.position;
    return {
      wave: window.__game.debug.pendingSpawnInfo().map((w) => ({
        dist: Math.hypot(w.x - p.x, w.z - p.z),
        killable: w.scaleFactor * 1.2 < s.playerScale
      }))
    };
  }, null, { timeout: 10000 });
  // Reachable combos (plan 024, audit DT-2): the kill wave itself now
  // guarantees the chain — one scheduled replacement is a killable
  // PREY-band body within KILL_SPAWN_PREY_MAX (25u) of the player. This is
  // WHY the x2 below is reachable at 1x without any speed changes.
  const { wave } = await waveHandle.jsonValue();
  expect(wave.some((w) => w.killable && w.dist <= 25.001)).toBe(true);

  // Endless spawns go through a 0.95s warn + 0.5s materialize pipeline
  // (src/enemies.js), so the wave spawned by the first kill is not in
  // state.enemies yet — settle on the GAME clock, then wait for enemies[0]
  // to be live AND fully materialized (its scale.y feeds the bounty math
  // below; mid-materialize it is still growing). Which spawn lands at [0]
  // depends on frame timing (the kill-wave giants and the first streaming
  // prey expire their warns within one frame of each other, and same-frame
  // expiry reverses the push order) — both bands are killable at 35, so the
  // choreography works with either.
  await waitGameSeconds(page, 1.5);
  await page.waitForFunction(() => {
    const e = window.__game.state.enemies[0];
    return !!e && e.userData.materializing === undefined;
  }, null, { timeout: 10000 });

  // Second kill inside the 4s combo window: grow past every live spawn
  // (heights ≤ ~31) and land on enemies[0] through the real collision path.
  // CHOREOGRAPHY STABILIZATION (B3, driver-granted): every OTHER enemy is
  // moved out of the despawn ring in the SAME evaluate as the teleport.
  // Mechanism being defused: these bodies are huge — a scale-20 player's
  // honest body box (half-width 0.54·20) meets a height-30 giant's box
  // (half-width 0.6·25) at up to ~37u of diagonal separation, and streaming
  // giants spawn from ENDLESS_SPAWN_MIN = 35u while CHASING during the
  // unattended CDP round-trip window before this evaluate — a legitimate
  // contact death (score frozen, "Distance 0u") that killed ~half of runs
  // before the fairness pass and a residual ~1/10 after it. Relocating the
  // bystanders (they despawn+dispose next frame; backwards splice keeps [0]
  // at index 0) leaves exactly one enemy — the killable target — so the
  // payout, not the ambush, decides the test. Intent is unchanged: two
  // rapid kills through the REAL collision branch pay > 2x the single
  // bounty via the combo multiplier.
  const { before, bounty } = await page.evaluate(() => {
    const s = window.__game.state;
    s.playerScale = 35;
    s.player.scale.set(35, 35, 35);
    const enemy = s.enemies[0];
    for (const other of s.enemies) {
      if (other !== enemy) other.position.x = enemy.position.x + 500;
    }
    const bounty = 25 + 5 * Math.floor(1.2 * enemy.scale.y); // KILL_POINTS + SIZE_BOUNTY_PER_UNIT * floor(height)
    const before = s.score;
    s.player.position.set(enemy.position.x, 0, enemy.position.z);
    return { before, bounty };
  });
  // Un-multiplied, this kill pays exactly `bounty` (the only other score
  // source left is the handful of food blocks the kills themselves drop);
  // reaching TWICE the bounty therefore proves the x2 multiplier landed.
  // The combo is read INSIDE the first poll that observes the payout: kills
  // drop food that regrows the giant player until an enemy eventually ends
  // the run, and death resets the combo — a separate post-wait evaluate
  // would race that under parallel-suite load. Polls run every frame; the
  // payout is visible ~90 frames before any such death can occur.
  const handle = await page.waitForFunction(
    ({ before, bounty }) => {
      const s = window.__game.state;
      return s.score >= before + 2 * bounty ? { combo: s.comboCount } : false;
    },
    { before, bounty },
    { timeout: 10000 }
  );
  const { combo } = await handle.jsonValue();
  expect(combo).toBeGreaterThanOrEqual(2); // The multiplier really escalated
});

// --- Exact scoring (plan 027 Step 2) ---
// Deterministic kill choreography, shared by the three exactness cases:
// silence the world (no bodies, no pending discs, no clock death), fix the
// player at scale 3, hang them MID-JUMP over a debug-spawned grunt of a
// FIXED scale, and step the real update. Enemy contact flattens the
// player's collision box to the ground (a hop is never a dodge), so the
// kill fires — but the PICKUP box does not flatten, so the 4 food blocks
// the kill scatters (±1.5u, on the ground) cannot be collected in the same
// frames. The score delta is therefore PURE kill payout: exact assertions,
// not >=. (In-page; returns plain data.)
function killFixedEnemyExactly(page, { enemyScale, seedCombo }) {
  return page.evaluate(({ enemyScale_, seedCombo_ }) => {
    const g = window.__game;
    const s = g.state;
    s.enemies.forEach((e) => s.scene.remove(e));
    s.enemies = [];
    g.debug.clearPendingSpawns();
    s.players.forEach((p) => { p.collectTimeLeft = 900; });
    s.playerScale = 3;
    s.player.scale.set(3, 3, 3);
    g.debug.applySpeedMultiplier();
    if (seedCombo_) {
      s.comboCount = seedCombo_.count;
      s.players[0].comboTimeLeft = seedCombo_.timeLeft;
    }
    const p0 = s.players[0];
    p0.jump.airborne = true;
    p0.jump.offset = 2.5; // Well above the food cubes (top ~0.8), inside the arc
    p0.jump.velocity = 0;
    p0.jump.gravity = 45; // Positive → the locked-arc physics branch
    g.debug.spawnSpecies('grunt', s.player.position.x, s.player.position.z, enemyScale_);
    const before = s.score;
    g.debug.advance(3 / 60); // The contact kill lands on the first stepped frame
    return {
      delta: s.score - before,
      combo: s.comboCount,
      comboTimeLeft: s.players[0].comboTimeLeft,
      chip: document.getElementById('combo-chip').style.display
    };
  }, { enemyScale_: enemyScale, seedCombo_: seedCombo ?? null });
}

test('an isolated kill pays EXACTLY 25 + 5*floor(1.2*scale) (bounty formula, x1)', async ({ page }) => {
  await startGame(page);
  const r = await killFixedEnemyExactly(page, { enemyScale: 2 });
  expect(r.combo).toBe(1); // No prior window → the multiplier is exactly x1
  // KILL_POINTS + SIZE_BOUNTY_PER_UNIT * floor(enemyBaseHeight * scale.y):
  expect(r.delta).toBe(25 + 5 * Math.floor(1.2 * 2)); // === 35, exactly
});

test('combo expiry: advance(4.5) past the 4s window zeroes the combo and hides the chip', async ({ page }) => {
  await startGame(page);
  // Two chained kills so the chip is actually VISIBLE before the expiry.
  const first = await killFixedEnemyExactly(page, { enemyScale: 2 });
  expect(first.combo).toBe(1);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    // Second grunt under the still-airborne player: chained kill → x2.
    g.debug.spawnSpecies('grunt', s.player.position.x, s.player.position.z, 2);
    g.debug.advance(3 / 60);
    const midCombo = s.comboCount;
    const midChip = document.getElementById('combo-chip').style.display;
    const midWindow = s.players[0].comboTimeLeft;
    g.debug.advance(4.5); // COMBO_WINDOW is 4 — the whole window expires in here
    return {
      midCombo,
      midChip,
      midWindow,
      combo: s.comboCount,
      timeLeft: s.players[0].comboTimeLeft,
      chip: document.getElementById('combo-chip').style.display
    };
  });
  expect(r.midCombo).toBe(2); // The chain really escalated...
  expect(r.midChip).toBe('block'); // ...and the chip showed
  expect(r.midWindow).toBeGreaterThan(3.8); // Refreshed to ~4 by the second kill
  expect(r.combo).toBe(0); // Expired on the game clock
  expect(r.timeLeft).toBe(0);
  expect(r.chip).toBe('none'); // timers.js hid the chip with the window
});

test('the combo multiplier caps at x5: a seeded x5 chain stays x5 and pays bounty*5', async ({ page }) => {
  await startGame(page);
  const r = await killFixedEnemyExactly(page, {
    enemyScale: 2,
    seedCombo: { count: 5, timeLeft: 4 } // COMBO_MAX with a live window
  });
  expect(r.combo).toBe(5); // min(5+1, COMBO_MAX) — never x6
  expect(r.delta).toBe((25 + 5 * Math.floor(1.2 * 2)) * 5); // === 175: bounty*5, exactly
  expect(r.comboTimeLeft).toBeGreaterThan(3.8); // The kill refreshed the window
});

test('spawnNewEnemies never grows the horde past the endless cap (12)', async ({ page }) => {
  // The game sits paused on the start overlay, so nothing else mutates the
  // array. Endless spawns are QUEUED as red warn discs first and pending
  // discs reserve cap slots (src/enemies.js spawnNewEnemies); while paused
  // nothing ticks the pipeline, so materialize the queue deterministically
  // with the debug warn-pipeline tick, re-topping between ticks exactly as
  // kills would (plan 017 endless-semantics rewrite; cap is
  // ENDLESS_ENEMY_CAP = 12, not the classic 8).
  const count = await page.evaluate(() => {
    const d = window.__game.debug;
    for (let i = 0; i < 10; i++) d.spawnNewEnemies();
    // 3 game-seconds of ticks covers warn (0.95s) twice over; interleaved
    // spawn calls keep pressure on the cap while slots free up.
    for (let i = 0; i < 60; i++) {
      d.updateSpawnWarnings(0.05);
      if (i % 10 === 0) d.spawnNewEnemies();
    }
    return window.__game.state.enemies.length;
  });
  expect(count).toBeLessThanOrEqual(12); // Never past the endless cap
  expect(count).toBeGreaterThan(8); // ...and it really saturates beyond the classic 8
});

test('player speed grows with size and caps at SPEED_GROWTH_CAP', async ({ page }) => {
  // SPEED_GROWTH_FACTOR = 0.18, SPEED_GROWTH_CAP = 2.2 (constants.js).
  // Scale 5 → factor 1 + 4 * 0.18 = 1.72; scale 20 → 4.42 raw, capped at 2.2.
  const { base, at5, at20 } = await page.evaluate(() => {
    const s = window.__game.state;
    const base = s.actualPlayerSpeed; // scale 1 → factor exactly 1
    s.playerScale = 5;
    window.__game.debug.applySpeedMultiplier();
    const at5 = s.actualPlayerSpeed;
    s.playerScale = 20;
    window.__game.debug.applySpeedMultiplier();
    const at20 = s.actualPlayerSpeed;
    return { base, at5, at20 };
  });
  expect(at5).toBeCloseTo(base * 1.72, 5);
  expect(at20).toBeCloseTo(base * 2.2, 5);
});

test('the score display stays in sync after a kill', async ({ page }) => {
  await killOneEnemy(page);
  // Single evaluate — state and DOM are read in the same JS turn.
  const { score, displayed } = await page.evaluate(() => ({
    score: window.__game.state.score,
    displayed: document.getElementById('score').textContent
  }));
  expect(displayed).toBe(String(score));
});
