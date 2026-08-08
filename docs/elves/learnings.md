# Project Learnings

> Durable repo truth now lives in /CLAUDE.md; this file keeps run-specific lessons.
> Read after the survival guide and `.elves-session.json`, before the plan and
> execution log. Promote only reusable, stable, actionable, specific lessons. Batch
> status and one-off debugging belong in the execution log.

---

## Repo Conventions

- [2026-07-25] Commit style in history uses `Fix:` / `Feat:` / `Chore:` / `Refactor:` / `Doc:` prefixes; during elves runs the mandated format is `[feat/best-version · Batch N/10] <verb> <what>` which supersedes it for run commits.
- [2026-07-25] Deliberately rejected decisions (do NOT "improve" into them): three.js stays pinned at 0.128.0; no TypeScript; no framework rewrite. Rationale recorded in `plans/README.md` § "Findings considered and rejected".
- [2026-07-25] All game tuning constants belong in `src/constants.js` (post-plan-002); plan 011 adds a labeled GAME BALANCE block that is the only sanctioned place for balance knobs.

## Validation and Tooling

- [2026-07-25] Node is NOT system-installed. Toolchain lives at `~/.local/elves-tools/node` (v22.23.1, user-space). Every shell needs `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` — shell state does not persist between tool calls.
- [2026-07-25] The in-app browser pane throttles rAF and timers for occluded tabs — gameplay observed there freezes while wall-clock timers keep running. Do NOT use the browser pane to judge game speed or enemy motion; use headless Playwright (normal rAF) or a real browser window. (This throttling is also why plan 003 exists.)
- [2026-07-25] Smoke tests are deliberately DOM-only (`#score`, `#message-box`, etc.) so they survive the module refactor. Keep new tests DOM-or-`window.__game`-level; don't couple to internals that later plans rename.

## Review Heuristics

- [2026-07-25] LOCAL-ONLY run: there are no PR bots. The review loop is a fresh read-only subagent per batch given the diff, the plan file, the contract, and today's date. It must check plan Done-criteria completeness, not just code quality.
- [2026-07-25] The plan files carry per-plan STOP conditions written against audited code excerpts; a reviewer flagging "the excerpt doesn't match the code" means STOP that batch, not improvise.

## Product and Domain Invariants

- [2026-07-25] Game-over message text must always contain "GAME OVER" (smoke tests + plan 004/008 assert on it).
- [2026-07-25, corrected 2026-08-08] The shipping world (endless) is a flat infinite plane with a floating origin; the retired classic arena was a ±100 torus. ALL entity-to-entity direction/distance math still routes through `src/worldmath.js` (mode dispatch). Raw `subVectors`/`distanceTo` on world positions is the recurring bug class.
- [2026-07-25] Enemy body material must be per-instance (killable color flips per enemy); sharing it repaints every enemy at once (plan 007 documents this trap).
- [2026-07-25] Kill-indicator flash must stay ≤3 flashes/sec (photosensitivity, WCAG 2.3.1); plan 007 sets 1 Hz.

## Known Traps

- [2026-07-25] Push to origin is DENIED (account RBrownHOPE is read-only on john-aigora/BlockyGame) and the user forbade pushing anyway. Never `git push` this run.
- [2026-07-25] `isMobile` UA-sniffing falsely matches touch laptops (until plan 012 replaces it with `pointer: coarse`).
- [2026-07-25] npm's shebang (`#!/usr/bin/env node`) fails if node isn't on PATH even when called by absolute path — always export PATH first.
- [2026-08-07] Dual-port DB9→USB adapters (HuiJia, VID 0e8f PID 3013) enumerate a permanently-connected ghost interface, often with the SAME id string as the live socket. Pad selection must re-scan all pads for activity EVERY poll — never hold a preferred lock on an idle pad when another pad is producing input (plan 018) — and identity is by `gamepad.index` only, never id/name.
- [2026-08-08] three r128 `renderer.info` RESETS on every `render()` call — with two render passes per frame (plan 026 split-screen) the counters show only the LAST half. perfInfo needs `info.autoReset = false` + ONE `info.reset()` at frame start (game.js animate) — byte-identical numbers for a single render, whole-frame sums for many. `info.memory` (geometries/textures) is never reset and stays valid either way.
- [2026-08-08] Choreography specs that despawn enemies each hop (`s.enemies = []`) must ALSO clear the warn pipeline (`debug.clearPendingSpawns()`): a pending red disc materializes a full-size hunter onto the next teleport landing and ends the run mid-loop — a frozen game clock then hangs every game-clock wait until the test times out (surfaced twice in effects pool spec under 3-worker load; solo-green both times).
- [2026-07-26] Game time is NOT wall time in tests. Concurrent Playwright suites (or other agents on the machine) push headless software rendering below 20fps, and the MAX_DELTA=0.05 clamp in `src/game.js` then dilates game time to a fraction of wall clock. Specs must time gameplay against `state.runTime` (the dt-accumulated run clock) or condition-based waits with generous wall ceilings — never `performance.now()` deltas or fixed `waitForTimeout`s around game-clock behavior. See `tests/helpers.js` (`waitForGameOver`, `waitGameSeconds`).

## Retired Learnings

- [retired 2026-08-08] "The world is a torus (±100 wrap on X/Z). ALL entity-to-entity direction/distance math must go through `src/worldmath.js` (post-plan-005)." — superseded by the classic retirement (87771ab); the torus is true only of the retired classic mode. The worldmath routing rule survives, corrected, under Product and Domain Invariants.
