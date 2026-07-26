# READ THIS FILE FIRST AFTER ANY COMPACTION OR RESTART

> This is the Survival Guide — persistent memory across compactions. If this file contradicts what
> you think you remember, trust this file. Read order after compaction: this file →
> `.elves-session.json` → `docs/elves/learnings.md` → `plans/README.md` → `docs/elves/execution-log.md`.

---

## Mission

Take BlockyGame (a father/son three.js browser arcade game, currently one 1000-line game.js) to
"the best version of itself": execute the 15 audit plans in `plans/` — tooling baseline, module
refactor, frame-rate independence, all verified gameplay/camera bug fixes, start/death screens,
high scores, sound, balance, mobile polish, docs, Vercel-deploy prep (docs only), and a movement
design spike. Every plan file is self-contained with steps, verification commands, and STOP
conditions. `plans/README.md` is the authoritative index and dependency graph.

---

## Run Control

- **Run mode:** finite (11 batches covering plans 001-015, then Final Completion)
- **Stop policy:** blocker-only until all batches complete
- **User intent:** "i want to do it all... take care of everything you have found" + "just work locally" + "no, commit locally to the branch"
- **Checkpoint due by:** none
- **Checkpoint semantics:** none
- **May continue after checkpoint:** yes (no checkpoints defined)
- **Actual stop conditions:** all 11 batches complete OR a plan STOP condition fires with no safe workaround OR hard environment failure
- **Workspace ownership:** owned branch `feat/best-version` in the main checkout (solo run; no other agents touch this repo)
- **Branch tip at start (collision tripwire):** `f4d3ecc1ca0a292ed42b09beb63a01343211dd48`
- **Merge policy:** user-merges (never merge; additionally NEVER PUSH — see LOCAL-ONLY MODE below)
- **Final-response policy:** disallowed until Stop Gate allows or a true blocker
- **Coordination mode:** Cobbler-first for non-trivial decisions; direct execution for mechanical plan steps
- **Batch completion rule:** every completed batch ends with `update execution log → update survival guide → commit` (LOCAL commit only — no push)
- **Re-read rule:** immediately after every commit, re-read this survival guide
- **Continuation rule:** if batches remain and stop conditions are not met, continue without waiting for acknowledgment
- **Review depth (user directive at launch):** LIGHT — one review pass per batch (fresh subagent or direct diff review), fix blockers, repair, commit, move on. No multi-cycle review churn. "complete the batch, commit with a progress report, review lightly, repair, commit, and move on"
- **Merge rule (reaffirmed at launch):** do not merge between batches or at the end; commit to the branch only
- **Bug rule (user directive, mid-Batch-1):** "fix any bugs you find along the way. make a note about that and continue. do not excuse 'pre-existing bugs'" — any real bug discovered during a batch gets a root-cause fix + a Decisions-made note, even if outside the plan's nominal scope. Note it, fix it, continue.

### LOCAL-ONLY MODE (user directive — overrides default elves PR flow)

The user explicitly said: **work locally, commit to the branch, no pushes, no PR.** GitHub push was
also verified DENIED for this machine's account (`RBrownHOPE` has read-only access to
`john-aigora/BlockyGame`). Therefore, for this entire run:

- `git push` is FORBIDDEN (would fail anyway). All "commit and push" steps in the elves framework
  become "commit locally".
- No PR exists. All "PR comments / PR polling / gh api" review steps are replaced by **local review
  subagents**: spawn a fresh read-only subagent per batch review with the diff
  (`git diff main...HEAD`), the plan file, the batch contract, and today's date. Record findings and
  dispositions in the execution log and `.elves-session.json` exactly as if they were PR comments.
- Rollback tags are local only (`git tag elves/pre-batch-N`, no tag push).
- Notification method: final chat response + Elves Report in /tmp. No PR comment, no Slack.
- The user opens the PR themselves after the run.

---

## Cobbler Session State

- **Cobbler default:** on
- **Activated by:** Elves invocation (staged run)
- **Scope:** current Elves run
- **Behavior:** treat non-trivial decisions (contract risks, review synthesis, ambiguous plan steps) as Cobbler-mediated; mechanical plan execution is direct
- **Persistence:** survival guide and `.elves-session.json`
- **Exit phrases:** "Cobbler Mode: off", "leave Cobbler Mode", "stop using Cobbler by default"

---

## Session Budget

- **Started:** 2026-07-25 (staging)
- **User returns:** unspecified — assume ~8-12h from launch
- **Checkpoint expectation:** none; deliver completed batches + Elves Report
- **Time budget:** ~10h from launch (soft; finite mode governed by batch completion)
- **Average batch time so far:** n/a
- **Batches remaining:** 11 of 11

---

## Stop Gate

- **Planned batches remaining:** 6
- **Stop allowed right now:** no — run launched via /goal; Stop hook enforces completion of all 11 batches.
- **Why:** batches remain.
- **Next required action:** execute Batch 6 (plan 008 start/death screens); tag elves/pre-batch-6 first.

### RESOLVED — Node.js toolchain (was a launch blocker)

The machine had no Node/npm/Homebrew. User said "install whatever you need" (2026-07-25), so
Node v22.23.1 LTS (official darwin-arm64 tarball, SHA-256 verified) was installed user-space at
`~/.local/elves-tools/node`. **EVERY shell in this run must start with:**

```bash
export PATH="$HOME/.local/elves-tools/node/bin:$PATH"
```

Shell state does not persist between tool calls — prepend this in each Bash invocation (or verify
`node --version` → v22.23.1 before npm commands). The Playwright Chromium download in Batch 1
(~130 MB) is covered by the same user approval.

---

## Effort Standard

- Work as hard as you can for the full run. Same effort on Batch 11 as Batch 1.
- Do not settle for the first green result when a plan's verification list has unchecked items.
- When one batch completes, immediately begin the next after the batch-close ritual.

---

## Forbidden Stop Reasons

Not valid reasons to stop while batches remain: a commit succeeded; a batch completed; tests are
green; the user is silent; you wrote a good summary; the remaining work feels large (it is supposed
to); this feels like a natural checkpoint (there is no one to check in with).

---

## Non-Negotiables

- **NEVER `git push`** in any form. This run is local-only by user directive (and push is denied anyway).
- **Never merge.** The user merges/PRs after the run.
- **Never run destructive git commands:** `git reset --hard`, `git checkout .`, `git clean -fd`, `git push --force`, `git rebase`. Never.
- **Never modify a test to make it pass.** Fix the code. If a test seems wrong, log it under Decisions made and move on.
- **Never introduce regressions:** before marking a batch complete, all pre-existing tests pass, total test count never decreases, cumulative diff (`git diff main...HEAD --stat`) contains no unexpected out-of-scope changes.
- **Honor each plan's STOP conditions.** They are per-plan tripwires written against the audited code; if one fires, log it, mark the batch BLOCKED in `.elves-session.json`, and move to the next batch whose dependencies are still satisfied (or halt if none).
- **Do not upgrade three.js beyond 0.128.0** and do not convert the project to TypeScript or a framework — explicitly rejected decisions recorded in `plans/README.md`.
- **Stage specific files** for every commit. Never `git add -A`.
- **The 4 smoke tests from plan 001 are the regression net** — keep them green at every batch boundary (plan 008 legitimately rewrites two of them; that plan says exactly how).

---

## Launch Readiness

- [x] Plan cleaned and saved to disk (`plans/` — 15 plans + README index; 015 visual pass and the plan-010 music amendment were added at staging by user mandate)
- [x] Survival guide updated from the current plan (this file)
- [x] Learnings file initialized (`docs/elves/learnings.md`)
- [x] Execution log initialized with batch breakdown and preflight notes
- [x] Branch created: `feat/best-version` (local only)
- [x] Branch/checkout ownership confirmed (solo run, main checkout)
- [x] PR: intentionally NOT created (local-only mode; user opens PR after the run)
- [x] Preflight run; critical failures: push access (resolved → local-only mode), **Node.js missing (OPEN — launch blocker)**
- [x] Run mode, non-negotiables recorded
- [x] Stop Gate initialized
- [x] Launch prompt prepared (see execution log Session Setup entry)

---

## Current Phase

**Status:** Staging complete — launch-ready, awaiting launch prompt

**Active batch:** none — Batch 1 complete

**What was just finished:** Full audit → 14 plans written to `plans/` → elves session scaffolding
created → local-only mode configured.

**Single next action:** Tag elves/pre-batch-2, execute Batch 2 (plan 002). (stale text below:
`npm --version`, `git status` clean), tag `elves/pre-batch-1`, then execute Batch 1 (plan 001).

---

## Active Compute

**No active paid or long-running compute.** (If a Vite dev server or Playwright webServer is left
running between batches, note it here and stop it during hygiene checks.)

---

## Next Exact Batch

**Batch:** 1: Tooling baseline (= plan `plans/001-tooling-baseline.md`, execute it verbatim)

**Scope:**
- package.json + exact-pinned three@0.128.0 + Vite + ESLint + Playwright
- ES-module entry conversion (mechanical, per plan steps)
- 4 DOM-level smoke tests
- production build verified

**Acceptance criteria:** the plan's own Done criteria checklist (lint 0 / 4 tests pass / build 0 /
no cdnjs reference / no out-of-scope modifications / plans/README.md row updated)

**Risk:** first npm install on a fresh machine (registry access, Playwright browser download ~130MB
— this download is pre-approved as part of `npx playwright install chromium` ONLY IF the user
approved the Node toolchain path; it is part of the standard toolchain install).

**Rollback tag:** `elves/pre-batch-1` (create before starting)

---

## Batch Map (10 batches ↔ 14 plans)

| Batch | Plans | Notes |
|-------|-------|-------|
| 1 | 001 | tooling baseline — everything depends on it |
| 2 | 002 | modularize + factory dedupe + dead code |
| 3 | 003 | deltaTime + game-clock timer |
| 4 | 004 + 006 | game-over gate; camera/zoom/fog (independent files) |
| 5 | 005 + 007 | toroidal world; rendering hygiene |
| 6 | 008 | start/death screens (rewrites 2 smoke tests — the plan says how) |
| 7 | 009 + 010 | high scores; sound (both hang off 008) |
| 8 | 011 + 012 | balance; mobile polish |
| 9 | 015 | visual "juice" pass — USER-MANDATED creative latitude ("surprise us with some beautiful graphical upgrades"); guardrails in the plan |
| 10 | 013 | docs truth pass + favicon/meta + deploy DOCS (Path A only — no vercel CLI, no push) — runs after 015 so docs/screenshots reflect the final look |
| 11 | 014 | LBS movement spike (timeboxed; writeup is the deliverable) |

Entropy checks after batches 3, 6, and 9. Each batch's contract = the plan file's own
Why/Steps/Done criteria; write the contract entry in the execution log referencing the plan file
plus any batch-specific notes.

---

## Post-Checkpoint Control Loop

After every commit: (1) what batch/task am I starting right now? (2) any active resources to stop?
(3) did the user change scope/stop behavior? — check for mid-turn user messages; (4) does the Stop
Gate say no? then continue immediately.

---

## Documentation Triggers

- Behavior changed → README/instructions (plan 013 does the big pass; keep incremental truth along the way — each plan says what docs it owns)
- Reusable lesson → `docs/elves/learnings.md`
- Run-state drift → this file + execution log

---

## Elves Report

- **Generate:** yes (substantial finite run) at Final Completion
- **Path:** `/tmp/elves-report-blockygame-<yyyy-mm-dd>.html`
- **Commit report:** no
- **Sources:** this file, `.elves-session.json`, execution log, learnings, `plans/README.md` status column
- **Note:** no PR/CI facts exist (local-only) — report says so explicitly rather than pretending

---

## Acceptance Checks (per batch)

- [ ] The executed plan's Done criteria all check off (or exceptions documented)
- [ ] `npm run lint` / `npm test` / `npm run build` green (from Batch 1 onward)
- [ ] Local review subagent ran on the batch diff; blocking findings fixed; dispositions recorded
- [ ] Execution log entry complete (incl. regression attestation + test-baseline comparison)
- [ ] `plans/README.md` status column updated for the plan(s) in the batch
- [ ] This file's Current Phase / Next Exact Batch / Stop Gate rewritten
- [ ] `.elves-session.json` updated
- [ ] Rollback tag existed before the batch started
- [ ] Batch closed with a LOCAL commit in the mandated format

---

## Tool Configuration

```yaml
# PREREQUISITE for every command below: export PATH="$HOME/.local/elves-tools/node/bin:$PATH"
lint: npm run lint          # exists after Batch 1
typecheck:                  # none — plain JS by decision (see plans/README.md rejected list)
build: npm run build        # exists after Batch 1
test: npm test              # Playwright; exists after Batch 1
e2e: npm test               # same suite (Playwright IS the e2e layer here)
smoke:                      # n/a — no deployment during run
review: local-review-subagent   # LOCAL-ONLY MODE; see Run Control
notification: chat-final-response + elves-report
```

---

## Rollback and Safety Rules

1. `git tag elves/pre-batch-N` before every batch (LOCAL tag only — never push).
2. Never force-push, rebase, or merge (see Non-Negotiables; push itself is forbidden).
3. If something goes badly wrong: `git checkout -b recovery/from-elves-pre-batch-N elves/pre-batch-N`, document, halt.
4. Stage specific files only.

---

## Batch Sizing

```yaml
team-size: 2
sprint-length: 1 week
notes: Batches are pre-scoped by the plan files (each S-M effort). Do not enlarge batches;
  the plans' STOP conditions assume their stated scope.
```

---

## Plan and Log Paths

- **Plan:** `plans/README.md` (index) + `plans/001..014-*.md` (per-batch specs)
- **Learnings:** `docs/elves/learnings.md`
- **Execution log:** `docs/elves/execution-log.md`
- **Branch:** `feat/best-version` (local)
- **PR number:** none — LOCAL-ONLY MODE (user opens PR post-run)
- **Plan hash at session start:** run `find plans -name '*.md' | sort | xargs md5 -q | md5 -q` → record in execution log at launch

---

## After Any Compaction

1. Read this file. 2. Run Control + Stop Gate (local-only mode! never push). 3. `.elves-session.json`.
4. Learnings. 5. `plans/README.md` + the active plan file. 6. Execution log (last completed batch).
7. Resume the Next Exact Batch immediately. Don't redo work marked complete. Don't push. Don't merge.

---

# READ THIS FILE FIRST AFTER ANY COMPACTION OR RESTART
