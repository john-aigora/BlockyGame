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

- The end-screen title (`#death-title`) is written per show (plan 029):
  a run containing NO ascension always restores exactly "GAME OVER" (smoke +
  gameover + coop + hiscores specs assert the exact text); an ascension end
  shows "ASCENDED!" — and a 2P run where EITHER seat ascended is a crowned
  team run and shows "ASCENDED!" even when the final end was the partner's
  death (deliberate; ascension spec pins both directions).
- Growth ends at `ASCENSION_SCALE` (251, the 2500th block): the ascension ceremony is the run's
  win condition — new features must respect an ascending player's stand-down
  (untargetable, uncollidable, clock-frozen; grep `player.ascension` gates).
- ALL entity-to-entity direction/distance math routes through
  `src/worldmath.js` (mode dispatch). Raw `subVectors`/`distanceTo` on world
  positions is the recurring bug class.
- Enemy body material is per-instance (the killable color flip is per enemy);
  sharing it repaints every enemy at once.
- Kill-indicator flash stays ≤3 flashes/sec (photosensitivity, WCAG 2.3.1);
  currently 1 Hz (`src/ui.js`).
- Every balance/tuning knob lives in the GAME BALANCE block of
  `src/constants.js` with a rationale comment — nowhere else.

## Two-player architecture (plan 026)

- The roster is `state.players[]` (`makePlayerState(seat)`); each entry owns
  its hero mesh, camera, gameplay scale, score, collect clock, combo, danger
  state, and jump. The classic singleton names (`state.player`,
  `state.playerScale`, `state.score`, `state.collectTimeLeft`, …) are
  DELEGATES to `players[0]` — always safe to read, but per-player code must
  iterate the roster, never the aliases.
- **Solo must stay byte-stable**: every 2P behavior hangs off an additive
  `coopMode()` / `players.length >= 2` branch with the solo path falling
  through unchanged (single full-rect render, no scissor, solo caps). A 2P
  change that edits a solo code path needs a solo regression spec in the
  same commit.
- Per-VIEWER truth: edibility colors/arrows are repainted per half per frame;
  per-PLAYER state (beats, clocks, near-miss arming) is keyed by seat.
  Harmless species are excluded from every threat surface for every viewer.

## Testing rules

- **Game time ≠ wall time.** The `MAX_DELTA = 0.05` clamp (`src/game.js`)
  dilates game time under load. Never time gameplay with `performance.now()`
  deltas or fixed `waitForTimeout`s — wait on `state.runTime` via
  `tests/helpers.js` (`waitForGameOver`, `waitGameSeconds`) or
  condition-based polls.
- Specs stay DOM-level or `window.__game`-level; don't couple to internals
  that refactors rename.
- Suite is ~8-9 min on port 5173 (180 tests, 3 workers — THIS file owns the
  exact count; other docs say "~150+"). `npm run test:one -- tests/<file>`
  runs one spec (same port — never alongside a full run). Never run two suites
  at once (port clash + load-induced flakes).

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
