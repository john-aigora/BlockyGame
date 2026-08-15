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

The world itself is a **seed**: the start overlay shows the number
(`SEED 20260726`), `?seed=<int>` in the URL summons any world on demand, and
the **TODAY'S WORLD** toggle switches everyone onto the same date-seeded map —
the family races one shared world all day, and those runs also rank on their
own **TODAY'S BEST** board (stale days prune themselves). And the race is
now visible: every solo run records its path, and the best run per seed
comes back as a **ghost** — a translucent spectral hero re-running it live
beside you (`RACING THE GHOST: 843u` on the title screen; a marker where it
fell or ascended; `?ghost=0` hides it). Beat the ghost and YOU become it. Out in the wild:
biome regions now have **names** — hold a new region for a moment and a
`DISCOVERED: THE TEAL SHALLOWS` banner fires (the death screen counts your
REGIONS) — rare glowing **gold blocks** pay 5 points (worth a detour, not a
strategy), and the first time a run pushes past **1000 units** the ground
flashes red for twice as long as usual: a gold-crowned **TITAN** half again
the size of the local giants marches in. It never gives up and never wanders
off — outgrow it, eat it, and it pays triple bounty and bursts into a
10-block feast ring. One titan per run; bragging mandatory.

## Access

In-app password gate (not Vercel protection). Password: see `src/gate.js`
(shared family password). Unlock is session-scoped. The gate wraps only the
game itself (it defers loading the game module); `/original.html` is served
outside it.

## How to play

- **Start**: click START (or press any key / pad button / tap the screen).
- **Move**: Arrow keys / WASD / gamepad stick (or D-pad); touch-and-drag on mobile.
- **Jump**: Space or pad **A** (hop rocks, not lakes).
- **Speed**: F cycles P1; **R** or pad **X** slows one step; pad **Y** speeds up. Ladder: 0.5× → 1× → 1.5× → 2× → 3× → 5×. In **2 PLAYERS**, each pad's Y/X only changes that seat's speed (HUD shows `Speed: a× / b×`).
- **Pad (F310 on Mac: back switch D)**: A jump, Start pause, Select mute, LB/RB zoom, Start+Select restart.
  Classic DB9 joysticks via dual-port USB adapters work — each port is a
  separate pad; wiggle the stick once to claim. The FIRST button press (or
  stick wiggle) on a not-yet-active pad only claims that pad and is
  deliberately not acted on — press or wiggle once, then play.
  **Controllers acting up?** Open `/pad-test.html` — a standalone live
  readout of every pad, axis, and button the browser sees (in-game,
  `?paddebug=1` overlays the same data).
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
- **Skins**: the SKIN button on the title screen cycles your hero's EARNED
  palettes — LIME at 500u, MIDNIGHT at 1000u, GOLD at 1,000 points, and the
  CELESTIAL palette only an ascended run unlocks. Earned from your saved
  boards (clearing browser data clears skins with them); P2 is always teal.
- **Ascend**: keep growing and the sky notices. At size 9 a golden halo
  appears (`THE SKY AWAITS...`); at size 10 — the 90th block — the run
  crowns itself: a beam of light, a spinning rise into the clouds, a
  starburst, **+500 points**, and an **ASCENDED!** screen instead of GAME
  OVER. Ascended runs wear a permanent ✦ on the board. In 2 PLAYERS one hero
  can ascend while the partner plays on.
- **Pause**: **P** or **Enter** (or pad Start, or the on-screen button). Space
  is jump, not pause.
- **Extras**: game-speed cycle, two-way zoom, mute (sound effects and the
  chiptune soundtrack are fully synthesized — no audio files).

## Two Players (split-screen)

Pick **2 PLAYERS** on the start overlay (the choice is remembered for the
session). One shared world, split vertically — **P1 (orange-red) on the
left, P2 (teal) on the right** — with a hero, score, collect clock, and
distance each. During a live run the playfield widens (up to 2× the solo
width) so each half is about the same size as a 1-player view, side by
side. Enemies hunt whoever is nearest, and whether one is edible (yellow)
is judged per player on each half of the screen: your half shows YOUR truth.

| Control  | P1 (left)         | P2 (right)         |
|----------|-------------------|--------------------|
| Move     | **WASD**          | **Arrow keys**     |
| Jump     | **Space**         | **/** (slash)      |
| Gamepad  | first pad to move | second pad to move |
| Pad jump | its **A** button  | its **A** button   |

- **Pads claim seats by moving**: wiggle a stick and that pad owns a seat
  (first pad takes P1 — unless P1 is already playing on WASD this run, then
  it politely takes P2). Ghost adapter ports never claim. Unplugging frees
  the seat.
- **Pause pauses both** (P / Enter / Start on any pad). **Zoom is shared**;
  **speed is per seat** (each pad's Y/X, F/R for P1). The field cap rises to
  **16** monsters with two heroes (solo stays 12).
- **Water scales with both heroes**: the lake plane grows so far-apart
  partners still see water under their feet (collision always did; the
  surface now follows the union).
- **Death is personal**: whoever runs out of clock (or gets caught) squashes
  and spectates — their half follows the survivor under a WAITING chip. When
  both are down, one death screen shows both runs side by side, and the
  **team total** (P1 + P2) joins its own local **TEAM RUNS** top-5 — 2P runs
  never touch the solo boards.
- Touch drag (mobile) drives P1.

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
npm test           # FULL Playwright suite (~8 min; runs alone on port 5173)
npm run test:one -- tests/coop.spec.js   # one spec (same port — never alongside a full run)
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
                    fairness, hitbox, tension, toys, species, worldfun, coop,
                    spawnwarn, ascension) + shared helpers
public/
  favicon.svg       site icon
  original.html     wrapper page for the museum build (served OUTSIDE the gate)
  original/         byte-for-byte May 2025 original — never edit, never lint
  pad-test.html     standalone controller diagnostic (live pad/axis/button readout)
plans/              the audits + implementation plans + ROADMAP this overhaul follows
vercel.json         per-page security headers (CSP — see Deploying below)
.github/workflows/  CI: lint + build + full suite on PRs and main pushes
docs/elves/         autonomous-run docs (learnings + run plans)
CLAUDE.md           durable repo truth for agents (owns the exact test count)
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
4. Every push to `main` now auto-deploys. The repo's `vercel.json` adds
   security headers (nosniff, referrer policy) and a **per-page-scoped CSP**
   (plan 030): the live game page allows scripts from `self` only (Vite
   externalizes everything), while `/original*` and `/pad-test.html` carry
   their own inline-script allowances — and the `/original` archive uses a
   path-scoped CDN allowance for its one pinned three.js file instead of
   SRI, because the museum build is byte-frozen and cannot carry an
   `integrity` attribute. Headers are production-only (neither `vite dev`
   nor `vite preview` serves them): after a deploy, load `/`,
   `/original.html`, and `/pad-test.html` with the console open — zero CSP
   violations expected. The build itself needs no configuration.

Alternatively, from a machine with the Vercel CLI logged in: `npx vercel` then
`npx vercel --prod`.

## Ideas & history

The feature wishlist lives in [todo.md](todo.md). The 2026 overhaul (bug-fix
and feature plans, with verification steps) is documented under
[plans/](plans/README.md).
