import { test, expect } from '@playwright/test';
import { startGame } from './helpers.js';

// Scoring & balance (plan 011): defeating an enemy pays the flat KILL_POINTS
// bounty through the REAL collision path, the enemy population never exceeds
// MAX_ENEMIES, and score writes reach the HUD.

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

test('defeating an enemy pays the 25-point kill bounty', async ({ page }) => {
  await killOneEnemy(page);
  // ≥ 25, not === 25: the giant player may also sweep up food blocks.
  const score = await page.evaluate(() => window.__game.state.score);
  expect(score).toBeGreaterThanOrEqual(25);
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
