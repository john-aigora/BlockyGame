import { test, expect } from '@playwright/test';
import { openGame, startGame, waitForGameOver, waitGameSeconds, bootEndless } from './helpers.js';

// Endless world, stage 2 (gameplay streaming): water/rock impassability,
// the per-chunk food + monster-bubble streaming (with resource plateau),
// the distance HUD + difficulty ramp, and endless hiscore isolation.
// Everything opts into endless via the real UI (mode picker or the
// persisted preference); the classic suites are untouched.

const WL = -0.9; // WATER_LEVEL (constants.js) — inlined for in-page scans

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
});

test('water is impassable: neither the player nor a chasing enemy ever crosses a lake', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);

  // Find a real pond on the seeded terrain: a shoreline crossing at some
  // (x, z) with solid land behind, a chunky body of water ahead (wide in x
  // AND z), and a far shore within enemy-bubble range. Pure math — the
  // terrain is deterministic, so this scan is stable across runs.
  const shore = await page.evaluate((WL_) => {
    const h = window.__game.debug.terrainHeight;
    for (let zi = 0; zi <= 12; zi++) {
      for (const z of zi === 0 ? [0] : [zi * 8, -zi * 8]) {
        for (let x = 52; x <= 800; x += 0.5) {
          if (h(x, z) < WL_ - 0.1 &&
              h(x - 2, z) >= WL_ + 0.12 && h(x - 3.5, z) >= WL_ + 0.12 &&
              h(x + 2, z) < WL_ - 0.1 && h(x + 4, z) < WL_ - 0.1 &&
              h(x + 2, z - 3) < WL_ - 0.05 && h(x + 2, z + 3) < WL_ - 0.05) {
            for (let fx = x + 6; fx <= x + 45; fx += 0.5) {
              if (h(fx, z) >= WL_ + 0.15 && h(fx + 1.5, z) >= WL_ + 0.15) {
                return { x, z, farX: fx + 1.5 };
              }
            }
          }
        }
      }
    }
    return null;
  }, WL);
  expect(shore).not.toBeNull();

  // Teleport to the near shore and let the chunk window build there, then
  // settle on a start point with a rock-free first step (isWalkable sees
  // rocks only once chunks exist, hence the wait).
  await page.evaluate(({ x, z }) => {
    const s = window.__game.state;
    s.player.position.x = x - 5;
    s.player.position.z = z;
    s.collectTimeLeft = 60; // No collect-death during this scripted scene
  }, shore);
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  const start = await page.evaluate(({ x, z }) => {
    const g = window.__game;
    for (let sx = x - 3.5; sx >= x - 10; sx -= 0.25) {
      if (g.debug.isWalkable(sx, z, 0.45) && g.debug.isWalkable(sx + 1, z, 0.45)) {
        g.state.player.position.x = sx;
        return { x: sx };
      }
    }
    return null;
  }, shore);
  expect(start).not.toBeNull();

  // Push straight at the water for 3 game seconds (9u at base speed —
  // deep into the lake if impassability were broken).
  await page.keyboard.down('ArrowRight');
  await waitGameSeconds(page, 3);
  await page.keyboard.up('ArrowRight');
  const after = await page.evaluate(() => {
    const g = window.__game;
    const p = g.state.player.position;
    return { x: p.x, z: p.z, ground: g.debug.groundHeightAt(p.x, p.z) };
  });
  expect(after.x).toBeGreaterThan(start.x + 0.5); // Input worked: walked to the shore...
  expect(after.x).toBeLessThan(shore.x + 0.1); // ...and stopped AT it, not past it
  expect(Math.abs(after.z - shore.z)).toBeLessThan(1e-6); // Pure +x input: the slide never invents z drift
  expect(after.ground).toBeGreaterThanOrEqual(WL + 0.049); // Standing on land, never on lakebed

  // NO SHORE JITTER: keep pushing at the water and frame-sample the pinned
  // player — a blocked axis is never written, so the position must hold
  // rock-still (no oscillation across the walkability boundary).
  const jitter = await page.evaluate(() => new Promise((resolve) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    const p = window.__game.state.player.position;
    const xs = [];
    const tick = () => {
      xs.push(p.x);
      if (xs.length < 45) { requestAnimationFrame(tick); return; }
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
      resolve({
        range: Math.max(...xs) - Math.min(...xs),
        zNow: p.z
      });
    };
    requestAnimationFrame(tick);
  }));
  expect(jitter.range).toBeLessThan(0.02); // Pinned: no back-and-forth at the boundary
  expect(Math.abs(jitter.zNow - shore.z)).toBeLessThan(1e-6);

  // Enemy side: park a hunter on the FAR shore so its chase line crosses
  // the lake. The axis-slide must hold it on land (sliding or detouring
  // along the shore), never wading. The old boot enemy despawned when we
  // teleported (>80u — that's stage 2 working); wait for the bubble to
  // provide a formed one.
  await page.waitForFunction(
    () => window.__game.state.enemies.some((e) => e.userData.materializing === undefined),
    null, { timeout: 30000 }
  );
  await page.evaluate(({ farX, z }) => {
    const g = window.__game;
    const enemy = g.state.enemies.find((e) => e.userData.materializing === undefined);
    enemy.userData.testTag = true;
    enemy.position.set(farX + 1, g.debug.groundHeightAt(farX + 1, z), z);
  }, shore);
  await waitGameSeconds(page, 3.5);
  const enemyCheck = await page.evaluate((WL_) => {
    const g = window.__game;
    const tagged = g.state.enemies.find((e) => e.userData.testTag);
    return {
      gameActive: g.state.gameActive,
      taggedAlive: !!tagged,
      allOnLand: g.state.enemies.every((e) =>
        g.debug.groundHeightAt(e.position.x, e.position.z) >= WL_ + 0.02)
    };
  }, WL);
  expect(enemyCheck.gameActive).toBe(true);
  expect(enemyCheck.taggedAlive).toBe(true); // Within the bubble — never despawned
  expect(enemyCheck.allOnLand).toBe(true); // Nobody in the whole bubble ever stands on water
});

test('a 400u walk: flat resource plateau, bounded ramped enemy bubble, land-only food', async ({ page }) => {
  test.setTimeout(240000);
  await bootEndless(page);

  // Scripted walk: 10u hops, letting the build queue drain between hops.
  // The collect clock is topped up per hop — this scene tests streaming,
  // not starvation — and any hunter near the landing spot is expelled to
  // beyond the despawn ring: under parallel-suite load the waits stretch,
  // pursuers converge, and a hop could otherwise land INSIDE one (instant
  // death, frozen game clock). Expelling ALSO maximizes the despawn/spawn
  // churn this plateau test exists to measure.
  const hop = async (count) => {
    for (let i = 0; i < count; i++) {
      await page.evaluate(() => {
        const s = window.__game.state;
        s.player.position.x += 10;
        s.collectTimeLeft = 15;
        for (const e of s.enemies) {
          const dx = e.position.x - s.player.position.x;
          const dz = e.position.z - s.player.position.z;
          if (Math.hypot(dx, dz) < 15) {
            e.position.x = s.player.position.x - 90; // Past ENEMY_DESPAWN_RADIUS
            e.position.z = s.player.position.z;
          }
        }
      });
      await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
    }
  };

  await hop(10); // Warmup to ~100u: pools reach their hop-pattern high-water mark
  await waitGameSeconds(page, 1);
  const before = await page.evaluate(() => ({
    geometries: window.__game.state.renderer.info.memory.geometries,
    textures: window.__game.state.renderer.info.memory.textures
  }));

  await hop(30); // The measured 300u: chunks, rocks, food, and enemies all churn
  await waitGameSeconds(page, 2); // Let the bubble top back up at the destination
  const after = await page.evaluate(() => ({
    geometries: window.__game.state.renderer.info.memory.geometries,
    textures: window.__game.state.renderer.info.memory.textures,
    gameActive: window.__game.state.gameActive,
    enemies: window.__game.state.enemies.length,
    maxEnemyScale: Math.max(...window.__game.state.enemies.map(
      (e) => e.userData.materializeTarget ?? e.scale.y)),
    food: window.__game.state.collectibles.length,
    rampLevel: window.__game.state.endlessRampLevel,
    furthest: window.__game.state.furthestDistance,
    hudDistance: Number(document.getElementById('distance').textContent),
    hudVisible: getComputedStyle(document.getElementById('distance-display')).display !== 'none',
    foodOnLand: window.__game.state.collectibles.every((c) =>
      window.__game.debug.groundHeightAt(c.position.x, c.position.z) >= -0.9 + 0.15)
  }));

  expect(after.gameActive).toBe(true); // The whole walk survived (assertions below aren't vacuous)
  // DISPOSE DISCIPLINE: 300 units of full-system churn allocates nothing.
  expect(after.geometries - before.geometries).toBeLessThanOrEqual(4);
  expect(after.textures - before.textures).toBeLessThanOrEqual(1);
  // Monster bubble: populated but bounded by the ramped cap.
  expect(after.enemies).toBeGreaterThanOrEqual(1);
  expect(after.enemies).toBeLessThanOrEqual(12);
  // Difficulty ramp at ~400u: level 2, and the bubble's fresh spawns wear
  // the +40% height (player 1.0 -> target scale ~1.75 vs the 1.25 base).
  expect(after.rampLevel).toBe(Math.floor(after.furthest / 150));
  expect(after.rampLevel).toBeGreaterThanOrEqual(2);
  expect(after.maxEnemyScale).toBeGreaterThanOrEqual(1.7);
  // Food streams with the chunks: plentiful at the destination, all dry.
  expect(after.food).toBeGreaterThan(30);
  expect(after.foodOnLand).toBe(true);
  // DISTANCE HUD: visible and tracking the furthest true distance.
  expect(after.hudVisible).toBe(true);
  expect(after.hudDistance).toBeGreaterThanOrEqual(390);
});

test('endless deaths record distance under their own key; the classic board is untouched', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('blocky.hiscores.v1', JSON.stringify([{ score: 50, date: '2026-01-01' }]));
  });
  await openGame(page);
  await startGame(page);
  await expect(page.locator('#distance-display')).toBeVisible();

  // March the run 120u out, then let the collect clock expire.
  await page.evaluate(() => { window.__game.state.player.position.x += 120; });
  await waitGameSeconds(page, 0.3);
  await expect(page.locator('#distance')).toHaveText('120');
  await page.evaluate(() => { window.__game.state.collectTimeLeft = 0.05; });
  await waitForGameOver(page);

  // Death screen: the endless stat line and the per-row distance.
  await expect(page.locator('#final-distance-line')).toBeVisible();
  await expect(page.locator('#final-distance')).toHaveText('120');
  await expect(page.locator('#hiscore-slot .hiscore-list li').first()).toContainText('120u');

  const storage = await page.evaluate(() => ({
    endless: JSON.parse(localStorage.getItem('blocky.hiscores.endless.v1')),
    classic: JSON.parse(localStorage.getItem('blocky.hiscores.v1'))
  }));
  expect(storage.endless.length).toBe(1);
  expect(storage.endless[0].score).toBe(0);
  expect(storage.endless[0].distance).toBe(120);
  expect(storage.classic).toEqual([{ score: 50, date: '2026-01-01' }]); // Isolated
});

test('the hunt works in endless: flee flip, kill, bounty, and combo state', async ({ page }) => {
  await bootEndless(page);
  await waitGameSeconds(page, 1); // Boot enemy finishes materializing
  // Tower over everything: every enemy flips killable (and flees).
  await page.evaluate(() => {
    const s = window.__game.state;
    s.playerScale = 5;
    s.player.scale.set(5, 5, 5);
    s.collectTimeLeft = 30;
  });
  await waitGameSeconds(page, 0.2);
  // Every enemy SHORTER than the giant player flips killable (bubble
  // spawns arriving after the scale-up are sized to the new player and
  // rightly stay hunters — only the pre-existing small ones must flee).
  const flipped = await page.evaluate(() => {
    const small = window.__game.state.enemies.filter((e) =>
      (e.userData.materializeTarget ?? e.scale.y) * 1.2 < 5);
    return { count: small.length, allKillable: small.every((e) => e.userData.killable === true) };
  });
  expect(flipped.count).toBeGreaterThanOrEqual(1);
  expect(flipped.allKillable).toBe(true);

  // Feed a fleeing enemy to the player: the kill pays the size bounty and
  // opens the combo window.
  await page.evaluate(() => {
    const s = window.__game.state;
    const enemy = s.enemies.find((e) =>
      e.userData.materializing === undefined && e.userData.killable === true);
    enemy.position.set(s.player.position.x, s.player.position.y, s.player.position.z);
  });
  await waitGameSeconds(page, 0.5);
  const result = await page.evaluate(() => ({
    score: window.__game.state.score,
    comboCount: window.__game.state.comboCount,
    gameActive: window.__game.state.gameActive,
    collectTicking: window.__game.state.collectTimeLeft < 30
  }));
  expect(result.gameActive).toBe(true); // A killable contact is a kill, never a death
  expect(result.score).toBeGreaterThanOrEqual(25); // KILL_POINTS + size bounty
  expect(result.comboCount).toBeGreaterThanOrEqual(1);
  expect(result.collectTicking).toBe(true); // The collect pressure runs in endless too
});

test('the full 8-slot spawn rotation is pinned: prey→giant→peer→giant→sprinter→giant→juja→peer', async ({ page }) => {
  // Deterministic on the paused start overlay (nothing else schedules):
  // schedule one bubble spawn per slot, classify it, then CLEAR the pending
  // queue so the threat gate can never close mid-rotation (pending giants
  // count as threats — that gate has its own spec in species.spec.js). The
  // rotation counter only advances on a REAL schedule, so the recorded
  // sequence is exactly SPAWN_SIZE_PATTERN from slot 0 (plan 024's 8-band
  // pattern; plan 027 Step 2 pins the ORDER, not just the mix).
  await openGame(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const d = g.debug;
    const s = g.state;
    s.enemies.forEach((e) => s.scene.remove(e));
    s.enemies = [];
    d.clearPendingSpawns();
    d.resetEnemyStreaming(); // Rotation restarts at slot 0
    const out = [];
    for (let i = 0; i < 8; i++) {
      let info = [];
      // A slot may fail all 10 placement rolls into water (does NOT advance
      // the rotation) — retry the tick until the schedule lands.
      for (let guard = 0; guard < 25 && info.length === 0; guard++) {
        d.updateEnemyStreaming(5); // Big dt clears the cooldown; schedules ONE
        info = d.pendingSpawnInfo();
      }
      if (info.length !== 1) return { failedAt: i, out };
      out.push({
        species: info[0].species,
        // Scaled body height vs the player's height — the band currency.
        ratio: (1.2 * info[0].scaleFactor) / s.playerScale
      });
      d.clearPendingSpawns();
    }
    return { out };
  });
  expect(r.failedAt).toBeUndefined();
  expect(r.out.map((o) => o.species)).toEqual(
    ['grunt', 'grunt', 'grunt', 'grunt', 'sprinter', 'grunt', 'juja', 'grunt']);
  const [prey, giant1, peer1, giant2, sprinter, giant3, juja, peer2] = r.out.map((o) => o.ratio);
  expect(prey).toBeGreaterThanOrEqual(0.55); // PREY_HEIGHT_RANGE
  expect(prey).toBeLessThanOrEqual(0.85);
  for (const giant of [giant1, giant2, giant3]) {
    expect(giant).toBeCloseTo(1.5, 9); // The exact classic giant rule (ramp 0)
  }
  for (const peer of [peer1, peer2]) {
    expect(peer).toBeGreaterThanOrEqual(0.95); // PEER_HEIGHT_RANGE
    expect(peer).toBeLessThanOrEqual(1.25);
  }
  expect(sprinter).toBeGreaterThanOrEqual(0.5); // SPRINTER_HEIGHT_RANGE
  expect(sprinter).toBeLessThanOrEqual(0.7);
  expect(juja).toBeCloseTo(0.35, 9); // JUJA_HEIGHT_FACTOR — fixed critter size
});

test('bubble spawns rotate size bands: prey appears, not only giants', async ({ page }) => {
  await bootEndless(page);
  const heights = await page.evaluate(() => {
    const d = window.__game.debug;
    const s = window.__game.state;
    // Teleport far: the next streaming tick despawns the whole old bubble
    // (beyond the 80u ring), freeing every slot under the bubble target so
    // the rotation can be observed from a clean slate.
    s.player.position.x += 500;
    d.updateEnemyStreaming(0); // Despawn pass (no spawn — cooldown untouched)
    d.resetEnemyStreaming(); // Band rotation restarts at 'prey'
    let tries = 0;
    while (s.enemies.length < 3 && tries < 40) {
      d.updateEnemyStreaming(5); // Big dt clears the cooldown each call
      // The streaming tick only QUEUES a warn disc now (0.95s red warn
      // before materializing — src/enemies.js); tick the warn pipeline
      // 2.0 game-seconds so the queued spawn lands in state.enemies
      // (plan 017 endless-semantics rewrite).
      for (let i = 0; i < 40; i++) d.updateSpawnWarnings(0.05);
      tries++;
    }
    // Scaled BODY height of each spawn vs the player's height — read the
    // materialize TARGET (fresh spawns animate up from 5% of full size).
    return s.enemies.map((e) => (e.userData.materializeTarget ?? e.scale.y) * 1.2 / s.playerScale);
  });
  expect(heights.length).toBeGreaterThanOrEqual(3);
  // The rotation guarantees at least one prey (shorter than the player)
  // and at least one giant (taller) among any three consecutive spawns.
  expect(Math.min(...heights)).toBeLessThan(1);
  expect(Math.max(...heights)).toBeGreaterThan(1);
});
