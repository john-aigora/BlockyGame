# Coordinator → Implementer Packet — feat/audit-2026-08

(Consolidated packet; each batch launch adds: batch id, plan path(s), HEAD SHA.)

1. **Intent/why**: Ship the 2026-08-14 roadmap (`plans/ROADMAP.md`) as plans
   029–036: the owner's Ascension ceremony ends the runaway grow/eat loop as
   a win (issue #6) and structurally retires the giant-scale bug family
   (#18); 031/033 fix the vetted 2P and polish bugs (#7–#15); 030/032 harden
   CSP/CI/docs (#16–#17); 034–036 are the fun wave. Each plan file is fully
   self-contained (verified excerpts at `c1ffd13`, ordered steps,
   per-step verification, Done criteria, STOP conditions). The audit evidence
   is `plans/README.md` §2026-08-14 + the issue bodies.
2. **Non-obvious rationale**: Game time ≠ wall time in specs (MAX_DELTA
   dilation) — wait on `state.runTime` / `debug.advance`, never wall-clock.
   Five specs assert `#death-title` has EXACT text `GAME OVER` — 029 swaps
   the title per show and must restore it on every death show. Solo behavior
   below the new features must stay byte-stable (the 154-test baseline is
   the law). three.js is pinned 0.128.0 — never bump. No TypeScript in game
   code. `public/original/` is a byte-for-byte museum — never touch. Balance
   knobs ONLY in `src/constants.js` GAME BALANCE with rationale comments.
   constants.js must stay Node-importable (no unguarded browser globals).
   Pooled-resource law: specs pin geometry/texture plateaus — build meshes
   once, park with `visible = false` (the foodArrows pattern).
3. **Build on**: each plan's "Current state" section names the exact systems
   and exemplar patterns to extend — extend, don't fork. Import-graph rule:
   new modules (ascension.js, ghost.js) are imported ONLY by game.js; other
   modules read state fields, never the module (avoids new cycles; 033
   removes the one that exists).
4. **Owned surfaces**: exactly the plan's "In scope" list for your batch.
5. **Forbidden**: the plan's "Out of scope" + merges, tags, `main`,
   `public/original/`, `dist/`, deleting/weakening tests for green, other
   batches' plan files, and any remote except `fork` branch
   `feat/audit-2026-08`. Trusted workers may commit AND push meaningful
   slices to that one branch only. Never edit `.github/workflows` outside
   plan 032's scope.
6. **Acceptance evidence**: the plan's Done criteria checklist — produce
   each command's output; write per-criterion evidence into your final
   report AND update your batch entry in `.elves-session.json`
   (`acceptance: [{id: "B#-A#", criterion, met, evidence}]` — ids from
   `docs/elves/run-2026-08-14-plan.md`).
7. **Failure modes**: honor the plan's STOP conditions verbatim — stop and
   report, don't improvise. Environment: every shell needs
   `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"`. The Playwright
   suite (~8-9 min) runs ALONE on port 5173 — before any suite run check
   `lsof -nP -iTCP:5173 -sTCP:LISTEN` and never proceed against a foreign
   listener. If a verification fails twice after a reasonable fix, STOP per
   plan. Maintain the untracked progress ledger at
   `.elves/runtime/worker-progress-<batch>.md` (files read, decisions, next
   exact action) from your first orientation milestone.
8. **Identity/output**: Commit style
   `[feat/audit-2026-08 · Batch N/9 · Contract|Implement|Validate|Review|Close] <concrete outcome>`
   — push the first slice as soon as a failing test or first surface change
   exists; never one monolithic Close. Exactly ONE acceptance-backed Close
   commit per batch, ending with a Confidence trailer
   (`Confidence: <level>` or `Confidence: <level> — unsure: <item; item>`).
   Run-doc paths: plan `docs/elves/run-2026-08-14-plan.md`, guide
   `docs/elves/survival-guide.md`, log `docs/elves/execution-log.md`,
   session `.elves-session.json`. Final message = report: what shipped, Done
   criteria evidence per id, deviations, deferred-hygiene candidates, and
   anything the terminal reviewer should scrutinize.
