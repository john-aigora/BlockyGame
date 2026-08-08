# Survival Guide — feat/audit-coop-2026

> Read me first after any compaction. Then `.elves-session.json`, learnings,
> run plan (`docs/elves/run-2026-08-07-plan.md`), execution log, plan files.

## Stop Gate

- Run mode: **finite** — ends when B1–B10 complete (or hard-blocked).
- Stop allowed right now: **no** (work remaining). Allowed when: all batches
  closed + readiness gate green + Elves report written, OR user says stop, OR
  hard stop condition.

## Run Control

- Branch: `feat/audit-coop-2026` (base `main@128d18e`). One branch, one checkout
  (this repo dir; no worktree — single-user machine, no other agents).
- Work driver: native subagent workers per batch; host-native fallback.
  Cobbler default for session: ON (native-first, no external providers).
- Worker packet: `docs/elves/worker-packet.md` (consolidated; per-batch prompt
  adds batch id + plan path + current HEAD).
- Review: LOCAL-ONLY — no PRs/bots. Fresh read-only subagent per batch reviews
  `git diff <batch-start>..HEAD` against the plan's Done criteria + today's date.
  Terminal: one cumulative review of `git diff main...HEAD`.
- Merge-on-green: **NO**. Never push, never merge (see run plan non-negotiables).
- Rollback refs: `refs/elves/rollback/audit-coop-2026/bN` before each batch.
- Batch order: B1[017] → B2[018,021] → B3[019,020] → B4[022] → B5[023] →
  B6[024] → B7[025] → B8[026] → B9[027] → B10[028+final docs+report].

## Environment

- `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` in EVERY shell
  (npm shebang fails without it, even by absolute path).
- Gates: `npm run lint` · `npm test` (Playwright, ~4 min, port 5173) ·
  `npm run build`. Suite is RED until B1 lands — that is B1's job.
- Browser pane throttles rAF — never judge game speed there; headless
  Playwright only.
- Do NOT run two suites concurrently (port + load-flake trap,
  learnings.md:38).

## Next action

- **NOW**: Launch B1 worker (plan 017). After its completion: verify gates
  myself, fresh-subagent review, reconcile, mark B1 in session json + execution
  log, commit `[feat/audit-coop-2026 · Batch 1/10 · Close] …`, re-read this
  guide, proceed to B2.

## Deferred hygiene

(bank advisory nits here; drain at terminal)
- none yet

## Decisions made

- 2026-08-07: No worktree (single-user; dev server configs point at this dir).
- 2026-08-07: `.elves-session.json` tracked during the run (not gitignored);
  removed at final completion per contract.
- 2026-08-07: B2 pairs 018+021 (disjoint surfaces: input.js/tests vs docs).
  B3 pairs 019+020 — BOTH touch src/ui.js and src/enemies.js lightly; run 019
  first inside the batch, then 020 rebased on it (sequential within batch).
