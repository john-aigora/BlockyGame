# Blocky Collector 3D — Improvement Roadmap (2026-08-14)

The master plan for making the game the best version of itself. Written by
the improve-skill advisor at commit `c1ffd13` after a four-agent audit with
lead vetting; every claim below was verified against the code, and every
workstream links to a self-contained executable plan in this directory. An
executor (human or agent) needs only this file, the plan files, and the
repo.

**No dates or durations anywhere in this document — by owner rule, work is
described as sequence and dependencies only.** Effort letters (S/M/L) are
size classes, not time.

---

## 1. Where the game stands

Verified on `main` at `c1ffd13` (2026-08-14): **154/154 Playwright tests
green (one 8.3-minute serial-port run), lint clean, production build
clean, npm audit clean except two dev-tree advisories (fixed by plan
030).** The 2026-07 overhaul (plans 001–028) landed and merged: endless
seeded world, honest hitboxes, species, daily worlds, the titan, 2P
split-screen, a zero-flake game-clock test suite, CI. The game is GOOD.
What remains is one structural design gap, a short list of real bugs
(concentrated in the newest, least-reviewed code), infrastructure gaps,
and the next layer of fun.

## 2. The crown: end the runaway-growth loop — [plan 029](029-ascension-ceremony.md)

The owner-reported problem — grow → eat → grow forever — is structural:
growth is uncapped, its payoff stops at scale 7.67, and everything scales
WITH the player, so past ~scale 8 the game is inflation without gameplay.
**Ascension** ends the loop as a *win*: halo foreshadowing at scale 9; at
scale 10 a ~6.5-game-second ceremony (light beam, gold rings, the hero
rises spinning into the cloud layer, shrinks to a star, bursts, +500) ends
that hero's run with an "ASCENDED!" screen and a permanent ✦ on the board.
Co-op composes (one hero ascends, the partner plays on). Every knob lands
in GAME BALANCE.

Ascension is also load-bearing engineering: the audit's giant-scale
breakage family (enemies spawning inside a scale-13+ player, the spawn
system deadlocking near scale 21, shadow inversion at 19.5, fog exposing
the streamed world edge at large camera pullback) all sit ABOVE the scale-10
cap. Landing 029 retires that entire bug class; the thresholds are recorded
in [033's maintenance notes](033-perf-debt-smalls.md) in case the cap is
ever raised.

**Sequence**: nothing blocks it; it is the highest-priority item. Lands
best FIRST so 032's doc pass records the new test count once.

## 3. Fairness and correctness — [plan 031](031-coop-fairness-and-canvas-truth.md), then [033](033-perf-debt-smalls.md)

The audit's two must-fix bugs live in the newest code (issues filed on
GitHub — see §8):

- **2P enemy pace** takes the MAX of both seats' speed toys — P1 on 5×
  makes every hunter faster than P2 can ever run. Fix: per-target pace
  (each hunter runs at the pace of the hero it is chasing) — preserves
  both owner laws ("5× ramps the world" AND "always outrunnable"). Plus
  kinematic specs so this can never regress silently.
- **Stale canvas geometry** after every 1P↔2P layout flip mislays every
  off-screen arrow until a window resize. Fix: one owner for canvas
  geometry (`onWindowResize`), which also deletes a per-frame forced
  layout read in the 2P render path.
- 031 also adds the missing coverage for the per-seat speed feature
  (death/roster recompute, pad Y/X routing — the code path that
  historically broke on the DB9 adapters).

**Plan 033** then sweeps the nine verified smalls: music-scheduler
backlog burst + missing resume guard, restart-camera anchor drift, the
warn-ring blowup at late-game scale (the one giant-scale bug reachable
BELOW the ascension cap), 2P input allocations (a regression of a prior
perf fix), the surviving per-cloud closure, a hidden-element reflow on
every coop scoring event, five stray tuning knobs moved into GAME
BALANCE, the new `ui.js → game.js` import cycle broken, four lying
comments fixed. **033 lands after 031** (same functions).

## 4. Hardening and infrastructure — [plan 030](030-security-hardening.md), [plan 032](032-ci-and-docs-truth.md)

- **030 (security)**: scope the CSP per page (the live game page currently
  inherits `unsafe-inline` + a whole CDN origin it doesn't use; the frozen
  museum pages keep exactly what they need, path-scoped), add
  `form-action`, fix the two dev-tree npm advisories (one command,
  verified unreachable from the shipped bundle), root `.gitignore` `.env`
  safety net, `video/.env.example`. Includes a mandatory post-deploy
  manual check because Vercel headers exist only in production.
- **032 (CI + docs truth)**: CI gains the build step (the one check humans
  always ran that automation dropped), a Playwright browser cache, and
  single-run-per-PR; a documented single-spec runner (`npm run test:one`)
  for a repo whose full suite must run alone; and the docs stop lying —
  plans/README run status (already corrected), three conflicting test
  counts, `todo.md`'s shipped-but-unchecked features and rejected Roblox
  section, five live lessons misfiled under "Retired", and
  `/pad-test.html` (the tool built for the still-pending family joystick
  hardware check) finally documented.

Both are independent of everything else.

## 5. The next fun wave — [plan 034](034-ghost-runs.md), [plan 035](035-skins-and-unlocks.md), [plan 036](036-board-honesty-mult.md)

Chosen from the July catalog by fun-per-effort against the capability map,
now fully specified:

- **034 Ghost runs (M)** — record the best run per seed (true-coordinate
  samples, rebase-proof by construction), replay it as a translucent
  spectral hero on the same world. Turns TODAY'S WORLD from parallel play
  into a real race; `?ghost=0` opt-out; strict resource-plateau and
  no-gameplay-surface guarantees.
- **035 Skins + milestone unlocks (S-M)** — five palettes riding the
  existing color-parameterized character factory; unlocks DERIVED from the
  boards (500u, 1000u, 1000 pts, and an ascension-exclusive Celestial);
  one cycling SKIN button in the existing mode-picker style; P2's teal
  identity untouchable.
- **036 Board honesty (S)** — rows record the run's chosen speed
  multiplier (` · 5x`), ranking untouched; the data that lets the family
  decide later whether 5× runs should rank apart. (Resolves July DT-3.)

The wave after (not yet planned; re-ground before planning): pets on the
character rig, power-up orbs (Magnet/Speed/Shield), share cards, challenge
modes — see the catalog index in [audit-2026-07-31.md](audit-2026-07-31.md) §10.

## 6. Standing decisions only the owners can make

1. **The `?move=continuous` spike** (since July): adopt-and-rewrite against
   the real collision system, or delete it and its seven branches. It
   still bypasses collision, so any family playtest of it judges a
   different game. This is the oldest open decision; everything else works
   around it.
2. **The 2P pace rule** (plan 031 implements per-target pace as
   recommended): confirm the intent — the alternative reading (one shared
   world pace set by the fastest seat) is what the current code comment
   claims, and it is exactly what makes P2 helpless.
3. **Ascension tuning** after the first family runs: `ASCENSION_SCALE` 10
   is the recommended start; every ceremony knob is in GAME BALANCE.
4. **Family hardware check** for the DB9 sticks — `/pad-test.html` is the
   diagnostic page built for it (plan 018's one outstanding human step).

## 7. Execution order

```
029 Ascension ──────────────┐
030 Security ───────────────┤   (all four independent — any order,
031 2P fairness ────────────┤    029 first by owner priority)
032 CI + docs truth ────────┘
        031 ──► 033 Smalls   (same functions; strict order)
029 ──► 035 (Celestial skin reads the asc field; soft)
029/031/033 ──► 034 Ghosts, 036 Board honesty (soft: merge-adjacent files)
034/035/036 → then re-audit before the wave after (pets, power-ups, sharing)
```

Working agreements that keep this safe: the full suite runs ALONE (port
5173); every plan's own verify commands gate each step; CLAUDE.md is the
single owner of the exact test count; every balance knob lands in GAME
BALANCE with a rationale; solo behavior stays byte-stable under every 2P
change; `public/original/` is never edited.

## 8. Known bugs ↔ GitHub issues

Every vetted defect from the 2026-08-14 audit is filed as a GitHub issue on
`john-aigora/BlockyGame`. Security-sensitive findings are deliberately NOT
public issues; they live in [plan 030](030-security-hardening.md) only,
because the repo is public.

| Issue | Bug (audit ID) | Fix plan |
|---|---|---|
| [#6](https://github.com/john-aigora/BlockyGame/issues/6) | Runaway growth has no endgame (DT-7/DT-8) | 029 |
| [#7](https://github.com/john-aigora/BlockyGame/issues/7) | 2P enemy pace = max of both seats (C-15) | 031 |
| [#8](https://github.com/john-aigora/BlockyGame/issues/8) | Stale arrow geometry after layout flips (C-16/D-14) | 031 |
| [#9](https://github.com/john-aigora/BlockyGame/issues/9) | Per-seat speed feature untested (T-12/T-13) | 031 |
| [#10](https://github.com/john-aigora/BlockyGame/issues/10) | Music scheduler backlog burst + unguarded resume (C-20/C-8) | 033 |
| [#11](https://github.com/john-aigora/BlockyGame/issues/11) | Restart camera anchors to the previous run's terrain (C-21) | 033 |
| [#12](https://github.com/john-aigora/BlockyGame/issues/12) | Warn ring unbounded at late-game scale (C-22) | 033 |
| [#13](https://github.com/john-aigora/BlockyGame/issues/13) | 2P input path: pad-cache bypass + per-frame allocations (P-14) | 033 |
| [#14](https://github.com/john-aigora/BlockyGame/issues/14) | Per-cloud closure allocation, survived plan 020 (P-15) | 033 |
| [#15](https://github.com/john-aigora/BlockyGame/issues/15) | Coop scoring reflows a hidden element (P-16) | 033 |
| [#16](https://github.com/john-aigora/BlockyGame/issues/16) | CI never builds; browsers re-downloaded; double PR runs (DX-5/6) | 032 |
| [#17](https://github.com/john-aigora/BlockyGame/issues/17) | Docs state three different test counts; stale run status; shipped features marked unstarted (DOC-9..13) | 032 |
| [#18](https://github.com/john-aigora/BlockyGame/issues/18) | Giant-scale family — retired by 029's cap, tracked in case the cap rises (C-17/18/19/24) | 029 (umbrella) |

## 9. What was deliberately NOT done (do not re-derive)

Recorded across [README.md](README.md) "Considered and rejected" sections:
three.js stays pinned at 0.128.0; no TypeScript in game code; no
framework; no Roblox port; the soft gate stays soft; enemies never get
catch-up speed; swimming stays out; `worldmath.js` torus branch stays;
pre-commit hooks/prettier/Dependabot declined; `ui.js` tension-block
extraction and `hiscores.js` consolidation are named-and-deferred debt
slices with their trigger conditions, not backlog noise.
