# Blocky Collector 3D

A fast-paced 3D browser arcade game built with three.js by a father/son team.
Collect lime blocks to grow, outgrow the electric-blue enemies until they turn
yellow and flee — then hunt them down. Every kill pays points, spawns food, and
summons two bigger foes. Survive the 15-second collect clock and set a new
family best.

## How to play

- **Start**: click START (or press any key / tap the screen).
- **Move**: Arrow keys on desktop; touch-and-drag anywhere on mobile.
- **Grow**: grab a LIME block at least every 15 seconds — food is worth 1 point
  and makes you taller.
- **Hunt**: when you're taller than an enemy it turns YELLOW and runs. Touch it
  to defeat it: **+25 points**, a burst of food… and two larger enemies appear
  (up to a cap of 8 on the field).
- **Die**: get caught by a blue enemy or let the collect clock hit zero. Your
  score joins the local **BEST RUNS** top-5 (saved in your browser).
- **Extras**: pause (Spacebar or button), game-speed cycle, two-way zoom,
  mute (sound effects and the chiptune soundtrack are fully synthesized —
  no audio files).

## Running it locally

Requires Node 18+.

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # Playwright test suite (39 tests)
npm run lint       # ESLint
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

## Project structure

```
index.html          page shell, UI elements, start/death screens
style.css           "Deep Dive Arcade" theme + responsive/mobile rules
src/
  main.js           entry point (+ window.__game test handle)
  game.js           orchestrator: init, game loop, setup, pause
  constants.js      all tuning values — GAME BALANCE block lives here
  state.js          the single shared mutable game state
  world.js          scene, camera+zoom, fog, lights, procedural ground
  worldmath.js      toroidal (wrap-around) math — all world-space
                    distances/directions go through here
  characters.js     the shared player/enemy blocky-character factory
  enemies.js        enemy AI (chase/orbit/flee), spawning, kills
  collectibles.js   food spawning and resources
  effects.js        pooled particles, walk animation, glow, screen juice
  audio.js          synthesized sound effects + procedural chiptune music
  hiscores.js       local top-5 storage
  input.js          keyboard + multitouch-safe drag controls
  ui.js             HUD, indicators, start/death screens, endGame
  timers.js         the collect clock (game-time driven)
tests/              Playwright specs (smoke, timing, game-over, world,
                    camera, resources, hiscores, audio, balance, touch,
                    effects) + shared helpers
plans/              the audit + implementation plans this overhaul followed
```

Key technical facts:

- **three.js is pinned at 0.128.0 on purpose** (exact npm pin). Newer majors
  change color management and lighting defaults; upgrading is a deliberate
  future project, not a drive-by bump.
- The world is a **torus** (wraps at ±100 on X/Z). Any entity-to-entity
  direction or distance must use `src/worldmath.js`.
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
