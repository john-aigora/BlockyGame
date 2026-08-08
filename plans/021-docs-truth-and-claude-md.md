# Plan 021: Docs truth pass + promote a root CLAUDE.md

> **Executor instructions**: Step-by-step; verify each. STOP conditions binding.
> Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 128d18e..HEAD -- readme.md todo.md docs/ index.html src/ui.js package.json plans/016-gamepad-complete.md`

## Status

- **Priority**: P2 · **Effort**: S · **Risk**: LOW
- **Depends on**: 017 (so doc claims about tests are written against a green suite)
- **Category**: docs / dx
- **Planned at**: commit `128d18e`, 2026-07-31

## Why this matters

The readme contradicts itself within 20 lines (mode picker vs "classic retired"),
states four wrong facts (torus world, cap 8, score-ranked board, Space=pause),
and its Node claim breaks a literal fresh clone. Worse, the agent-facing memory
file `docs/elves/learnings.md:29` states "the world is a torus (±100 wrap)" as a
trusted invariant — false for the only shipping mode, and exactly the kind of
line a future agent will "fix" code against. Findings DOC-1..8, DX-1, DX-2,
SEC-2 in `plans/audit-2026-07-31.md`.

## Current state

- `readme.md:9-24` "## Game modes — Pick a mode on the start screen (your choice
  is remembered)" listing CLASSIC ARENA; `:32` "classic arena is retired";
  `:43` "cap of 8" (endless cap is 12, `src/constants.js:154`); `:22`
  "score-ranked" (endless ranks by DISTANCE — `src/hiscores.js:24-31`); `:47`
  "pause (Spacebar…)" (Space jumps; pause is P/Enter — `src/input.js:481-489`);
  `:53` "Node 20+" (Vite 8 needs `^20.19 || >=22.12`); `:69-90` structure map
  missing `clouds.js`, `gate.js`, `rumble.js`, `movement-continuous.js` and 5+
  spec files; `:99-100` "world is a torus" under Key technical facts.
- `docs/elves/learnings.md:29` — the same torus claim; `:40` has a
  "## Retired Learnings" section (currently "(none yet)").
- `todo.md:22-32,98,112,155` — LBS movement/boost/trail/energy items unchecked
  though shipped as the `?move=continuous` spike; `:132` cites the removed
  mode picker.
- `index.html:76` static controls hint is overwritten at boot by
  `src/ui.js:108-110` with a DIFFERENT string.
- `plans/016-gamepad-complete.md:15,24,25` — acceptance rows B1-A1, B5-A2, and
  the mode-toggle half of B6-A1 describe the mode picker its own line 9 retires.
- No root `CLAUDE.md`. No `engines` in `package.json`, no `.nvmrc`.
- Gate scope: the password gate defers only `import('/src/main.js')`
  (`index.html:84-88`); `/original.html` is served ungated — undocumented.

## Commands

`export PATH="$HOME/.local/elves-tools/node/bin:$PATH"` · `npm run lint` · `npm test`

## Scope

**In scope**: `readme.md`, `todo.md`, `docs/elves/learnings.md`, `CLAUDE.md`
(create), `.nvmrc` (create), `package.json` (engines only), `index.html`
(controls-hint span only), `src/ui.js` (delete the boot overwrite only),
`plans/016-gamepad-complete.md` (strike stale acceptance rows),
`git mv grok_tips.md docs/history/grok_tips.md` + the two referring lines
(`src/movement-continuous.js:4`, `todo.md:158`).
**Out of scope**: any other source change; `public/original/`.

## Git workflow

Run branch; `[<branch> · Batch N/M] <verb> <what>`; NEVER push.

## Steps

### Step 1: Readme truth

Delete the "## Game modes" section; fold the endless description into the intro
with one line: "The retired classic arena survives as a test-only path
(`__game.debug.forceWorldMode('classic')`); the untouched May 2025 original is
at `/original.html` (outside the password gate)." Fix: cap 12; distance-ranked
board (score tiebreak); Space=jump / P-or-Enter=pause; Node "20.19+ or 22.12+";
regenerate the structure map from `ls src/ tests/`; replace the torus bullet
with: "The shipping world (endless) is a flat infinite plane with a floating
origin; the retired classic arena was a ±100 torus. ALL entity-to-entity
distance still routes through `src/worldmath.js` (mode dispatch)."
**Verify**: `grep -n "torus" readme.md` shows only the corrected sentence;
`grep -n "cap of 8\|61 tests\|Pick a mode" readme.md` → no matches.

### Step 2: learnings.md invariant fix

Rewrite line 29 to the corrected two-mode sentence (same as readme) and MOVE the
old wording under "## Retired Learnings" with a date and "superseded by the
classic retirement (87771ab)".
**Verify**: `grep -n "torus" docs/elves/learnings.md` → corrected line + retired entry only.

### Step 3: Root CLAUDE.md (promotion, not duplication)

Create `CLAUDE.md` with exactly these sections (adapt content from
`docs/elves/learnings.md`, readme, and `plans/README.md` — quote, don't invent):
- **Project shape**: vanilla JS ES modules + three.js `0.128.0` EXACT PIN
  (deliberate — do not bump), Vite 8, Playwright-only test layer driving the
  real game via `window.__game`.
- **Closed decisions (do not re-litigate)**: three pin; NO TypeScript in game
  code (`video/` tooling is exempt); no framework/ECS rewrite; no Roblox port;
  `public/original/` is a byte-for-byte museum build — never edit or lint.
- **Invariants**: death text contains "GAME OVER"; entity distance math routes
  through `src/worldmath.js`; enemy body material per-instance; kill-flash ≤3
  Hz (WCAG 2.3.1); all tuning in the GAME BALANCE block of `src/constants.js`.
- **Testing rules**: game time ≠ wall time (`MAX_DELTA` clamp); wait on
  `state.runTime` via `tests/helpers.js`; specs stay DOM-or-`__game`-level.
- **Commands**: the PATH export + npm scripts table.
Leave `docs/elves/learnings.md` in place for run-ephemeral entries; add a line
at its top: "Durable repo truth now lives in /CLAUDE.md; this file keeps
run-specific lessons."
**Verify**: file exists; `grep -n "0.128.0" CLAUDE.md` → present.

### Step 4: Node pinning

`package.json`: add `"engines": { "node": ">=20.19 <21 || >=22.12" }`.
Create `.nvmrc` containing `22`. Readme setup section gains the toolchain note:
Node on this machine lives at `~/.local/elves-tools/node/bin` (PATH export shown).
**Verify**: `npm run lint` still exits 0 (engines does not block npm scripts).

### Step 5: todo.md + plan 016 + controls hint + grok_tips

- todo.md: mark the LBS movement/boost/energy/trail items
  `[x] (spike, behind ?move=continuous — see plans/design/lbs-movement-notes.md; adopt-or-delete pending family playtest)`;
  fix `:132`'s parenthetical to cite the endless world.
- plans/016: strike B1-A1, B5-A2, and the mode-toggle clause of B6-A1 with
  `~~...~~ — superseded mid-plan by the classic retirement (see line 3)`.
- Controls hint: make `index.html:76` the single source — update its text to the
  live string INCLUDING "· Mute: Select" and DELETE the overwrite at
  `src/ui.js:108-110` (keep the surrounding endless-hint display logic intact —
  it also toggles `#endless-hint` visibility; remove only the `textContent`
  write).
- `git mv grok_tips.md docs/history/grok_tips.md`; prepend a 2-line header
  (what it is, when it arrived, superseded by plans/014 + lbs notes); update
  `src/movement-continuous.js:4` comment and `todo.md:158`.
**Verify**: `npm test` → 0 failed (smoke asserts hint text presence — confirm
`#controls-hint` renders the same final string; if a spec pins the old string,
update that assertion in the same commit).

## Test plan

Suite green is the gate; Step 5's hint change is the only user-visible one and
is covered by existing smoke/timing specs (update assertions if they pin text).

## Done criteria

- [ ] `npm test` 0 failed; `npm run lint` 0
- [ ] `CLAUDE.md` and `.nvmrc` exist; engines present
- [ ] readme contains no mode picker, no torus-as-global-truth, no "cap of 8"
- [ ] `grok_tips.md` no longer at repo root; referrers updated
- [ ] `plans/README.md` updated

## STOP conditions

- Deleting the ui.js hint overwrite breaks more than one spec after updating
  their pinned strings once.
- Any readme claim you're about to write contradicts what you observe in code —
  report the discrepancy instead of writing either version.

## Maintenance notes

- CLAUDE.md is now the first file agents read — future decision changes
  (e.g. adopting the spike, a three.js upgrade) must update it in the same PR.
- Re-run a mini truth pass at the END of this whole run (final batch) so docs
  describe what actually shipped.
