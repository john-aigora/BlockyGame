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
