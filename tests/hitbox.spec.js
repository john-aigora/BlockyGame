import { test, expect } from '@playwright/test';
import { openGame, startGame, waitGameSeconds } from './helpers.js';

// Fairness pass (plan 019, audit C-1 + C-2): the frame stops with the run
// (no dead-run score writes), and gameplay collides the BODY BLOCK — not
// the render tree of tails, scarves, outlines, and face parts. Body-box
// numbers below derive from constants.js: PLAYER_COLLIDER_HALF_WIDTH 0.54,
// ENEMY_COLLIDER_HALF_WIDTH 0.6, enemyBaseHeight 1.2.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
  await openGame(page);
});

// Boots a run with the player at the given scale, no food on the board
// (kills of opportunity must not grow the player mid-choreography), and the
// boot enemy fully materialized (0.5s pipeline) so it collides for real.
async function bootScaled(page, scale) {
  await page.evaluate(([s_]) => {
    const s = window.__game.state;
    s.playerScale = s_;
    s.player.scale.set(s_, s_, s_);
    s.collectibles.forEach((c) => s.scene.remove(c));
    s.collectibles = [];
  }, [scale]);
  await startGame(page);
  await waitGameSeconds(page, 0.7);
}

test('same-frame death records what the HUD shows', async ({ page }) => {
  // Player kills the boot enemy on contact (height 2 > 1.5) but cannot
  // reach it from spawn — contact exists only after the teleport below.
  await bootScaled(page, 2);
  // Same-frame trap (C-1): the collect clock expires on the NEXT frame
  // while a killable enemy overlaps the player. Without the dead-run guard,
  // updateEnemies still ran after endGame had already recorded the board
  // entry, paid the kill bounty on a dead run, and the death screen's HUD
  // showed more than the board stored.
  await page.evaluate(() => {
    const s = window.__game.state;
    const enemy = s.enemies[0];
    s.player.position.set(enemy.position.x, 0, enemy.position.z);
    s.collectTimeLeft = 0.001; // Expires on any real frame dt
  });
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 30000 });
  const { displayed, stored } = await page.evaluate(() => ({
    displayed: document.getElementById('final-score').textContent,
    stored: JSON.parse(localStorage.getItem('blocky.hiscores.endless.v1'))
  }));
  expect(stored.length).toBe(1); // Fresh context — this run is the only entry
  expect(String(stored[0].score)).toBe(displayed); // Board score === HUD score
});

test('tail-region overlap is decoration, not contact: no kill through the render tree', async ({ page }) => {
  await bootScaled(page, 4);
  // Geometry: player half-width 0.54·4 = 2.16, enemy half-width 0.6·2 = 1.2
  // → body contact needs |dz| < 3.36. At dz = +4 the body blocks sit 0.64
  // apart — but the old render-tree union reached across: the enemy's tail
  // extends 1.044·2 ≈ 2.09 toward the player and the player's front face
  // parts extend ≈ 0.66·4 = 2.64 toward the enemy (2.09 + 2.64 > 4), a
  // phantom kill through pure decoration.
  const before = await page.evaluate(() => {
    const s = window.__game.state;
    const e = s.enemies[0];
    e.scale.setScalar(2); // Height 2.4 < player 4 → killable prey
    e.position.set(s.player.position.x, e.position.y, s.player.position.z + 4);
    e.randomVelocity.set(0, 0, 0);
    e.timeToChangeRandomVelocity = 999; // Hold the drift at zero
    return { score: s.score, enemies: s.enemies.length };
  });
  await waitGameSeconds(page, 0.4); // Prey flees +z — separation only grows
  const after = await page.evaluate(() => ({
    score: window.__game.state.score,
    enemies: window.__game.state.enemies.length,
    gameActive: window.__game.state.gameActive
  }));
  expect(after.gameActive).toBe(true);
  expect(after.score).toBe(before.score); // No phantom kill fired
  expect(after.enemies).toBeGreaterThanOrEqual(before.enemies); // The prey survived
});

test('body-to-body contact kills exactly as it looks', async ({ page }) => {
  await bootScaled(page, 4);
  // dz = 3.0 < 3.36: the body blocks genuinely overlap — the same scene as
  // the tail test, 1 unit closer, must pay the bounty.
  const before = await page.evaluate(() => {
    const s = window.__game.state;
    const e = s.enemies[0];
    e.scale.setScalar(2); // Height 2.4 → bounty 25 + 5·floor(2.4) = 35
    e.position.set(s.player.position.x, e.position.y, s.player.position.z + 3.0);
    return { score: s.score };
  });
  await page.waitForFunction(
    ([threshold]) => window.__game.state.score >= threshold,
    [before.score + 35],
    { timeout: 10000 }
  );
  expect(await page.evaluate(() => window.__game.state.gameActive)).toBe(true);
});

test('the airborne flatten rule survives: a jump never dodges a kill', async ({ page }) => {
  await bootScaled(page, 4);
  // Stage the prey out of reach, jump, then slide it under the player at
  // apex. The player box is built from the body block but stretched back
  // down to the ground while airborne (jumpOffset), so contact resolves
  // MID-AIR — jump apex at scale 4 (≈ 3.8) clears the enemy's 2.4 height,
  // and without the flatten rule this kill would wait for touchdown.
  await page.evaluate(() => {
    const s = window.__game.state;
    const e = s.enemies[0];
    e.scale.setScalar(2);
    e.position.set(s.player.position.x, e.position.y, s.player.position.z + 8);
    e.randomVelocity.set(0, 0, 0);
    e.timeToChangeRandomVelocity = 999;
  });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.state.jumpOffset > 2.6, null, { timeout: 15000 });
  const before = await page.evaluate(() => {
    const s = window.__game.state;
    const e = s.enemies[0];
    e.position.set(s.player.position.x, e.position.y, s.player.position.z + 3.0);
    return { score: s.score };
  });
  const handle = await page.waitForFunction(
    ([threshold]) => {
      const s = window.__game.state;
      return s.score >= threshold ? { airborne: s.jumpAirborne } : false;
    },
    [before.score + 35],
    { timeout: 10000 }
  );
  const { airborne } = await handle.jsonValue();
  expect(airborne).toBe(true); // The bounty landed while still in the air
});
