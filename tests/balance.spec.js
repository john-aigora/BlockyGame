import { test, expect } from '@playwright/test';
import { startGame } from './helpers.js';

// Scoring & balance (plan 011 + score-juice pass): defeating an enemy pays
// at least the KILL_POINTS bounty through the REAL collision path (the size
// bounty only adds), chained kills multiply the payout via the combo, the
// enemy population never exceeds MAX_ENEMIES, and score writes reach the HUD.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1);
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
  await page.waitForFunction(() => window.__game.state.score >= 25, null, { timeout: 2000 });
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
  await page.waitForFunction(() => window.__game.state.score >= 25, null, { timeout: 2000 });

  // Second kill inside the 4s combo window: grow just past the fresh spawns
  // (height 30) and land on one. 35 — not huge — keeps the wave spawned by
  // THIS kill (height 52.5, 80 units out) clear of the player's own AABB,
  // so the run survives and the combo state stays readable afterwards.
  const { before, bounty } = await page.evaluate(() => {
    const s = window.__game.state;
    s.playerScale = 35;
    s.player.scale.set(35, 35, 35);
    const enemy = s.enemies[0];
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
    { timeout: 2000 }
  );
  const { combo } = await handle.jsonValue();
  expect(combo).toBeGreaterThanOrEqual(2); // The multiplier really escalated
});

test('spawnNewEnemies never grows the horde past 8', async ({ page }) => {
  // The game sits paused on the start overlay, so nothing else mutates the
  // array: 1 boot enemy + 2 per call, saturating exactly at the cap.
  const count = await page.evaluate(() => {
    for (let i = 0; i < 10; i++) window.__game.debug.spawnNewEnemies();
    return window.__game.state.enemies.length;
  });
  expect(count).toBe(8);
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
