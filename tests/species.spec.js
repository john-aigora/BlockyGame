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
