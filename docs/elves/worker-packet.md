# Coordinator → Implementer Packet — feat/audit-coop-2026

(Consolidated packet; each batch launch adds: batch id, plan path(s), HEAD SHA.)

1. **Intent/why**: Ship the 2026-07-31 audit remediation + the owner's two new
   requests (working joysticks; two-player split-screen) as plans 017–028. Each
   plan file is fully self-contained (context, excerpts, steps, per-step
   verification, Done criteria, STOP conditions). The audit evidence behind
   every finding is `plans/audit-2026-07-31.md`.
2. **Non-obvious rationale**: The suite is RED on main by design-drift (stale
   classic-mode specs) — plan 017 repairs tests, not game code. Game time ≠
   wall time in tests (MAX_DELTA dilation): wait on `state.runTime`
   (`tests/helpers.js`). three.js is pinned 0.128.0 — never bump. No
   TypeScript in game code. `public/original/` is a byte-for-byte museum —
   never touch.
3. **Build on**: existing systems named per plan ("Current state" sections);
   extend, don't fork. Balance knobs ONLY in `src/constants.js` GAME BALANCE
   with rationale comments.
4. **Owned surfaces**: exactly the plan's "In scope" list for your batch.
5. **Forbidden**: the plan's "Out of scope" + `git push` (NEVER — read-only
   remote + owner rule), merges, tags, `main`, `public/original/`, `dist/`,
   deleting/weakening tests for green, other batches' plan files.
6. **Acceptance evidence**: the plan's Done criteria checklist — produce each
   command's output; write per-criterion evidence into your final report AND
   update your batch entry acceptance in `.elves-session.json` (id = plan
   number, criterion text, met, one-line evidence).
7. **Failure modes**: honor the plan's STOP conditions verbatim — stop and
   report, don't improvise. Environment: every shell needs
   `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"`. Playwright suite
   ~4 min; run serially (`--workers=1`) when diagnosing; never two suites at
   once. If a verification fails twice after a reasonable fix, STOP per plan.
8. **Identity/output**: Commit style
   `[feat/audit-coop-2026 · Batch N/10 · Contract|Implement|Validate|Review|Close] <concrete outcome>`
   — commit meaningful slices (first slice as soon as a failing test or first
   surface change exists; never one monolithic Close). Exactly ONE
   acceptance-backed Close commit per batch, ending with a Confidence trailer:
   `Confidence: <high|medium|low>` or
   `Confidence: <level> — unsure: <item; item>`. NEVER push. Keep an untracked
   progress ledger at `.elves/runtime/worker-progress-<batch>.md` (files read,
   decisions, next exact action). Final message = report: what shipped, Done
   criteria table with evidence, STOPs hit (if any), unsure_about list.
