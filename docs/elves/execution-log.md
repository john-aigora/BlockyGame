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

## 2026-08-08 — B3 worker: 019 + 020 landed, combo race rooted and ended

- RACE ROOT CAUSE (frame-recorder probe, zero src changes, 3/8 fails all
  identical): the death fired BEFORE the teleport evaluate — B2's "at
  teleport" probes had measured an already-dead frozen game. Killer: the
  streaming giant (sy~25.5, non-killable vs the idle scale-20.5 player) on
  its first post-materialize frame 40-45u SOUTH: Box3.setFromObject unioned
  the render tree, so the enemy TAIL (-1.044*sy toward the player) met the
  player's FACE parts (+0.66*scale) at 40+u — phantom contact; spawn angle
  was the coin flip; score frozen 34/35 + "Distance 0u" match B2's artifact.
- Fix: 019 Step 2 explicit body-block hitboxes (solo combo 3/10 fail →
  9/10 pass); residual 1/10 was HONEST contact (ENDLESS_SPAWN_MIN 35 <
  37.3u diagonal body reach at these scales) → driver-authorized spec
  choreography stabilization (intent preserved) → 10/10, green in all
  subsequent full suites.
- 019 shipped (31a84a5, 01e5fff): dead-run guard, exported hitbox builders,
  truthful behind-camera arrows, blur-cleared inputs, single movement
  clamp, probe-parity rock grace; +8 tests, each proven red-on-old.
- 020 shipped (29f04d3, ba1996d, 07f49da, 648cfa1): perfInfo hook, shadow
  diet (19→4 casters/char), chunk culling (+24u spheres, eager-register
  first draw), food-glow baseY cache + fog gate, indicator/AI/pad/probe
  hot-loop hygiene, mobile tier + preconnect. Deterministic rig: calls
  200→182, triangles 71026→50290, frameMsAvg ~0.85→~0.73 (r128 resets
  info AFTER the shadow pass — diet shows in frame time, not calls).
- Gates: after 019 suite 91/91 x2; after 020 suite x2 at final HEAD +
  build 0 (see Close commit). Deferred: game.js food-collect loop still
  uses render-tree boxes (not an audit finding; flagged for review).

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

## 2026-08-08 — B2b+B4 review BLOCK → driver revision → resolved (c795dea)

- Review verdict on eb4e51d..6786a8a: BLOCK on 3 findings, all confirmed real:
  B1 the new CSP forbade the museum archive's ONLY bootstrap (inline script)
  — deploy-time-only, invisible to `vite build`; B2 the relocated KILL! banner
  painted UNDER the mobile-sized ORIGINAL '25 link (z 120 vs 50, link grows to
  72px tall ≤600px); B3 CLAUDE.md re-declared the password item 15 had just
  single-sourced. Everything else in the window verified sound (CLAUDE.md
  fact table all-true; debt items no orphaned readers; H7 degenerate-case
  safe).
- Driver revision (c795dea): CSP += 'unsafe-inline' (script-src, both
  /original rules); kill/combo desktop 52/106 + mobile media-query 88/142 —
  proven by LIVE GEOMETRY probe (mobile link-bottom 194 < kill-top 200,
  desktop 92 < 103; screenshots b4rev-kill-{390x844,1280x800}.png); CLAUDE.md
  literal removed (scan clean). Advisories done in the same commit: A1
  modifier guard hoisted above the game-over branch (Cmd+Space on death
  screen no longer resets), A4 dead worldMode seeds deleted, A5 dead
  el.controlsHint cache removed, A6 constants.js Node-import contract note,
  A7 README 022 label 15→16.
- Delta verification in lieu of a second reviewer pass (recorded decision:
  every fix followed the reviewer's own specified mechanism and carries
  direct evidence a read-only pass could not improve on): targeted specs
  21/21, full suite 95/95, lint 0, JSON parses, geometry probe above.

## 2026-08-08 — Combined B2+B3 review: APPROVE-WITH-ADVISORIES, 0 blockers

- Reviewer independently verified: combo-spec assertion pair byte-identical to
  pre-fix (intent preserved; still red if the combo window sticks at 0); r128
  really does reset renderer.info AFTER the shadow pass (three.module.js:24323)
  so the shadow diet lands in frame time, not draw calls; hand-off edge seeding
  cannot swallow a genuine second press (traced + pinned by test); no
  in-frustum enemy can take the mirrored-arrow path; scope fully clean.
- PERF REFERENCE RIG for plan 028: the 3-enemy deterministic ring
  (calls 200→182, triangles 71026→50290) — NOT 29f04d3's settled-run numbers.
- Advisories triaged to H5-H10 in the survival guide (owners: B4 arrow edge
  math, B8 pickup-box unification + builder signature, B9 DPR pin, B10 cull
  hardening; H9 benign residual documented). Two plan-scope self-contradictions
  (019 terrain helper, 020 style.css) corrected in the plan files.

## 2026-08-08 — B2b worker: 021 landed (docs truth + CLAUDE.md), B2 resolved

- Every readme claim verified against code before writing (plan STOP rule):
  cap 12, distance-ranked endless board (score tiebreak), Space=jump with
  P/Enter pause, floating origin confirmed (game.js:201), milestone 250u,
  kill flash 1 Hz. No contradictions found — no STOP hit.
- Readme rewritten (0b69ae5): endless-only intro + test-path classic note,
  real structure map from ls, two-mode world fact, Node 20.19+/22.12+ with
  PATH note; 018's DB9 line preserved; driver-granted sentence added (first
  press on a not-yet-active pad only claims it — press once, then play).
- CLAUDE.md promoted to root + learnings.md:29 torus invariant corrected and
  retired (87771ab cited); engines + .nvmrc landed, lint still 0 (8e3fc14).
- todo spike truth + 016 acceptance strikes + controls-hint single-sourced in
  index.html (ui.js overwrite deleted; no spec pinned the string) +
  grok_tips.md → docs/history with header + referrers (a77b7b9).
- Gate: 92 passed / 0 failed x2 consecutive (4.8m each) + lint 0. B2 flipped
  blocked → resolved in session json (018 in B2, 021 here, race ended in B3).

## 2026-08-08 — B4 worker: plan 022 complete (16/16 items, none skipped)

- One commit per item (9476747..3fb5924). Debt: MOVEMENT_MODE enum → boolean
  CONTINUOUS_MOVEMENT (D-3; the typeof-location guard added there is what
  makes constants.js Node-importable — enabling specs to import collider
  constants); mode-picker corpse out with the live HUD toggles extracted to
  updateModeHud (D-4; `.mode-button` CSS KEPT per the item guard — 026
  reuses it); hiscores defaults → endless + saveWorldMode/MODE_KEY deleted
  outright (D-5; nothing ever read the key back); input forks collapsed to
  ONE bind set — pad A=jump/B=pause, Space=jump/P=pause everywhere (D-6);
  write-only playerSpeed + duplicate container ref gone (D-10); collider↔
  geometry tripwire (debug.heroBodyWidth/enemyBodyWidth + fairness assert)
  and toys 0.54 literals → imported constant (D-11); SPEED_LADDER derived
  from speedMultipliers + loud indexForMultiplier miss (D-12); phantom
  JUMP_GRAVITY/JUMP_VELOCITY deleted (D-13).
- Correctness: modifier chords bail before every game bind (C-10 — proven
  red-first: Cmd+F used to cycle speed); wobble settle exp(-11·dt) (C-12);
  seamDelta routes through torusDeltaComponent and classic reimage now
  moves pending warn discs too via enemies.reimagePendingSpawns (C-13
  partial).
- UI (screenshots in .elves/runtime/): KILL!/combo moved INTO
  #game-container — the before-shot proves they anchored to the VIEWPORT
  (kill top=10px vs frame top=60px; combo buried under the ORIGINAL '25
  link); after: top 46/100px, z-50, 1Hz flash invariant untouched (UI-1).
  #instructions line-height 1.6 + display:block controls-hint ends the
  wrapped-line glyph collision at 1280×800 and 800×450 (UI-2).
- Security: vercel.json created (nosniff + strict-origin-when-cross-origin
  site-wide; CSP on /original.html + /original/(.*) scoped to the archive's
  real cdnjs + Google-Fonts deps; archive itself untouched) (SEC-1); gate
  password single-sourced from src/gate.js — the literal is gone from
  tests, spec title, readme, and the index.html comment (SEC-3).
- Driver-granted H7: behind-camera arrow push scales by 1.001/max(|x|,|y|)
  instead of fixed NDC radius 1000 — only the dominant axis saturates, so
  the per-axis clamp lands the TRUE edge point; new diagonal fairness case
  proven red-first (old code corner-pinned it exactly; ~25-30° error class).
- Gate at final HEAD: suite is now 95 tests (+3, each red-proven or a
  tripwire). Full runs: 94/95, 95/95, 94/95, 95/95, 95/95 — x2 consecutive
  green achieved (runs 4-5). The two singleton flakes were DIFFERENT specs
  (endless-stream water walk; effects pool count), each solo-green
  immediately after, neither touching batch surfaces in simulation-relevant
  ways — the known 3-worker load-flake class (95 tests re-tile the schedule
  again; worker-count policy left to the driver). toys:70 jump also flaked
  once during item-3 verify (solo + full rerun green 2/2). lint 0 and build
  exit 0 at final HEAD.
