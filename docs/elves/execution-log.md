# Execution Log — feat/audit-coop-2026

## 2026-08-07 — Staging

- Deep audit (2026-07-31, `plans/audit-2026-07-31.md`) delivered; owner selected
  ALL bundles + two new requests: two-player split-screen (plan 026), joystick
  fix (plan 018 — root cause found in pad-selection lock vs battle-paddle's
  hardened fork of the same code; HuiJia dual DB9→USB ghost-interface class).
- Plans 017–028 written (improve skill, executor-grade); index + batch order in
  `plans/README.md`. Branch `feat/audit-coop-2026` off `main@128d18e`; staging
  commit `b6b3758` (14 files, 2,906 insertions).
- Known-red baseline recorded: 7 stale specs + 78 lint errors (video/) — B1/017
  repairs. Full attribution in audit BASE-1.
- Run docs + session json written; preflight next; then B1 launch.

## 2026-08-07 — B1 (plan 017): baseline repair + CI — COMPLETE

- Lint green: `video/` (separate Remotion project) added to eslint ignores — 78
  no-undef errors gone, exit 0.
- All 7 stale specs converted to endless semantics with intent preserved:
  hiscores → endless key + distance ranking; balance combo → game-clock settle
  for the warn/materialize pipeline; cap test → deterministic warn-pipeline
  ticks, endless cap 12 asserted saturating past classic 8; effects/resources →
  full warm-up + terrain `queued === 0` before geometry sampling (≤1 deltas
  unchanged); endless-stream rotation → ticks `debug.updateSpawnWarnings`
  (the one added `src/main.js` debug entry).
- Playwright config: trace/screenshot/video retain-on-failure + list/html
  reporter, and `workers: 3` — at 5 (default) and 4, recording load + software
  GL starved frames and idle players died mid-choreography (camera:26, combo);
  serially everything passed. `.github/workflows/ci.yml` created; readme's
  stale "61 tests" now points at `--list`.
- Gate: `npm test` twice consecutively → 79 passed / 0 failed (4.6m, 4.7m).
  No plan STOP conditions hit. Plan 017 row → DONE.

## 2026-08-07 — B1 review + driver reconcile

- Fresh-context review verdict: APPROVE-WITH-ADVISORIES, zero blockers. Every
  rewritten spec still fails on its original bug (cap path, pool premises, and
  ranking traced to source); scope clean; ci.yml valid by line-read.
- Reconciled now (driver, Review phase): workers CI-aware (`CI ? 1 : 3` +
  `retries CI ? 1 : 0` — 3 workers on a 2-4 vCPU runner is worse contention
  than the 4-of-10 that flaked locally); ci.yml hardening (permissions,
  concurrency-cancel, timeout-minutes 30); main.js handle comment no longer
  claims read-only; .gitignore now covers .claude/ and .elves/.
- Banked to deferred hygiene: H1 stranded corrupt-storage spec, H2 ranking
  discrimination seed, H3 camera:26 race, H4 settle consistency (drain in B9).

## 2026-08-08 — B2 worker: 018 landed, batch BLOCKED before 021

- Plan 018 shipped (5c86b53, f486a8d, e288660, a27cd67): activity-gated
  standard-mapping bias, rescan-first `activeGamepad` (activity outranks the
  lock), per-pad edge state (Map by `gamepad.index`, hand-off seeds not
  fires), `installMockPads` multi-pad harness in helpers, 4 DB9-adapter
  regression tests (each proven red against pre-fix input.js), readme Pad
  DB9 line + learnings Known Trap. Gamepad spec 10/10; lint 0.
- HARDWARE CHECK PENDING FAMILY: verify on real sticks via `?paddebug=1` —
  both adapter ports, one at a time, should each drive the player after one
  wiggle. Never claimed done.
- BLOCKED: `npm test` red 5/5 attempts (82/83 — only balance.spec.js:42
  combo). Evidence: solo 10-rep A/B ~50% fail on BOTH HEAD and 4c07c00 code
  (latent race, pre-existing); full-suite A/B: 4c07c00 green 79/79 same
  machine/hour, HEAD red 5/5 → the +4 gamepad tests re-tile the 3-worker
  schedule and the latent race now lands red under load. Instrumented probes:
  at teleport, enemies[0] is small (sy 9-13), fully materialized, killable
  and fleeing; every enemy satisfies wouldKill — yet ~half of reps die on
  the teleport frame with score unchanged (suspect: stale `killable`/AABB
  frame-order race in the collision path). Fix lives in balance.spec.js
  and/or enemies.js-game.js ordering — OUT OF B2 SCOPE (019/027 territory).
- Per packet STOP rule: stopped before 021 (gate "suite green" unmet). No
  test weakened; no lottery reruns claimed as green. Driver decides: patch
  the combo choreography under 027/019 authority, then 021 can run.

## 2026-08-08 — Driver reconcile: B2 split, B3 pulled forward with race authority

- Driver verified 018: gamepad spec 10/10 (--workers=1, 35.9s), lint 0, clean
  commit history 5c86b53..42967b1. The worker's stop was CORRECT per contract.
- Decision: B3 (019 fairness + 020 perf) launches NOW with added authority to
  stabilize balance.spec.js:42 — plan 019 Steps 1-2 (dead-run guard, explicit
  hitboxes) are the suspect surfaces per B2's probe data; if a game-code fix
  alone doesn't stabilize, the spec choreography may be adjusted with intent
  preserved (two rapid kills pay > 2x single bounty). 021 becomes B2b after B3.
- B2's fresh review is deferred and COMBINED with B3's (window 4c07c00..B3
  close) so one reviewer sees the pad work plus what builds on it.
