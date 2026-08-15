# Survival Guide — feat/audit-2026-08

> Read me first after any compaction. Then `.elves-session.json`, learnings,
> run plan (`docs/elves/run-2026-08-14-plan.md`), execution log, plan files
> (`plans/029-…036`, `plans/ROADMAP.md`).

## Stop Gate

- Run mode: **finite** — ends when B1–B9 complete (or hard-blocked).
- Stop allowed right now: **no** (staged; batches pending). Allowed when: all
  batches closed + readiness gate green + landable PR open + Elves report
  written, OR user says stop, OR hard stop condition.

## Run Control

- Branch: `feat/audit-2026-08` (base `plans/audit-2026-08-14@87262a6`, which
  is `main@c1ffd13` + the plans commit). One branch, one checkout (this repo
  dir; no worktree — recorded decision, see below). START_TIP / start_head:
  `87262a64c9a22249521233bd79b0bbb24f6779ab`.
- Work driver: native subagent workers per batch (same-model lower-effort
  delegation per skill defaults); host-native fallback. Prewalk: `auto`.
  Parallel lanes: **off** — declined `parallel_declined:shared_surfaces:
  constants.js/game.js/ui.js appear in nearly every batch's scope`.
  Cobbler default for session: ON (native-first, no external providers).
- Worker packet: `docs/elves/worker-packet.md` (consolidated; per-batch
  launch adds batch id + plan path(s) + current HEAD).
- Review: per-batch fresh read-only subagent reviews
  `git diff <batch-start>..HEAD` against the plan's Done criteria (pass
  today's date). Terminal: ONE cumulative review of
  `git diff main...HEAD` with the Confidence-triage table built from the
  Close-commit trailers.
- **Push: ALLOWED and expected** — to remote `fork`
  (RBrownHOPE/BlockyGame), branch `feat/audit-2026-08` ONLY. origin
  (john-aigora/BlockyGame) is read-only for this account (403). The old
  "never push" rule in learnings.md:36 is DEAD (superseded; B5 fixes the
  doc). Never push main, never merge, never tag.
- Merge-on-green: **NO**. Terminal = landable PR on john-aigora/BlockyGame
  (base main) with Fixes #6-#17 / References #18 lines; the user merges.
  PR #19 (plans-only, same base content) stays open for the owner — note the
  supersession in the run PR body.
- Rollback refs: `refs/elves/rollback/audit-2026-08/bN` before each batch.
- Batch order: B1[029] → B2[031] → B3[033] → B4[030] → B5[032] → B6[034] →
  B7[035] → B8[036] → B9[terminal: docs re-touch + gates ×2 + report +
  PR + cleanup].

## Environment

- `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` in EVERY shell
  (npm shebang fails without it, even by absolute path).
- Gates: `npm run lint` · `npm test` (Playwright, ~154+ tests, ~8-9 min at
  3 workers, port 5173) · `npm run build`. Baseline at start_head:
  154/154 green, lint 0, build 0 (verified 2026-08-14).
- Do NOT run two suites concurrently, and BEFORE any suite run check for a
  foreign 5173 listener (`lsof -nP -iTCP:5173 -sTCP:LISTEN`) — Playwright's
  `reuseExistingServer` would silently test the wrong checkout. Kill or
  wait it out; never proceed against a foreign server.
- Browser pane throttles rAF — never judge game speed there; headless
  Playwright only.
- Game time ≠ wall time in specs: wait on `state.runTime` via helpers or
  `debug.advance`; `waitForTimeout` is lint-banned in tests/.

## Next action

- **NOW**: run is STAGED, not launched. On launch: create rollback ref b1,
  launch B1 worker (plan 029) with the packet + batch header, then follow
  the loop: verify gates, fresh-subagent review, reconcile, record
  acceptance evidence in `.elves-session.json` + execution log, commit
  `[feat/audit-2026-08 · Batch 1/9 · Close] …` with Confidence trailer,
  push to fork, re-read this guide, proceed to B2.

## Deferred hygiene

(bank advisory nits here; drain at B9)

- none yet

## Decisions made

- 2026-08-14: No worktree — same recorded rationale as the 2026-08-07 run
  (single-user machine; port-5173 dev-server identity trap makes a second
  checkout actively dangerous for suite runs). The checkout is RESERVED for
  the run while active; the 5173 listener check above is the guard.
- 2026-08-14: `.elves-session.json` tracked during the run; removed at final
  completion per contract (with run docs; run plan + learnings kept).
- 2026-08-14: Batch order puts the code-heavy plans (029, 031, 033) first
  while context is hottest; 032's exact-count docs get a B9 re-touch because
  B6–B8 add specs after B5 lands.
- 2026-08-14: Issues #6–#18 pre-exist on the upstream repo; the terminal PR
  body carries the Fixes/References mapping (run plan Notes). Do not file
  duplicates for known findings.
