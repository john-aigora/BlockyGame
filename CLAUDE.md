# CLAUDE.md — Blocky Collector 3D

Durable repo truth for agents and humans. If a decision below changes (e.g.
adopting the movement spike, a three.js upgrade), update this file in the same
change. Run-ephemeral lessons live in `docs/elves/learnings.md`.

## Project shape

- Vanilla JavaScript ES modules + **three.js `0.128.0` — EXACT npm pin,
  deliberate; do not bump** (newer majors change color management and lighting
  defaults; upgrading is its own future project).
- Vite 8 dev/build. Playwright is the only test layer — specs drive the real
  game in a browser through the `window.__game` handle (`src/main.js`).
- The shipping mode is the endless world: a flat infinite plane with a
  floating origin. The retired classic arena (±100 torus) survives only as a
  test/debug path: `__game.debug.forceWorldMode('classic')`.
- An in-app password gate defers loading the game module; the password's ONLY
  source is `src/gate.js` (never re-declare the literal — audit SEC-3);
  `/original.html` is served outside the gate.

## Closed decisions (do not re-litigate)

- three.js stays pinned at `0.128.0` (exact).
- NO TypeScript in game code (`video/` is a separate npm project with its own
  tooling — exempt, and not linted here).
- No framework/ECS rewrite — modest ES modules on purpose.
- No Roblox port (different platform; separate project decision).
- `public/original/` is the byte-for-byte May 2025 museum build — never edit,
  never lint, never format.

## Invariants

- Game-over message text always contains "GAME OVER" (smoke + gameover specs
  assert on it).
- ALL entity-to-entity direction/distance math routes through
  `src/worldmath.js` (mode dispatch). Raw `subVectors`/`distanceTo` on world
  positions is the recurring bug class.
- Enemy body material is per-instance (the killable color flip is per enemy);
  sharing it repaints every enemy at once.
- Kill-indicator flash stays ≤3 flashes/sec (photosensitivity, WCAG 2.3.1);
  currently 1 Hz (`src/ui.js`).
- Every balance/tuning knob lives in the GAME BALANCE block of
  `src/constants.js` with a rationale comment — nowhere else.

## Testing rules

- **Game time ≠ wall time.** The `MAX_DELTA = 0.05` clamp (`src/game.js`)
  dilates game time under load. Never time gameplay with `performance.now()`
  deltas or fixed `waitForTimeout`s — wait on `state.runTime` via
  `tests/helpers.js` (`waitForGameOver`, `waitGameSeconds`) or
  condition-based polls.
- Specs stay DOM-level or `window.__game`-level; don't couple to internals
  that refactors rename.
- Suite is ~5 min on port 5173. Never run two suites at once (port clash +
  load-induced flakes).

## Commands

Node is user-space on this machine — every shell first:

```bash
export PATH="$HOME/.local/elves-tools/node/bin:$PATH"
```

| Command | What |
|---|---|
| `npm run dev` | dev server at http://localhost:5173 |
| `npm test` | Playwright suite |
| `npm run lint` | ESLint |
| `npm run build` | production build into `dist/` |
| `npm run preview` | serve the production build |

Node 20.19+ or 22.12+ (`package.json` `engines`, `.nvmrc`).
