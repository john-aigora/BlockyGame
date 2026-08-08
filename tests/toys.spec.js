import { test, expect } from '@playwright/test';
import { openGame, startGame, waitForGameOver, waitGameSeconds } from './helpers.js';
import { PLAYER_COLLIDER_HALF_WIDTH } from '../src/constants.js';

// Toys + polish (owner queue items 4-5 + QA board flag): voxel clouds in
// both skies, the endless Space-jump (rocks hoppable, water never, classic
// Space untouched), and the distance-ranked endless board. Terrain spots
// are scanned live off the DETERMINISTIC seed (TERRAIN_SEED 20260726), so
// every scene below is stable across runs and machines.

const WL = -0.9; // WATER_LEVEL (constants.js)

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
});

async function bootEndless(page) {
  await openGame(page);
  await startGame(page);
}

test('endless sky: seeded clouds stream with the chunk window and recycle through the pool', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  const info0 = await page.evaluate(() => window.__game.debug.cloudInfo());
  // ~0.4 per chunk over the 49-chunk window ≈ 20 expected; 5 is a floor no
  // seeded roll can miss.
  expect(info0.activeEndless).toBeGreaterThanOrEqual(5);
  expect(info0.minY).toBeGreaterThanOrEqual(12);
  expect(info0.maxY).toBeLessThanOrEqual(18);

  // Far hops replace the ENTIRE window each time — maximum cloud churn.
  const hop = async () => {
    await page.evaluate(() => {
      const s = window.__game.state;
      s.player.position.x += 300;
      s.collectTimeLeft = 999;
      for (const e of s.enemies) e.position.x = s.player.position.x - 200;
    });
    await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  };
  await hop(); // Warmup to the pool's high-water mark:
  await hop(); // window-sized cloud populations vary by seed roll,
  await hop(); // so the pool tops out over a few full replacements
  const warm = await page.evaluate(() => ({
    clouds: window.__game.debug.cloudInfo(),
    geometries: window.__game.state.renderer.info.memory.geometries
  }));
  await hop();
  await hop();
  await hop();
  const after = await page.evaluate(() => ({
    clouds: window.__game.debug.cloudInfo(),
    geometries: window.__game.state.renderer.info.memory.geometries
  }));
  expect(after.clouds.activeEndless).toBeGreaterThanOrEqual(5); // The sky travels with you
  // Pool discipline. Allocation is a HIGH-WATER process (each seeded window
  // rolls its own cloud count, and the pool only grows when a window beats
  // every previous one), so the honest claims are: late growth is creep,
  // not one-alloc-per-cloud; ~343 chunk builds streamed ~140 clouds through
  // a pool a fraction of that size; every cloud is accounted for; and the
  // shared-geometry law holds — the renderer never grows.
  expect(after.clouds.allocs - warm.clouds.allocs).toBeLessThanOrEqual(8);
  expect(after.clouds.allocs - after.clouds.classicCount).toBeLessThanOrEqual(40);
  expect(after.clouds.activeEndless + after.clouds.pooled)
    .toBe(after.clouds.allocs - after.clouds.classicCount); // (the classic 8 sit in their own sky)
  expect(after.geometries - warm.geometries).toBeLessThanOrEqual(2);
});

test('Space jumps the player over a rock that blocks the grounded path (endless)', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });

  // Find a seeded boulder near spawn with a clean dry run-line: rock-free
  // approach and landing lanes for the scale-1 collider
  // (PLAYER_COLLIDER_HALF_WIDTH), and no water anywhere on the line — the
  // ONLY blocker is the rock itself.
  const rock = await page.evaluate(([WL_, R_]) => {
    const d = window.__game.debug;
    for (let z = -60; z <= 60; z += 0.5) {
      for (let x = 12; x <= 90; x += 0.5) {
        if (d.isRockFree(x, z, 0)) continue;
        if (d.terrainHeight(x, z) < WL_ + 0.3) continue;
        let x1 = x, x2 = x;
        while (!d.isRockFree(x1 - 0.02, z, 0)) x1 -= 0.02;
        while (!d.isRockFree(x2 + 0.02, z, 0)) x2 += 0.02;
        const w = x2 - x1;
        if (w < 0.9 || w > 1.7) continue; // A substantial chord, small enough to clear
        let clear = true;
        for (let t = 0.7; t <= 3.2 && clear; t += 0.25) {
          if (!d.isWalkable(x1 - t, z, R_) || !d.isWalkable(x2 + t, z, R_)) clear = false;
        }
        if (!clear) continue;
        let dry = true;
        for (let xx = x1 - 3.5; xx <= x2 + 3.5 && dry; xx += 0.2) {
          if (d.terrainHeight(xx, z) < WL_ + 0.05) dry = false;
        }
        if (!dry) continue;
        return { x1, x2, z, w };
      }
    }
    return null;
  }, [WL, PLAYER_COLLIDER_HALF_WIDTH]);
  expect(rock).not.toBeNull();

  // Sterilize and take position 2.2u west of the rock's chord.
  await page.evaluate(({ x1, z }) => {
    const s = window.__game.state;
    s.player.position.x = x1 - 2.2;
    s.player.position.z = z;
    s.collectTimeLeft = 999;
    for (const e of s.enemies) e.position.x = s.player.position.x + 200;
  }, rock);

  // GROUNDED: pushing east pins against the rock — no way through on foot.
  await page.keyboard.down('ArrowRight');
  await waitGameSeconds(page, 1.0);
  const pinned = await page.evaluate(() => window.__game.state.player.position.x);
  await waitGameSeconds(page, 0.5);
  const stillPinned = await page.evaluate(() => window.__game.state.player.position.x);
  expect(pinned).toBeGreaterThan(rock.x1 - 2.0); // Input worked: walked to the rock...
  expect(pinned).toBeLessThan(rock.x1); // ...and the collider honestly blocks
  expect(Math.abs(stillPinned - pinned)).toBeLessThan(0.02); // Pinned for good

  // AIRBORNE: Space + held east = up and over.
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.state.jumpOffset > 0.5, null, { timeout: 15000 }); // Genuinely in the air
  await waitGameSeconds(page, 1.5); // Airtime (0.55 game-s) + the walk-out
  await page.keyboard.up('ArrowRight');
  const after = await page.evaluate(() => {
    const s = window.__game.state;
    return {
      x: s.player.position.x,
      jumpOffset: s.jumpOffset,
      airborne: s.jumpAirborne,
      gameActive: s.gameActive
    };
  });
  expect(after.gameActive).toBe(true);
  expect(after.x).toBeGreaterThan(rock.x2 + 1); // PAST the rock that blocked the grounded path
  expect(after.jumpOffset).toBe(0); // Landed...
  expect(after.airborne).toBe(false); // ...and back under grounded rules
});

test('a jump can never cross water: the arc lands at the shore edge (endless)', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);

  // A shoreline with a lake wider than the whole jump arc (~3.3u) beyond it.
  const shore = await page.evaluate(([WL_]) => {
    const h = window.__game.debug.terrainHeight;
    for (let zi = 0; zi <= 12; zi++) {
      for (const z of zi === 0 ? [0] : [zi * 8, -zi * 8]) {
        for (let x = 52; x <= 800; x += 0.5) {
          if (h(x, z) < WL_ - 0.1 &&
              h(x - 2, z) >= WL_ + 0.12 && h(x - 3.5, z) >= WL_ + 0.12 &&
              h(x + 1, z) < WL_ - 0.05 && h(x + 2, z) < WL_ - 0.1 &&
              h(x + 3, z) < WL_ - 0.05 && h(x + 4, z) < WL_ - 0.1 &&
              h(x + 5, z) < WL_ - 0.05) {
            return { x, z };
          }
        }
      }
    }
    return null;
  }, [WL]);
  expect(shore).not.toBeNull();

  await page.evaluate(({ x, z }) => {
    const s = window.__game.state;
    s.player.position.x = x - 5;
    s.player.position.z = z;
    s.collectTimeLeft = 999;
    for (const e of s.enemies) e.position.x = s.player.position.x + 200;
  }, shore);
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  // A boulder on the beach must not fake the result — start where the walk
  // to the shore is clean (same settle pattern as the water-impassability spec).
  const start = await page.evaluate(([{ x, z }, R_]) => {
    const g = window.__game;
    for (let sx = x - 3.5; sx >= x - 10; sx -= 0.25) {
      if (g.debug.isWalkable(sx, z, R_) && g.debug.isWalkable(sx + 1, z, R_)) {
        g.state.player.position.x = sx;
        return { x: sx };
      }
    }
    return null;
  }, [shore, PLAYER_COLLIDER_HALF_WIDTH]);
  expect(start).not.toBeNull();

  // Walk to the waterline, then JUMP straight at the lake, still holding east.
  await page.keyboard.down('ArrowRight');
  await waitGameSeconds(page, 2);
  const pinnedX = await page.evaluate(() => window.__game.state.player.position.x);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.state.jumpOffset > 0.5, null, { timeout: 15000 });
  await waitGameSeconds(page, 1.2); // Well past the 0.55 game-s airtime
  await page.keyboard.up('ArrowRight');
  const after = await page.evaluate(() => {
    const g = window.__game;
    const p = g.state.player.position;
    return {
      x: p.x,
      jumpOffset: g.state.jumpOffset,
      ground: g.debug.groundHeightAt(p.x, p.z),
      gameActive: g.state.gameActive
    };
  });
  expect(after.gameActive).toBe(true);
  expect(after.jumpOffset).toBe(0); // The arc is over...
  expect(after.x).toBeGreaterThan(start.x + 0.5); // ...the approach really happened...
  expect(after.x).toBeLessThan(shore.x + 0.1); // ...and the lake was never crossed
  expect(Math.abs(after.x - pinnedX)).toBeLessThan(0.6); // Landed AT the shore edge, like a blocked move
  expect(after.ground).toBeGreaterThanOrEqual(WL); // Standing dry
});

test('the landing-grace ring cannot be walked through a boulder (C-6)', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
  // Find a seeded rock and a DIAGONAL spot inside the old inflated grace
  // ring: center closer than rockEdge + 0.54 (so the OLD rule said "wedged,
  // ignore rocks") while all five radius-0 probe points are clear (so the
  // body is honestly outside — the new probe-parity rule keeps rocks
  // solid). On the old code this exact band walked straight through
  // boulders.
  const spot = await page.evaluate(([WL_, R]) => {
    const d = window.__game.debug; // R = scale-1 player collider half-width (imported constant)
    for (let z = -60; z <= 60; z += 0.5) {
      for (let x = 12; x <= 90; x += 0.5) {
        if (d.isRockFree(x, z, 0)) continue; // (x,z) is inside some rock circle
        if (d.terrainHeight(x, z) < WL_ + 0.3) continue;
        // Chord-march both axes to locate the circle center.
        let e1 = x, w1 = x;
        while (!d.isRockFree(e1 + 0.02, z, 0)) e1 += 0.02;
        while (!d.isRockFree(w1 - 0.02, z, 0)) w1 -= 0.02;
        const cx = (e1 + w1) / 2;
        let n1 = z, s1 = z;
        while (!d.isRockFree(cx, s1 + 0.02, 0)) s1 += 0.02;
        while (!d.isRockFree(cx, n1 - 0.02, 0)) n1 -= 0.02;
        const cz = (n1 + s1) / 2;
        const rockR = Math.max((e1 - w1) / 2, (s1 - n1) / 2);
        // Big rocks only: the mid-walk assert below samples at 1.5-1.8u of
        // travel from d = rockR + 0.4, i.e. 0.35-0.65u past the center — a
        // circle with rockR ≥ 0.75 provably still contains that point, so
        // the OLD walk-through code cannot slip out the far side unseen.
        if (rockR < 0.75) continue;
        // Diagonal candidate inside the old ring: d = rockR + 0.4 < rockR + R.
        const dd = rockR + 0.4;
        const px = cx + dd * Math.SQRT1_2;
        const pz = cz + dd * Math.SQRT1_2;
        const probesClear = d.isRockFree(px, pz, 0) &&
          d.isRockFree(px + R, pz, 0) && d.isRockFree(px - R, pz, 0) &&
          d.isRockFree(px, pz + R, 0) && d.isRockFree(px, pz - R, 0);
        if (!probesClear) continue;
        // Dry footing for the spot and the short walk.
        if (d.terrainHeight(px, pz) < WL_ + 0.1) continue;
        if (d.terrainHeight(cx, cz) < WL_ + 0.1) continue;
        return { px, pz, cx, cz, rockR };
      }
    }
    return null;
  }, [WL, PLAYER_COLLIDER_HALF_WIDTH]);
  expect(spot).not.toBeNull();

  await page.evaluate(({ px, pz }) => {
    const s = window.__game.state;
    s.player.position.x = px;
    s.player.position.z = pz;
    s.collectTimeLeft = 999;
    for (const e of s.enemies) e.position.x = s.player.position.x + 200;
  }, spot);
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });

  // Walk diagonally STRAIGHT AT the rock center and sample at EXACTLY
  // 0.25 game-s (+≤1 frame) INSIDE the poll predicate — ~1.5-1.8u of
  // travel, provably inside the circle on the old walk-through code (see
  // the rockR ≥ 0.75 bound above), before any keyup latency can carry the
  // player out the far side. The honest movement probes must keep the
  // player's CENTER outside the collision circle at all times.
  const t0 = await page.evaluate(() => window.__game.state.runTime);
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('ArrowUp');
  const handle = await page.waitForFunction(([tt]) => {
    const g = window.__game;
    const s = g.state;
    if (s.runTime < tt + 0.25) return false;
    const p = s.player.position;
    return {
      centerClear: g.debug.isRockFree(p.x, p.z, 0),
      gameActive: s.gameActive
    };
  }, [t0], { timeout: 60000 });
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('ArrowUp');
  const after = await handle.jsonValue();
  expect(after.gameActive).toBe(true);
  expect(after.centerClear).toBe(true); // Never inside the boulder — no walk-through
});

test('endless jumps on Space and pauses on P', async ({ page }) => {
  await bootEndless(page);
  await page.keyboard.press('Space');
  const jumped = await page.evaluate(() => ({
    airborne: window.__game.state.jumpAirborne,
    isPaused: window.__game.state.isPaused
  }));
  expect(jumped.airborne).toBe(true); // Space jumped...
  expect(jumped.isPaused).toBe(false); // ...and did NOT pause
  // P owns pause in endless; Space while paused neither hops nor resumes.
  await page.keyboard.press('p');
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(true);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(true);
  await page.keyboard.press('p');
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(false);
});

test('the endless board ranks by distance (score per row) and re-ranks stored lists on read', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('blocky.worldMode', 'endless');
    // Stored under the OLD score-ranked order: the far 500u run sits below
    // the rich 50u run. The distance rule must flip them on read.
    localStorage.setItem('blocky.hiscores.endless.v1', JSON.stringify([
      { score: 100, distance: 50, date: '2026-01-01' },
      { score: 10, distance: 500, date: '2026-01-02' }
    ]));
  });
  await openGame(page);
  await startGame(page);

  // A 200u run that dies broke: mid-table by distance despite 0 points.
  await page.evaluate(() => { window.__game.state.player.position.x += 200; });
  await waitGameSeconds(page, 0.3);
  await page.evaluate(() => { window.__game.state.collectTimeLeft = 0.05; });
  await waitForGameOver(page);

  const rows = page.locator('#hiscore-slot .hiscore-list li');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('500u — 10 pts'); // Furthest first, score shown
  await expect(rows.nth(1)).toContainText('200u — 0 pts'); // The new run, ranked by distance
  await expect(rows.nth(1)).toHaveClass(/is-new/);
  await expect(rows.nth(2)).toContainText('50u — 100 pts'); // Rich but short: last
  await expect(page.locator('#hiscore-slot .hiscore-badge')).toHaveCount(0); // Rank 1 is no NEW BEST

  const stored = await page.evaluate(() => ({
    endless: JSON.parse(localStorage.getItem('blocky.hiscores.endless.v1')),
    classic: localStorage.getItem('blocky.hiscores.v1')
  }));
  expect(stored.endless.map((e) => e.distance)).toEqual([500, 200, 50]); // Persisted re-ranked
  expect(stored.classic).toBeNull(); // The classic board never heard about any of this
});
