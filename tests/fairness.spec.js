import { test, expect } from '@playwright/test';
import { openGame, startGame, waitGameSeconds } from './helpers.js';
import { PLAYER_COLLIDER_HALF_WIDTH, ENEMY_COLLIDER_HALF_WIDTH } from '../src/constants.js';

// Fairness pass (owner playtest, escalated): honest collision — "respect
// the size of the gap and the size of the player's block" — plus the F
// speed key and the lake-aware panic arrow. All terrain spots below were
// found by scanning the DETERMINISTIC seeded terrain (TERRAIN_SEED
// 20260726) — they are stable across runs and machines.

const WL = -0.9; // WATER_LEVEL (constants.js)
const MARGIN = 0.02; // WATER_WALK_MARGIN (constants.js)

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => { throw new Error(`Page error: ${err.message}`); });
});

async function bootEndless(page) {
  await openGame(page);
  await startGame(page);
}

// Teleport, wait for the chunk window to build, and sterilize the scene
// (no collect-death, no hunters near the scripted path).
async function teleportSafe(page, x, z) {
  await page.evaluate(([x_, z_]) => {
    const s = window.__game.state;
    s.player.position.x = x_;
    s.player.position.z = z_;
    s.collectTimeLeft = 999;
    for (const e of s.enemies) e.position.x = s.player.position.x + 200;
  }, [x, z]);
  await page.waitForFunction(() => window.__game.debug.terrainInfo().queued === 0, null, { timeout: 30000 });
}

test('honest gaps: width is respected to ±epsilon and a visually-dry crossing is walkable', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);

  // --- Gap-width epsilon: a real seeded land corridor (x=121, z≈-9)
  // between blocked flanks. The honest rule is gapWidth >= 2×radius, so a
  // collider of halfWidth = W/2 - eps fits and W/2 + eps does not.
  await teleportSafe(page, 121, -9);
  const gap = await page.evaluate(([WL_, M_]) => {
    const d = window.__game.debug;
    const xd = 121.2; // The probe destination column
    const dry = (zz) => d.terrainHeight(xd, zz) >= WL_ + M_;
    // Fine contour walk from the corridor mid-line out to both edges
    let z1 = -9.04, z2 = -9.04;
    while (-9.04 - z1 < 2 && dry(z1 - 0.01)) z1 -= 0.01;
    while (z2 + 9.04 < 2 && dry(z2 + 0.01)) z2 += 0.01;
    const w = z2 - z1;
    const zm = (z1 + z2) / 2;
    const rFit = w / 2 - 0.06;
    const rTooBig = w / 2 + 0.06;
    return {
      w,
      wetBeyondBothEdges: !dry(z1 - 0.05) && !dry(z2 + 0.05),
      fits: d.canMove(121, zm, 0.2, 0, rFit),
      tooBig: d.canMove(121, zm, 0.2, 0, rTooBig)
    };
  }, [WL, MARGIN]);
  expect(gap.w).toBeGreaterThan(1.2); // A real corridor, wider than the scale-1 player
  expect(gap.wetBeyondBothEdges).toBe(true); // The measured contours ARE the gap edges
  expect(gap.fits).toBe(true); // gapWidth >= 2×radius passes...
  expect(gap.tooBig).toBe(false); // ...and 2×radius > gapWidth honestly fails

  // --- The owner's stuck-repro, fixed: a fully VISUALLY-DRY saddle
  // (z=-134, x=221.5..226.5; min h=-0.854, above the WL=-0.9 waterline
  // everywhere, solid land both sides). The old margin blocked it mid-dip
  // (reproduced: frozen at x=223.47); honest collision walks through.
  await teleportSafe(page, 220.5, -134);
  await page.keyboard.down('ArrowRight');
  const t0 = await page.evaluate(() => window.__game.state.runTime);
  await page.waitForFunction(([t]) => {
    const s = window.__game.state;
    return s.player.position.x >= 227.5 || s.runTime >= t + 6;
  }, [t0], { timeout: 60000 });
  await page.keyboard.up('ArrowRight');
  const crossing = await page.evaluate(() => {
    const g = window.__game;
    const p = g.state.player.position;
    return { x: p.x, ground: g.debug.groundHeightAt(p.x, p.z) };
  });
  expect(crossing.x).toBeGreaterThanOrEqual(227.5); // THROUGH the dip, onto solid land
  expect(crossing.ground).toBeGreaterThanOrEqual(WL); // Standing dry, as it looks
});

test('collider half-widths are bound to the real body geometry (D-11)', async ({ page }) => {
  await openGame(page);
  const widths = await page.evaluate(() => ({
    hero: window.__game.debug.heroBodyWidth(),
    enemy: window.__game.debug.enemyBodyWidth()
  }));
  // HONEST COLLISION contract: the collider constants promise the TRUE
  // visual half-width of the body block. If anyone reshapes the hero or
  // enemy body geometry (characters.js) without re-deriving the constants,
  // this tripwire fires — the constants lived in a different file with no
  // binding before (audit D-11).
  expect(widths.hero).toBeCloseTo(PLAYER_COLLIDER_HALF_WIDTH * 2, 12);
  expect(widths.enemy).toBeCloseTo(ENEMY_COLLIDER_HALF_WIDTH * 2, 12);
});

test('corner slide: a diagonal into the shoreline creeps along it and never freezes or wades', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);

  // Seeded shoreline corner (x=73, z=-155): water to the south (+z), open
  // beach to the east. Diagonal input INTO the shore must keep the player
  // moving east (the slide), with the body never visually overhanging water.
  await teleportSafe(page, 73, -155);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowDown');
  await waitGameSeconds(page, 2);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowDown');
  const after = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    const p = s.player.position;
    return {
      x: p.x,
      z: p.z,
      center: g.debug.groundHeightAt(p.x, p.z),
      // The body block's southern edge (half DEPTH is 0.5 × scale)
      southEdge: g.debug.groundHeightAt(p.x, p.z + 0.5 * s.playerScale)
    };
  });
  expect(after.x - 73).toBeGreaterThanOrEqual(1.5); // Slid along the shore — never froze
  expect(after.center).toBeGreaterThanOrEqual(WL + MARGIN - 1e-9); // On walkable land
  expect(after.southEdge).toBeGreaterThanOrEqual(WL); // The visible block stays out of the water
});

test('F cycles the speed multiplier mid-run, never on the start overlay', async ({ page }) => {
  await openGame(page);
  // On the overlay, F is just "any key": it starts the run, no cycling.
  await page.keyboard.press('f');
  await expect(page.locator('#start-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.__game.state.currentSpeedMultiplierIndex)).toBe(0);
  await expect(page.locator('#speed-cycle-button')).toHaveText('Speed: 1x');
  // Mid-run, F is the speed key: index advances and the button label follows.
  await page.keyboard.press('f');
  const after = await page.evaluate(() => ({
    index: window.__game.state.currentSpeedMultiplierIndex,
    speed: window.__game.state.actualPlayerSpeed
  }));
  expect(after.index).toBe(1);
  await expect(page.locator('#speed-cycle-button')).toHaveText('Speed: 1.5x');
  expect(after.speed).toBeCloseTo(6.0 * 1.5, 5); // BASE_PLAYER_SPEED × multiplier (scale 1)
});

test('modifier chords never fire game actions: Cmd/Ctrl+F does not cycle speed (C-10)', async ({ page }) => {
  await openGame(page);
  await startGame(page);
  // Cmd+F (find) and Ctrl+F are the browser's, never the game's — the F
  // branch used to fire underneath them.
  await page.keyboard.press('Meta+f');
  await page.keyboard.press('Control+f');
  expect(await page.evaluate(() => window.__game.state.currentSpeedMultiplierIndex)).toBe(0);
  // A plain F still works — the chord guard must not eat the unmodified key.
  await page.keyboard.press('f');
  expect(await page.evaluate(() => window.__game.state.currentSpeedMultiplierIndex)).toBe(1);
});

test('behind-camera enemies clamp their arrow to the BOTTOM edge, not mirrored to the top (C-3)', async ({ page }) => {
  await bootEndless(page);
  await waitGameSeconds(page, 0.3);
  // enemies[0] is the boot enemy (streaming spawns arrive ≥0.95s in); park
  // it 60u SOUTH (+Z) — well behind the camera plane. The old raw
  // project() output mirrors behind-camera points (negative w), so this
  // arrow used to clamp to the TOP edge, pointing kids exactly away from
  // the danger.
  const rect = await page.evaluate(() => {
    const s = window.__game.state;
    const e = s.enemies[0];
    e.position.set(s.player.position.x, e.position.y, s.player.position.z + 60);
    return { h: s.gameCanvasRect.height, top: s.gameCanvasRect.top };
  });
  await waitGameSeconds(page, 0.15); // ≥1 rendered frame with the new position
  const arrow = await page.evaluate(() => {
    const ind = window.__game.state.enemyIndicators[0];
    // Position rides the translate3d transform (plan 020 P-5 — left/top are
    // CSS-pinned at 0); parse the Y component out of it.
    const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(ind.style.transform);
    return { display: ind.style.display, y: m ? parseFloat(m[2]) : NaN };
  });
  expect(arrow.display).toBe('block'); // Off-screen → the arrow is live
  expect(arrow.y).toBeGreaterThan(rect.top + rect.h * 0.75); // BOTTOM edge (south)
});

test('window blur clears held movement keys: no phantom walking after alt-tab (C-4)', async ({ page }) => {
  await bootEndless(page);
  await page.evaluate(() => {
    const s = window.__game.state;
    s.collectTimeLeft = 999;
    for (const e of s.enemies) e.position.x = s.player.position.x + 200;
  });
  await page.keyboard.down('ArrowUp');
  await waitGameSeconds(page, 0.3); // The held key genuinely drives movement first
  // Dispatch blur and read the position in the SAME evaluate — no frame can
  // run in between, so this is the exact freeze point.
  const zAtBlur = await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    return window.__game.state.player.position.z;
  });
  await waitGameSeconds(page, 0.5);
  const zEnd = await page.evaluate(() => window.__game.state.player.position.z);
  await page.keyboard.up('ArrowUp');
  expect(zAtBlur).toBeLessThan(-0.5); // Proof the key was latched and walking
  expect(Math.abs(zEnd - zAtBlur)).toBeLessThanOrEqual(0.01); // Blur froze it
});

test('touch drag + held key move at exactly one speed, never two (C-5)', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);
  // A dry, rock-free 14u eastward lane on the seeded terrain — the travel
  // measurement must see pure input arithmetic, not a shoreline slide.
  const lane = await page.evaluate(() => {
    const d = window.__game.debug;
    for (let z = -60; z <= 60; z += 1) {
      for (let x = -60; x <= 46; x += 1) {
        let ok = true;
        for (let t = 0; t <= 14 && ok; t += 0.25) {
          // Center walkable with rock clearance, and the body's lateral
          // extremes dry too — the honest movement probes sample the edges,
          // so a shoreline half a body-width away would clamp the slide.
          if (!d.isWalkable(x + t, z, 0.6) ||
              !d.isWalkable(x + t, z - 0.7, 0) ||
              !d.isWalkable(x + t, z + 0.7, 0)) ok = false;
        }
        if (ok) return { x, z };
      }
    }
    return null;
  });
  expect(lane).not.toBeNull();
  await teleportSafe(page, lane.x, lane.z);
  // Full-strength rightward touch drag (fabricated handler events — the
  // touch.spec.js pattern) STACKED on a held ArrowRight.
  await page.evaluate(() => {
    const h = window.__game.debug.touchHandlers;
    const canvas = document.querySelector('#game-container canvas');
    const touch = (id, x, y) => ({ identifier: id, clientX: x, clientY: y });
    const ev = (target, ...changed) => ({ target, preventDefault() {}, changedTouches: changed, touches: changed });
    h.onTouchStart(ev(canvas, touch(1, 100, 300)));
    h.onTouchMove(ev(canvas, touch(1, 220, 300))); // 120px right = full-strength drag
  });
  await page.keyboard.down('ArrowRight');
  const start = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    t: window.__game.state.runTime,
    speed: window.__game.state.actualPlayerSpeed
  }));
  await waitGameSeconds(page, 1.0);
  const end = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    t: window.__game.state.runTime
  }));
  await page.keyboard.up('ArrowRight');
  const gameSeconds = end.t - start.t;
  const travel = end.x - start.x;
  expect(travel).toBeGreaterThan(start.speed * gameSeconds * 0.5); // It genuinely moved
  expect(travel).toBeLessThanOrEqual(start.speed * gameSeconds * 1.05); // ONE speed, not two
});

test('panic arrow prefers reachable food over nearer food across a lake (endless)', async ({ page }) => {
  test.setTimeout(150000);
  await bootEndless(page);

  // Seeded scene at P=(291,-190): a lake to the east (water from ~x+2 to
  // ~x+8), far-shore food at (306.5,-190) [15.5u away, ACROSS the lake],
  // same-side food at (273.5,-190) [17.5u away, dry line]. The arrow must
  // pick the reachable one even though it is farther.
  await teleportSafe(page, 291, -190);
  const scene = await page.evaluate(([WL_]) => {
    const g = window.__game;
    const s = g.state;
    // Verify the scene's premise against the real terrain first
    const crosses = (x2) => {
      for (let i = 1; i <= 8; i++) {
        const t = i / 9;
        if (g.debug.terrainHeight(291 + (x2 - 291) * t, -190) < WL_) return true;
      }
      return false;
    };
    // Keep exactly two foods, surgically placed
    while (s.collectibles.length > 2) {
      s.scene.remove(s.collectibles.pop());
    }
    const [a, b] = s.collectibles;
    a.position.set(306.5, 0, -190); // Across the lake, nearer
    b.position.set(273.5, 0, -190); // Same side, farther
    s.collectTimeLeft = 4.5; // Panic engages (PANIC_TIME = 5)
    return { acrossCrossesWater: crosses(306.5), sameSideCrossesWater: crosses(273.5) };
  }, [WL]);
  expect(scene.acrossCrossesWater).toBe(true); // The premise holds on this seed
  expect(scene.sameSideCrossesWater).toBe(false);

  await waitGameSeconds(page, 0.3); // Let the arrow update on live frames
  const arrow = await page.evaluate(() => {
    const info = window.__game.debug.effectsInfo();
    return { x: info.arrowTargetX, z: info.arrowTargetZ };
  });
  expect(arrow.x).not.toBeNull(); // Panic arrow is live
  expect(Math.abs(arrow.x - 273.5)).toBeLessThan(0.01); // Points at the REACHABLE food...
  expect(Math.abs(arrow.z - -190)).toBeLessThan(0.01); // ...not across the lake
});
