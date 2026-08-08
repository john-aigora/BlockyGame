# Blocky Collector 3D

A fast-paced 3D browser arcade game built with three.js by a father/son team.
Collect lime blocks to grow, outgrow the electric-blue enemies until they turn
yellow and flee — then hunt them down. Every kill pays points, spawns food, and
summons two bigger foes. Survive the 15-second collect clock and set a new
family best.

The game is an **endless world**: infinite, procedurally generated terrain that
streams in around you forever — rolling hills, impassable lakes and voxel
boulders, a horizon that visibly curves away, and regions with their own tint
so far places feel discovered. A **DISTANCE** counter tracks how far from the
start you've pushed — and the further you push, the taller, faster, and more
numerous the monsters get (every 250 units earns a milestone chime). The world
regenerates behind you, so there's no going back for leftovers. The retired
classic arena survives as a test-only path
(`__game.debug.forceWorldMode('classic')`); the untouched May 2025 original is
at `/original.html` (outside the password gate).

## Access

In-app password gate (not Vercel protection). Password: see `src/gate.js`
(shared family password). Unlock is session-scoped. The gate wraps only the
game itself (it defers loading the game module); `/original.html` is served
outside it.

## How to play

- **Start**: click START (or press any key / pad button / tap the screen).
- **Move**: Arrow keys / WASD / gamepad stick (or D-pad); touch-and-drag on mobile.
- **Jump**: Space or pad **A** (hop rocks, not lakes).
- **Speed**: F cycles; **R** or pad **X** slows one step; pad **Y** speeds up. Ladder: 0.5× → 1× → 1.5× → 2× → 3× → 5×.
- **Pad (F310 on Mac: back switch D)**: A jump, Start pause, Select mute, LB/RB zoom, Start+Select restart.
  Classic DB9 joysticks via dual-port USB adapters work — each port is a
  separate pad; wiggle the stick once to claim. The FIRST button press (or
  stick wiggle) on a not-yet-active pad only claims that pad and is
  deliberately not acted on — press or wiggle once, then play.
- **Grow**: grab a LIME block at least every 15 seconds — food is worth 1 point
  and makes you taller.
- **Hunt**: when you're taller than an enemy it turns YELLOW and runs. Touch it
  to defeat it: **+25 points or more** (bigger enemies pay a size bounty), a
  burst of food… and two enemies appear — one bigger giant far off, one
  bite-sized runner nearby, close enough to chase down for the combo (cap of
  12 on the field). Chain kills within 4 seconds for a COMBO multiplier.
- **Species**: **orange sprinters** are fast — much faster than the blue
  grunts — and always small enough to eat, which means they RUN: chasing one
  down before it slips away is its own little hunt. Little **green jujas**
  are harmless skittish critters that never hurt you; snack on them for
  bonus food (they're quick too — earn it).
- **Die**: get caught by a blue enemy or let the collect clock hit zero. Your
  run joins the local **BEST RUNS** top-5 (saved in your browser) — ranked by
  distance, score breaking ties.
- **Pause**: **P** or **Enter** (or pad Start, or the on-screen button). Space
  is jump, not pause.
- **Extras**: game-speed cycle, two-way zoom, mute (sound effects and the
  chiptune soundtrack are fully synthesized — no audio files).

## Running it locally

Requires Node **20.19+ or 22.12+** (what Vite 8 supports; `package.json`
`engines` and `.nvmrc` encode this). On this machine Node is not
system-installed — the toolchain lives at `~/.local/elves-tools/node/bin`, so
every shell needs:

```bash
export PATH="$HOME/.local/elves-tools/node/bin:$PATH"
```

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # Playwright test suite (see `npx playwright test --list`)
npm run lint       # ESLint
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

## Project structure

```
index.html          page shell, UI elements, gate, start/death screens
style.css           "Deep Dive Arcade" theme + responsive/mobile rules
src/
  main.js           entry point (+ window.__game test handle)
  game.js           orchestrator: init, game loop, setup, pause
  constants.js      all tuning values — GAME BALANCE block lives here
  state.js          the single shared mutable game state
  world.js          scene, camera+zoom, fog, lights, ground plane
  worldmath.js      mode-aware world math — Euclidean in endless (shipping),
                    toroidal in the retired classic; all world-space
                    distances go through here
  terrain.js        the endless world: seeded noise terrain, chunk
                    streaming/pooling, water, boulders, curved horizon
  clouds.js         drifting sky clouds (chunk-seeded in endless)
  characters.js     the shared player/enemy blocky-character factory
  enemies.js        enemy AI (chase/orbit/flee), spawning, kills
  collectibles.js   food spawning and resources
  effects.js        pooled particles, walk animation, glow, screen juice
  audio.js          synthesized sound effects + procedural chiptune music
  rumble.js         gamepad vibration (isolated to avoid import cycles)
  hiscores.js       local top-5 storage (per-mode boards)
  input.js          keyboard + gamepad + multitouch-safe drag controls
  movement-continuous.js  plan-014 design spike (LBS-style movement + boost),
                    active only behind ?move=continuous
  gate.js           in-app password gate (session-scoped unlock)
  ui.js             HUD, indicators, start/death screens, endGame
  timers.js         the collect clock (game-time driven)
tests/              Playwright specs (smoke, timing, gameover, world, camera,
                    resources, hiscores, audio, balance, touch, effects,
                    endless + endless-stream + endless-polish, gate, gamepad,
                    fairness, hitbox, tension, toys) + shared helpers
plans/              the audit + implementation plans this overhaul followed
```

Key technical facts:

- **three.js is pinned at 0.128.0 on purpose** (exact npm pin). Newer majors
  change color management and lighting defaults; upgrading is a deliberate
  future project, not a drive-by bump.
- The shipping world (endless) is a **flat infinite plane with a floating
  origin**; the retired classic arena was a ±100 torus. ALL entity-to-entity
  distance still routes through `src/worldmath.js` (mode dispatch).
- The simulation is **frame-rate independent** (delta-time in units/second);
  the collect clock runs on game time, so pausing or hiding the tab never
  cheats or kills you.
- Want to tune the game? Everything interesting is in the
  `GAME BALANCE` block of [src/constants.js](src/constants.js).

## Deploying to Vercel

The repo is a standard Vite app — Vercel detects it automatically.

1. Push this branch/repo to GitHub.
2. On [vercel.com](https://vercel.com): **Add New → Project → Import** this
   repository.
3. Framework preset shows **Vite** (build `vite build`, output `dist/`) —
   accept and **Deploy**.
4. Every push to `main` now auto-deploys. That's it — no config file needed.

Alternatively, from a machine with the Vercel CLI logged in: `npx vercel` then
`npx vercel --prod`.

## Ideas & history

The feature wishlist lives in [todo.md](todo.md). The 2026 overhaul (bug-fix
and feature plans, with verification steps) is documented under
[plans/](plans/README.md).
