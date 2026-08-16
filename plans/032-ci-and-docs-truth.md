# Plan 032: CI completes the verification story; every doc tells the truth again

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. On
> any STOP condition, stop and report. When done, update the status row in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c1ffd13..HEAD -- .github/ package.json readme.md CLAUDE.md todo.md docs/elves/learnings.md eslint.config.js tests/`
> On drift, compare excerpts below against live code; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: none (if plan 029 landed first, take the test COUNT from a
  fresh suite run, not from this plan's numbers)
- **Category**: dx / docs
- **Planned at**: commit `c1ffd13`, 2026-08-14

## Why this matters

The repo's agent-facing docs have drifted from reality in ways that would
make the next agent redo landed work or refuse to push: `plans/README.md`
claims the 017-028 run is "unmerged, never pushed" (it merged as PR #4;
PR #5 followed), three files state three different suite sizes (real: 154
tests, ~8.3 min measured 2026-08-14), `todo.md` marks shipped features
unstarted and still carries a Roblox section that `CLAUDE.md` closed, and
five live lessons sit under a "Retired Learnings" heading. Meanwhile CI —
the repo's whole verification story — never runs `npm run build` (the one
check every human run did by hand), reinstalls Chromium every run, and runs
the full suite twice per PR.

## Current state (verified excerpts, at `c1ffd13`)

### `.github/workflows/ci.yml` (the whole file is 37 lines)

```yaml
on:
  push:
  pull_request:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npx playwright install --with-deps chromium
      - run: npm test
      - name: Upload failure report
        if: failure()
        ...
```

No build step; no Playwright browser cache; `on: push` unqualified means a
PR branch runs twice (`refs/heads/x` and `refs/pull/N/merge` are different
concurrency groups).

### Doc drift (each verified against git/code on 2026-08-14)

- `plans/README.md:46-49`: "run COMPLETE on `feat/audit-coop-2026`
  (unmerged, never pushed)…" — FALSE: `1460e3b` is "Merge pull request #4
  … feat/audit-coop-2026" on main; the branch exists on the fork remote.
  *(The plans/README.md portion was already corrected during the 2026-08-14
  audit reconciliation — verify, and fix only what remains.)*
- `plans/README.md:41` RED-main note; `:98` "Never push to origin" — both
  obsolete (fix if still present).
- `CLAUDE.md:71`: "~7 min … (150 tests…)" — real: 154 tests, 8.3 min
  measured. `docs/elves/learnings.md:49`: "151 tests".
- `docs/elves/learnings.md:44-51`: heading `## Retired Learnings` — only
  line 46 carries a real `[retired …]` marker; entries at 47-51 (class-not-ID
  CSS, render-tree≠hitbox, wall-clock→game-clock conversion, measure-first,
  species-invariant sweep) are live lessons and must move up under the
  file's active sections. `learnings.md:36` repeats the dead never-push rule.
- `todo.md:41-48`: juja/species/boss items unchecked but SHIPPED
  (`src/constants.js:34-38` species table; `:59` BOSS_DISTANCE);
  `todo.md:63-72` Roblox+Robux section contradicts `CLAUDE.md:27` closed
  decision; `todo.md:125` "daily high score (requires backend)" — the local
  TODAY'S BEST board shipped.
- `readme.md:128-162` structure map: no `public/` block at all —
  `pad-test.html` (the controller-troubleshooting page built for the
  plan-018 family hardware check) is referenced NOWHERE in any doc;
  `original.html`, `favicon.svg`, `vercel.json`, `.github/`, `docs/` also
  unlisted.
- No documented way to run one spec (`package.json` scripts: dev, build,
  preview, lint, test) in a repo whose own rules say the full suite is
  ~8 min and two suites must never run at once.
- `eslint.config.js:7` scopes lint to `src/ tests/ *.config.js` — the
  246-line inline script in `public/pad-test.html` and the small inline
  module in `index.html:175` are unlinted, and nothing records that as
  deliberate.
- `tests/endless-stream.spec.js:16-19`, `tests/fairness.spec.js:18-21`,
  `tests/toys.spec.js:17-20`: three byte-identical `bootEndless` wrappers
  that just call `openGame` + `startGame` (both exported by
  `tests/helpers.js`).

## Commands

Every shell first: `export PATH="$HOME/.local/elves-tools/node/bin:$PATH"`

| Purpose | Command | Expected |
|---|---|---|
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| One spec | `npm run test:one -- tests/smoke.spec.js` (after Step 2) | passes |
| Full suite | `npm test` | all pass |
| YAML sanity | `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` | no output |

## Scope

**In scope:** `.github/workflows/ci.yml`, `package.json` (scripts only),
`readme.md`, `CLAUDE.md`, `todo.md`, `docs/elves/learnings.md`,
`eslint.config.js` (comment only), the three `bootEndless` sites +
`tests/helpers.js`, `plans/README.md`.

**Out of scope:** `src/**` (zero source changes), `vercel.json` (plan 030),
`public/**`, adding pre-commit hooks/prettier/Dependabot (considered and
declined — two contributors, CI already gates, and a bot would fight the
three.js pin).

## Git workflow

Branch `chore/032-ci-docs-truth` off `main`; one commit per step; do NOT
push unless instructed.

## Steps

### Step 1: CI — build step, browser cache, single run per PR

Edit `.github/workflows/ci.yml`:

1. Scope pushes: `on: { push: { branches: [main] }, pull_request: }` (keeps
   PR coverage, stops the double run; `concurrency` block stays).
2. After the lint step, add `- run: npm run build` (fails in seconds,
   before the 8-minute suite).
3. Cache browsers — replace the install line with:

```yaml
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - run: npx playwright install --with-deps chromium
```

   (The install is a fast no-op on a warm cache; `--with-deps` apt packages
   still run — acceptable.)
4. Raise `timeout-minutes` to 45 with a comment: the suite is ~8.3 min at 3
   workers locally; CI runs `workers: 1` + retries and has been observed
   near 30.

**Verify**: the YAML sanity command → no output; `git diff .github` reads as
exactly these four changes.

### Step 2: The single-spec runner

`package.json` scripts: add `"test:one": "playwright test"`. Document in
`readme.md` (commands block) and `CLAUDE.md` (commands table):
`npm run test:one -- tests/coop.spec.js` runs one spec; it uses the same
port 5173 as a full run — never alongside one.

**Verify**: `npm run test:one -- tests/gate.spec.js` → 1 passed.

### Step 3: plans/README + learnings truth

1. `plans/README.md`: if the stale run-status block (`:46-49`), RED-main
   note (`:41`), or never-push rule (`:98`) survive, rewrite them: run
   merged to `main` via PR #4 (`1460e3b`, 2026-08-08); PR #5 added
   per-player speed; pushing via fork PRs is the live workflow.
2. `docs/elves/learnings.md`: move the five live entries (47-51) out of
   "Retired Learnings" into the file's active sections (Known Traps /
   Invariants), leaving only the genuinely retired entry (46); fix "151
   tests" → the measured count; replace the never-push line (36) with the
   fork-PR workflow.

**Verify**: `grep -n "unmerged, never pushed\|RED on main\|Never push to origin" plans/README.md docs/elves/learnings.md` → no matches.

### Step 4: Suite-size truth, once, in one owner

Run `npm test` (full, alone) and note the reported count/time. Then:
`CLAUDE.md` testing section → "~8-9 min on port 5173 (154 tests, 3
workers)" (use the number you measured — if plan 029 landed, it is higher);
`plans/README.md` / `learnings.md` → soft phrasing ("~150+ tests") so only
CLAUDE.md carries the exact number.

**Verify**: `grep -rn "150 tests\|151 tests" CLAUDE.md docs/ plans/README.md` → no matches.

### Step 5: todo.md reconciliation

Check the shipped boxes with the file's own annotation style
(`[x] … _(shipped: species table, plan 024)_`): the juja tree (41-48 — jujas,
boss/titan), the daily-board line (125 — shipped locally, backend variant
still open if desired). Annotate the Roblox section header:
`_(rejected — see CLAUDE.md Closed decisions; kept for history)_`. Add one
header line at the top: "CLAUDE.md 'Closed decisions' overrides anything
here."

**Verify**: `grep -n "juja\|Roblox" todo.md` shows the annotations.

### Step 6: readme structure map + pad-test visibility

1. Add a `public/` block to the structure map: `favicon.svg`,
   `original.html` + `original/` (museum build, never edit), and
   `pad-test.html` (standalone controller diagnostic — served at
   `/pad-test.html`). List `vercel.json`, `.github/workflows/ci.yml`,
   `docs/`, `CLAUDE.md` at the appropriate level.
2. Under the Pad bullet in "How to play", add: controllers acting up? open
   `/pad-test.html` for a live pad/axis/button readout. Also note it in the
   plan-018 row of `plans/README.md` (the pending family hardware check —
   this page is the tool for it).

**Verify**: `grep -c "pad-test" readme.md plans/README.md` → ≥1 each.

### Step 7: Lint-scope honesty + bootEndless dedupe

1. `eslint.config.js`: comment above the scoped block naming the two known
   unlinted inline scripts (`index.html` gate bootstrap,
   `public/pad-test.html`) as deliberate exemptions (extraction to a linted
   file is a possible future step; do NOT do it in this plan).
2. Delete the three identical `bootEndless` local wrappers; either inline
   `openGame`+`startGame` at their call sites or add ONE `bootEndless` to
   `tests/helpers.js` — pick the helpers.js option if any file calls it
   more than twice, else inline.

**Verify**: `npm run lint` → 0;
`npx playwright test tests/endless-stream.spec.js tests/fairness.spec.js tests/toys.spec.js` → pass.

### Step 8: Full gate

`npm test` (alone) → all pass. `npm run build` → 0.

## Done criteria (ALL must hold)

- [ ] ci.yml has build step + browser cache + branch-scoped push trigger
- [ ] `npm run test:one -- tests/gate.spec.js` works and is documented in
      readme + CLAUDE.md
- [ ] The four stale-docs greps in Steps 3-6 all come back clean
- [ ] `npm test` exits 0; `npm run lint` exits 0
- [ ] `plans/README.md` row 032 updated

## STOP conditions

- The measured suite count/time differs wildly from 154/8.3m (>±10 tests) —
  something else landed; re-measure and use reality, but report the delta.
- Editing learnings.md would delete content rather than move it — this plan
  MOVES entries; deletion is out of scope.
- Any test edit in Step 7 changes assertions (it must only move setup
  lines).

## Maintenance notes

- CLAUDE.md is the single owner of the exact test count from now on — other
  docs use soft counts; future plans that add specs update CLAUDE.md in the
  same commit (plan 029 already says this).
- If `public/pad-test.html`'s inline script is ever extracted to a `.js`
  file, remove the eslint exemption comment and the plan-030 CSP block for
  it can drop `'unsafe-inline'`.
