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

- **NOW**: B2b worker — plan 021 alone (docs truth + CLAUDE.md). Preserve
  018's readme DB9 line; ADD one sentence to the readme hardware note: the
  FIRST button press on a not-yet-active pad claims it and is deliberately
  swallowed — wiggle/press once, then play (B2+B3 review advisory 5).
- Then B4 (022) with driver-granted extra: behind-camera arrow edge push uses
  a fixed NDC 1000 which corner-quantizes bearings — scale by
  `1.001 / max(|x|,|y|)` instead to keep the true edge point (review adv. 3).
- Then B5 (023) → B6 (024) → B7 (025) → B8 (026) → B9 (027) → B10 (028).
- Loop per batch: worker → driver verify → fresh review → reconcile
  (Review-phase commit) → guide/log update → next batch.

## Deferred hygiene

(bank advisory nits here; drain at terminal — mostly plan 027 territory)
- H1 (B1 review): tests/hiscores.spec.js:55-63 corrupt-storage spec stranded on
  dead classic key — convert to endless key so the try/catch is actually tested.
- H2 (B1 review): ranking specs seed rank-correlated score+distance — seed one
  low-score/high-distance row so distance-first ranking is discriminated.
- H3 (B1 worker+review): camera.spec.js:26 latent enemy-contact race (32 live
  clicks vs idle death) — despawn-then-click or drive zoom via debug handle.
- H4 (B1 review): effects.spec.js:97 missing the 200ms settle its siblings use.
- H5 (B2+B3 review adv.2, → B9): mobile-tier DPR assertion vacuous — add
  `deviceScaleFactor: 3` to the mobile test.use so the 1.5-vs-2 cap is pinned.
- H6 (adv.1, → B8): pickup boxes still render-tree (`game.js:391,394`) —
  unify on body-block builders during the players[] refactor (also a per-frame
  setFromObject cost); pair with adv.11: `setPlayerCollisionBox` must take
  `(box, player, scale)` for per-player reuse.
- H7 (adv.3, → B4): arrow edge push corner-quantizes — granted to B4 prompt.
- H8 (adv.7, → B10): chunk-cull `userData.registered` hardening for the
  reset-twice-without-render path (unreachable today).
- H9 (adv.4, log-only): C-6 diagonal grace band narrowed not eliminated —
  benign residual, documented; no action planned.
- H10 (adv.8, done in log): perf reference rig = the 3-enemy deterministic
  ring; 29f04d3's settled-run numbers are NOT the plan-028 baseline.

## Decisions made

- 2026-08-07: No worktree (single-user; dev server configs point at this dir).
- 2026-08-07: `.elves-session.json` tracked during the run (not gitignored);
  removed at final completion per contract.
- 2026-08-07: B2 pairs 018+021 (disjoint surfaces: input.js/tests vs docs).
  B3 pairs 019+020 — BOTH touch src/ui.js and src/enemies.js lightly; run 019
  first inside the batch, then 020 rebased on it (sequential within batch).
