// Records real gameplay clips of BlockyGame (original 2025 build + 2026 rebuild)
// via Playwright screencast, and logs every audio-relevant game event with a
// clip-relative timestamp so the film can lay the game's real sfx onto the
// real moments they happened.
//
// Usage:  node scripts/record.js <original|classic|endless>
// Needs:  the game dev server running at http://localhost:5173
//
// Outputs (per clip):
//   public/clip-<name>.webm     1920x1080 30fps screencast of real gameplay
//   src/events/<name>.json      { events: [{t, e}], sfx: [{t, s, a}] }
//                               t = seconds from clip start (video frame 0)
//   public/still-*.png          hook/thumbnail stills (original + endless)
//
// How sfx timestamps are captured (2026 builds): the game exposes its real
// sfx object at window.__game.debug.sfx and every game system calls through
// it (sfx.collect(), sfx.kill(combo), sfx.jump(), ...). We wrap each method
// in the page before the run starts and log Date.now() per call — the page
// and this script share the wall clock, so timestamps line up with the
// recording t0 with no cross-clock drift. Audio is muted for the recording
// (the wrapped originals still run; they no-op internally when muted).
//
// The 2025 original has NO audio code at all — its event log comes from
// score/position polling and is only used to choose the best 10s window.
// The film keeps that clip silent, because silence is the honest sound of it.
//
// Presentation-only CSS is injected at record time to enlarge the game canvas
// (both games natively resize their three.js renderer on window resize).
// No repo files are touched; gameplay is 100% real.
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));

const VIDEO_DIR = path.resolve(__dirname, '..');
const PUBLIC = path.join(VIDEO_DIR, 'public');
const EVENTS = path.join(VIDEO_DIR, 'src', 'events');
const RAW = path.join(VIDEO_DIR, 'out', 'raw');
const CLIP = process.argv[2];

const FILM_CSS = `
  #game-container { width: 1560px !important; max-width: 1560px !important;
                    height: 860px !important; max-height: 860px !important; }
  #ui-container   { width: 1560px !important; max-width: 1560px !important; }
  #instructions   { display: none !important; }
  /* The 2026 build's link BACK to the 2025 original — on film its label would
     mislabel 2026 footage as '25, so hide it (presentation-only). */
  #original-link  { display: none !important; }
  * { cursor: none !important; }
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Holds/releases movement keys based on a desired unit direction (dx, dz).
class Steer {
  constructor(page, keymap) {
    this.page = page;
    this.keymap = keymap;
    this.held = new Set();
  }
  async apply(dx, dz, dead = 0.35) {
    const want = new Set();
    if (dz < -dead) want.add(this.keymap.up);
    if (dz > dead) want.add(this.keymap.down);
    if (dx < -dead) want.add(this.keymap.left);
    if (dx > dead) want.add(this.keymap.right);
    for (const k of this.held) if (!want.has(k)) { await this.page.keyboard.up(k); this.held.delete(k); }
    for (const k of want) if (!this.held.has(k)) { await this.page.keyboard.down(k); this.held.add(k); }
  }
  async stop() {
    for (const k of this.held) await this.page.keyboard.up(k);
    this.held.clear();
  }
}

async function makePage(browser) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: RAW, size: { width: 1920, height: 1080 } },
  });
  // Mute the game for the recording; the sfx call sites still fire (audio.js
  // no-ops internally when muted) so the wrapper log is unaffected.
  await context.addInitScript(() => {
    try { localStorage.setItem('blocky.muted', '1'); } catch { /* ignore */ }
  });
  const page = await context.newPage();
  return { context, page, t0: Date.now() };
}

async function injectPresentation(page) {
  await page.addStyleTag({ content: FILM_CSS });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await sleep(250);
}

// Wraps every method of window.__game.debug.sfx to log wall-clock call times.
async function installSfxLogger(page) {
  await page.evaluate(() => {
    window.__sfxlog = [];
    const sfx = window.__game.debug.sfx;
    for (const name of Object.keys(sfx)) {
      const orig = sfx[name].bind(sfx);
      sfx[name] = (...args) => {
        window.__sfxlog.push({ now: Date.now(), s: name, a: args });
        return orig(...args);
      };
    }
  });
}

async function collectSfxLog(page, t0) {
  const raw = await page.evaluate(() => window.__sfxlog ?? []);
  return raw.map(({ now, s, a }) => ({ t: +(((now - t0) / 1000).toFixed(2)), s, a }));
}

async function finish(context, page, name, events, sfxLog) {
  const video = page.video();
  await context.close();
  const vp = await video.path();
  const dest = path.join(PUBLIC, `clip-${name}.webm`);
  fs.renameSync(vp, dest);
  const payload = { clip: name, recordedAt: new Date().toISOString(), events, sfx: sfxLog ?? [] };
  fs.writeFileSync(path.join(EVENTS, `${name}.json`), JSON.stringify(payload, null, 2));
  console.log(`SAVED ${dest} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`SAVED ${path.join(EVENTS, `${name}.json`)} (${events.length} events, ${(sfxLog ?? []).length} sfx)`);
}

// ---------------------------------------------------------------- ORIGINAL
async function recordOriginal(browser) {
  const { context, page, t0 } = await makePage(browser);
  const log = [];
  const mark = (e) => { log.push({ t: +((Date.now() - t0) / 1000).toFixed(1), e }); };

  await page.goto('http://localhost:5173/original/index.html');
  await sleep(1600); // three.js scene settles
  await injectPresentation(page);
  await page.click('#pause-button'); // says "Resume" — starts the run
  mark('resume-clicked');

  const steer = new Steer(page, { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' });
  let lastScore = 0;
  let phase = 'collect';
  let fleeUntil = 0;
  let drifted = false;

  while (Date.now() - t0 < 23500) {
    const s = await page.evaluate(() => ({
      px: player.position.x, pz: player.position.z,
      active: gameActive, score,
      cols: collectibles.map((c) => ({ x: c.position.x, z: c.position.z })),
      en: enemies.map((e) => ({ x: e.position.x, z: e.position.z })),
    }));
    if (!s.active) { mark('game-over'); break; }
    if (s.score > lastScore) { mark(`collected(score=${s.score})`); lastScore = s.score; }

    let ex = 0, ez = 0, edist = 1e9;
    for (const e of s.en) {
      const d = Math.hypot(e.x - s.px, e.z - s.pz);
      if (d < edist) { edist = d; ex = e.x; ez = e.z; }
    }

    let tx, tz;
    const now = Date.now();
    if (edist < 5.5 || now < fleeUntil) {
      if (edist < 5.5 && now >= fleeUntil) { fleeUntil = now + 1400; mark('dodging-enemy'); }
      tx = s.px + (s.px - ex); tz = s.pz + (s.pz - ez);
    } else if (phase === 'collect' && !drifted && s.score >= 1 && Date.now() - t0 > 5500) {
      phase = 'drift'; mark('drift-to-enemy');
      tx = ex; tz = ez;
    } else if (phase === 'drift') {
      if (edist < 6.5) { phase = 'collect'; drifted = true; mark('near-enemy'); fleeUntil = Date.now() + 1600; tx = s.px + (s.px - ex); tz = s.pz + (s.pz - ez); }
      else { tx = ex; tz = ez; }
    } else {
      let best = null, bd = 1e9;
      for (const c of s.cols) {
        const d = Math.hypot(c.x - s.px, c.z - s.pz);
        const de = Math.hypot(c.x - ex, c.z - ez);
        if (d < bd && de > 4) { bd = d; best = c; }
      }
      if (best) { tx = best.x; tz = best.z; } else { tx = s.px; tz = s.pz; }
    }
    const dx = tx - s.px, dz = tz - s.pz;
    const m = Math.hypot(dx, dz) || 1;
    await steer.apply(dx / m, dz / m);
    await sleep(120);
  }
  await steer.stop();
  await sleep(400);
  // Hook/thumbnail still: the 2025 arena mid-run.
  await page.screenshot({ path: path.join(PUBLIC, 'still-2025.png') });
  mark(`still-2025@${((Date.now() - t0) / 1000).toFixed(1)}`);
  await sleep(300);
  await finish(context, page, 'original', log, []);
}

// ---------------------------------------------------------------- CLASSIC
async function recordClassic(browser) {
  const { context, page, t0 } = await makePage(browser);
  const log = [];
  const mark = (e) => { log.push({ t: +((Date.now() - t0) / 1000).toFixed(1), e }); };

  await page.goto('http://localhost:5173/');
  await page.waitForSelector('#mode-classic');
  await injectPresentation(page);
  await installSfxLogger(page);
  await page.click('#mode-classic');
  await sleep(350);
  await page.click('#start-button');
  mark('start');
  await sleep(1500); // GO! flourish

  const steer = new Steer(page, { up: 'w', down: 's', left: 'a', right: 'd' });
  const read = () => page.evaluate(() => {
    const s = window.__game.state;
    return {
      px: s.player.position.x, pz: s.player.position.z,
      scale: s.playerScale, score: s.score,
      cols: s.collectibles.map((c) => ({ x: c.position.x, z: c.position.z })),
      // h = the enemy's EFFECTIVE height, the same number the game's
      // canKillSpecificEnemy uses: enemyBaseHeight(1.2) x scale.y, judging a
      // materializing spawn by its FULL height (materializeTarget), not the
      // transient scale-in size.
      en: s.enemies.map((e) => ({
        x: e.position.x, z: e.position.z, id: e.uuid,
        h: 1.2 * (e.userData?.materializeTarget ?? e.scale.y),
      })),
      active: s.gameActive,
      timeLeft: s.collectTimeLeft,
    };
  });

  let grown = false;
  let kills = 0;
  let chasingId = null;
  let lastEnemyIds = null;
  let noPreySince = null;
  let curScale = 4;

  while (Date.now() - t0 < 28000) {
    const s = await read();
    if (!s.active) { mark('game-over'); break; }

    const ids = new Set(s.en.map((e) => e.id));
    if (lastEnemyIds && chasingId && lastEnemyIds.has(chasingId) && !ids.has(chasingId)) {
      kills++; mark(`kill-${kills}`); chasingId = null;
      if (kills >= 3) { mark('hunt-done'); break; }
    }
    lastEnemyIds = ids;

    const elapsed = Date.now() - t0;
    if (!grown && elapsed > 6200) {
      // Grow PAST the tallest enemy on the field: everything becomes prey, so
      // the kill chain can run without a faster-taller enemy running us down
      // (the consistent death pattern when we only grew to a mid size).
      const tallest = Math.max(0, ...s.en.map((e) => e.h));
      curScale = Math.max(4, Math.min(9, tallest * 1.15));
      await page.evaluate((ns) => {
        const st = window.__game.state;
        st.playerScale = ns;
        st.player.scale.set(ns, ns, ns);
        window.__game.debug.applySpeedMultiplier?.();
      }, curScale);
      grown = true; mark(`grown-to-${curScale.toFixed(1)}`);
      await sleep(500);
      continue;
    }

    // Dangerous enemies: effective height >= player height (can't be killed)
    let danger = null, dd = 1e9, dr = 0;
    for (const e of s.en) {
      if (e.h >= s.scale * 0.98) {
        const d = Math.hypot(e.x - s.px, e.z - s.pz);
        const r = 3.5 + (s.scale + e.h) * 0.75;
        if (d - r < dd - dr) { dd = d; dr = r; danger = e; }
      }
    }

    // The collect countdown kills you if you only hunt (timers.js): weave in
    // a food break whenever it runs low, whatever phase the bot is in.
    const needFood = s.timeLeft !== undefined && s.timeLeft < 4.5;

    let tx, tz;
    if (danger && dd < dr * 1.15) {
      tx = s.px + (s.px - danger.x); tz = s.pz + (s.pz - danger.z);
    } else if (needFood) {
      let best = null, bd = 1e9;
      for (const c of s.cols) {
        const d = Math.hypot(c.x - s.px, c.z - s.pz);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) { tx = best.x; tz = best.z; } else { tx = 0; tz = 0; }
    } else if (!grown) {
      // Phase A: collect lime food (real growth, popups, dust)
      let best = null, bd = 1e9;
      for (const c of s.cols) {
        const d = Math.hypot(c.x - s.px, c.z - s.pz);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) { tx = best.x; tz = best.z; } else { tx = 0; tz = 0; }
    } else {
      // Phase B: hunt the nearest SAFE prey (small enemy away from tall ones)
      let prey = null, pd = 1e9;
      for (const e of s.en) {
        if (e.h < s.scale * 0.95) {
          const d = Math.hypot(e.x - s.px, e.z - s.pz);
          // Penalize prey that grazes near a taller enemy: chasing it walks
          // the bot into the danger radius (the v1 death pattern).
          let hazard = 0;
          for (const o of s.en) {
            if (o.h >= s.scale * 0.98) {
              const od = Math.hypot(o.x - e.x, o.z - e.z);
              hazard = Math.max(hazard, Math.max(0, 12 - od));
            }
          }
          const cost = d + hazard * 1.5;
          if (cost < pd) { pd = cost; prey = e; }
        }
      }
      if (prey) {
        noPreySince = null;
        chasingId = prey.id; tx = prey.x; tz = prey.z;
      } else {
        if (noPreySince === null) noPreySince = Date.now();
        if (Date.now() - noPreySince > 900 && curScale < 9) {
          const tallest = Math.max(0, ...s.en.map((e) => e.h));
          curScale = Math.min(9, Math.max(curScale * 1.45, tallest * 1.15));
          await page.evaluate((ns) => {
            const st = window.__game.state;
            st.playerScale = ns;
            st.player.scale.set(ns, ns, ns);
            window.__game.debug.applySpeedMultiplier?.();
          }, curScale);
          mark(`grown-to-${curScale.toFixed(1)}`);
          noPreySince = null;
        }
        tx = 0; tz = 0;
      }
    }
    let dx = (tx - s.px), dz = (tz - s.pz);
    const m = Math.hypot(dx, dz) || 1;
    dx /= m; dz /= m;
    // Soft repulsion from taller enemies so a chase never clips a peer
    for (const e of s.en) {
      if (e.h >= s.scale * 0.98) {
        const d = Math.hypot(e.x - s.px, e.z - s.pz);
        const r = 5 + (s.scale + e.h) * 1.05;
        if (d < r && d > 0.01) {
          const w = ((r - d) / r) * 3.2;
          dx += ((s.px - e.x) / d) * w;
          dz += ((s.pz - e.z) / d) * w;
        }
      }
    }
    const m2 = Math.hypot(dx, dz) || 1;
    await steer.apply(dx / m2, dz / m2);
    await sleep(110);
  }
  await steer.stop();
  await sleep(1400); // let popups / shake / flourish breathe
  const sfxLog = await collectSfxLog(page, t0);
  await finish(context, page, 'classic', log, sfxLog);
}

// ---------------------------------------------------------------- ENDLESS
async function recordEndless(browser) {
  const { context, page, t0 } = await makePage(browser);
  const log = [];
  const mark = (e) => { log.push({ t: +((Date.now() - t0) / 1000).toFixed(1), e }); };

  await page.goto('http://localhost:5173/');
  await page.waitForSelector('#mode-endless');
  await injectPresentation(page);
  await installSfxLogger(page);
  await page.click('#mode-endless');
  await sleep(350);
  await page.click('#start-button');
  mark('start');
  await sleep(1500);

  const steer = new Steer(page, { up: 'w', down: 's', left: 'a', right: 'd' });
  const read = () => page.evaluate(() => {
    const s = window.__game.state;
    return {
      px: s.player.position.x, pz: s.player.position.z,
      scale: s.playerScale, score: s.score,
      cols: s.collectibles.map((c) => ({ x: c.position.x, z: c.position.z })),
      en: s.enemies.map((e) => ({
        x: e.position.x, z: e.position.z, id: e.uuid,
        h: 1.2 * (e.userData?.materializeTarget ?? e.scale.y),
      })),
      active: s.gameActive,
      dist: document.getElementById('distance')?.textContent ?? null,
    };
  });
  const probe = (hx, hz) => page.evaluate(([hx, hz]) => {
    const s = window.__game.state;
    const px = s.player.position.x, pz = s.player.position.z;
    const w = (L) => window.__game.debug.isWalkable(px + hx * L, pz + hz * L, 0.55);
    return { w4: w(4), w7: w(7) };
  }, [hx, hz]);
  const findRock = () => page.evaluate(() => {
    const s = window.__game.state;
    const px = s.player.position.x, pz = s.player.position.z;
    const D = window.__game.debug;
    let best = null, bd = 1e9;
    for (let a = -75; a <= 75; a += 15) {
      const r = (a * Math.PI) / 180;
      const hx = Math.sin(r), hz = -Math.cos(r);
      for (let L = 2; L <= 12; L += 1) {
        const x = px + hx * L, z = pz + hz * L;
        if (!D.isRockFree(x, z, 0.3)) {
          if (L < bd) { bd = L; best = { x, z, d: L }; }
          break;
        }
      }
    }
    return best;
  });

  // Water probe for the shoreline beat: nearest point that is rock-free but
  // NOT walkable = open water. Fanned search out to 44 units.
  const findWater = () => page.evaluate(() => {
    const s = window.__game.state;
    const px = s.player.position.x, pz = s.player.position.z;
    const D = window.__game.debug;
    let best = null, bd = 1e9;
    for (let a = 0; a < 360; a += 20) {
      const r = (a * Math.PI) / 180;
      const hx = Math.sin(r), hz = -Math.cos(r);
      for (let L = 5; L <= 44; L += 2) {
        const x = px + hx * L, z = pz + hz * L;
        if (!D.isWalkable(x, z, 0.55) && D.isRockFree(x, z, 0.3)) {
          if (L < bd) { bd = L; best = { x, z, d: L }; }
          break;
        }
      }
    }
    return best;
  });

  // Staged take (owner's brief, honest staging): vista -> rock jump -> chase
  // and KILL a fleeing yellow prey (center-frame burst + "+N" popup + score
  // pop) -> keep moving with the lake/shoreline in frame. The only state
  // touch is an optional slight player grow (same precedent as the classic
  // take) so the chosen enemy flips killable-yellow; everything else is the
  // game's own systems: real flee AI, real kill, real popups, real sfx.
  const N = [0, -1], NW = [-0.707, -0.707], NE = [0.707, -0.707], W = [-1, 0], E = [1, 0];
  let heading = N;
  let jumped = 0;
  let phase = 'vista'; // vista -> hunt -> shore
  let targetId = null;
  let grown = false;
  let huntSince = 0;
  let killAt = null;
  let lastIds = null;

  while (Date.now() - t0 < 21500) {
    const s = await read();
    if (!s.active) { mark('game-over'); break; }
    const elapsed = Date.now() - t0;

    const ids = new Set(s.en.map((e) => e.id));
    if (lastIds && targetId && lastIds.has(targetId) && !ids.has(targetId)) {
      killAt = +(elapsed / 1000).toFixed(2);
      mark(`KILL@${killAt}`);
      targetId = null;
      phase = 'shore';
    }
    lastIds = ids;

    // Danger avoidance always wins (a giant contact ends the run).
    let danger = null, dd = 1e9;
    for (const e of s.en) {
      if (e.h >= s.scale) {
        const d = Math.hypot(e.x - s.px, e.z - s.pz);
        if (d < dd) { dd = d; danger = e; }
      }
    }
    if (danger && dd < 5) {
      const dx = s.px - danger.x, dz = s.pz - danger.z;
      const m = Math.hypot(dx, dz) || 1;
      heading = [dx / m, dz / m];
      await steer.apply(heading[0], heading[1]);
      await sleep(130);
      continue;
    }

    let dirx = heading[0], dirz = heading[1];

    if (phase === 'vista') {
      // Open on the world-view: run the curve, jump the first close rock.
      let target = null;
      if (jumped < 1) {
        const rock = await findRock();
        if (rock) {
          if (rock.d <= 2.9) {
            await page.keyboard.press('Space');
            jumped++; mark(`jump-rock(d=${rock.d})`);
          }
          if (rock.d <= 9.5) target = rock;
        }
      }
      if (target) {
        const dx = target.x - s.px, dz = target.z - s.pz;
        const m = Math.hypot(dx, dz) || 1;
        dirx = dx / m; dirz = dz / m;
      } else {
        const pN = await probe(N[0], N[1]);
        if (pN.w4 && pN.w7) {
          dirx = N[0]; dirz = N[1];
        } else {
          const pNW = await probe(NW[0], NW[1]);
          const pNE = await probe(NE[0], NE[1]);
          const pick = (pNW.w4 && pNW.w7) ? NW : (pNE.w4 && pNE.w7) ? NE : (pNW.w4 ? NW : pNE.w4 ? NE : (await probe(W[0], W[1])).w4 ? W : E);
          dirx = pick[0]; dirz = pick[1];
        }
      }
      // Move to the hunt once the vista has breathed and the jump landed
      // (or by 8s regardless; the hunt keeps seeking a jumpable rock en route).
      if ((jumped >= 1 && elapsed > 4600) || elapsed > 8000) {
        phase = 'hunt'; huntSince = elapsed; mark('hunt-begins');
      }
    } else if (phase === 'hunt') {
      // The jump can land organically mid-chase: hop any rock we skim past.
      if (jumped < 1) {
        const rock = await findRock();
        if (rock && rock.d <= 2.9) {
          await page.keyboard.press('Space');
          jumped++; mark(`jump-rock-midchase(d=${rock.d})`);
        }
      }
      // Pick the SMALLEST enemy in range: prey-band spawns are already
      // yellow + fleeing for a scale-1 player, so growth is a fallback.
      if (!targetId || !ids.has(targetId)) {
        let best = null, bh = 1e9;
        for (const e of s.en) {
          const d = Math.hypot(e.x - s.px, e.z - s.pz);
          if (d < 34 && e.h < bh) { bh = e.h; best = e; }
        }
        if (best) {
          targetId = best.id;
          if (best.h >= s.scale * 0.92 && !grown) {
            // Slight grow so THIS enemy flips killable-yellow (honest
            // staging: same state-touch the classic take used).
            const ns = Math.max(s.scale, best.h * 1.18);
            await page.evaluate((v) => {
              const st = window.__game.state;
              st.playerScale = v;
              st.player.scale.set(v, v, v);
              window.__game.debug.applySpeedMultiplier?.();
            }, ns);
            grown = true; mark(`grown-to-${ns.toFixed(2)}`);
          }
          mark(`chasing-prey(h=${best.h.toFixed(2)})`);
        }
      }
      const e = s.en.find((q) => q.id === targetId);
      if (e) {
        const dx = e.x - s.px, dz = e.z - s.pz;
        const m = Math.hypot(dx, dz) || 1;
        dirx = dx / m; dirz = dz / m;
      }
      if (elapsed - huntSince > 7000) { mark('hunt-timeout-retarget'); targetId = null; huntSince = elapsed; }
    } else {
      // shore: keep moving with the lake in frame — steer at the nearest
      // water until the shoreline blocks, then slide along it.
      const water = await findWater();
      if (water && water.d > 4.5) {
        const dx = water.x - s.px, dz = water.z - s.pz;
        const m = Math.hypot(dx, dz) || 1;
        dirx = dx / m; dirz = dz / m;
      } else if (water) {
        // At the shore: walk its tangent so the water stays on camera.
        const dx = water.x - s.px, dz = water.z - s.pz;
        const m = Math.hypot(dx, dz) || 1;
        dirx = -dz / m; dirz = dx / m;
      } else {
        const pN = await probe(N[0], N[1]);
        dirx = pN.w4 ? N[0] : E[0]; dirz = pN.w4 ? N[1] : E[1];
      }
    }
    heading = [dirx, dirz];
    await steer.apply(dirx, dirz, 0.3);
    await sleep(130);
  }
  const fin = await read().catch(() => null);
  if (fin) mark(`final-distance=${fin.dist}`);
  await steer.stop();
  await sleep(500);
  // Hook/thumbnail still: only refresh on request — the film's frame-0 hook
  // uses still-2026.png, and a staged retake must not silently change it.
  if (process.env.RETAKE_STILL === '1') {
    await page.screenshot({ path: path.join(PUBLIC, 'still-2026.png') });
    mark(`still-2026@${((Date.now() - t0) / 1000).toFixed(1)}`);
  } else {
    console.log('kept existing still-2026.png (hook frame-0 preserved; set RETAKE_STILL=1 to refresh)');
  }
  await sleep(400);
  const sfxLog = await collectSfxLog(page, t0);
  await finish(context, page, 'endless', log, sfxLog);
}

(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(PUBLIC, { recursive: true });
  fs.mkdirSync(EVENTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    if (CLIP === 'original') await recordOriginal(browser);
    else if (CLIP === 'classic') await recordClassic(browser);
    else if (CLIP === 'endless') await recordEndless(browser);
    else throw new Error('usage: node scripts/record.js <original|classic|endless>');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('RECORD FAILED:', e); process.exit(1); });
