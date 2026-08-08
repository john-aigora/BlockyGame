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

## 2026-08-08 — B5 worker: plan 023 complete (fun: survival & readability)

All five steps landed; suite grew 95 → 102 (+4 tension, +3 audio).

- Step 1 (UI-3, blob shadows): ONE shared PlaneGeometry + ONE 64px radial
  CanvasTexture; enemies share one static material, the player rides the
  single cached bendClone (per-instance opacity for the jump fade — clone()
  drops onBeforeCompile, so the bend is re-armed). Quad is a GROUP child;
  effects.js re-grounds it each frame at (ground+0.02−group.y)/scaleY and
  scales/fades the player's by jump height. Perf on a PINNED 4-enemy scene
  (spawn angles are random and an enemy is ~27 meshes, so the naive probe
  swung ±30 calls on frustum-edge enemies): calls 207→212 = exactly +1 per
  visible quad, geometries 79→80, textures 3→4, tris +10. Shots:
  .elves/runtime/b5-step1-shadow-{standing,midjump}.png (offset 1.05 at the
  mid-jump frame — shadow visibly detached + shrunk).
- Step 2 (DT-10, survival beats): PHEW! on real-scare drain (dangerPeak >
  0.15 → opacity ≤ 0.01), CLOSE ONE! on near-miss exit (arm inside 1.5× the
  true collider-width sum; materializing spawns never arm). The near-miss
  check rides updateDangerPulse's existing non-killable distance loop —
  enemies.js untouched. ONE shared 6s game-clock rate limit
  (state.lastSurvivalBeat); new sfx.phew (two-sine house blips). Spec proves
  the beat AND the silence (sentinel popup inside the 6s window).
- Step 3 (TIME HUD): "Time: m:ss" ui-element beside DISTANCE off
  state.runTime, whole-second change detection; minute crossings reuse the
  distance-milestone pattern (sfx.milestone + "N MINUTE(S)!" popup). Spec
  asserts HUD-vs-clock agreement atomically and the 59.5→60 minute beat.
- Step 4 (CAP-5, danger layer): intensity 0|1|2, bar-line commit untouched;
  level 2 adds a half-bar low sine pad (bass root −1 octave, ≈0.05 abs gain)
  + doubled bar-start bass. Single driver moved to updateDangerPulse:
  anyKillable ? 1 : (dangerOpacity > 0.12 ? 2 : 0) — hunt priority, dread
  only with no prey (the heartbeat's rule). audioState() is now an object
  {state, intensity(requested — deterministic under a suspended headless
  ctx), activeIntensity, musicVolume}; the two existing 'none' asserts moved
  to .state (same strength). Spec walks 0→2→1 with a pre-start giant-warn
  roster fill — streaming's OPENING spawn is always a killable prey ~1s in
  (SPAWN_SIZE_PATTERN), which would poison every no-prey state.
- Step 5 (title warmth): music.setVolume(f) scales the one master gain;
  overlay bed at 0.5 only when ctx.state==='running', silent skip otherwise;
  startRun restores 1. Gesture = REAL gate submit only (index.html checks
  isUnlocked() before riding unlockAudio on the prompt), so bypassed-gate
  boots keep audioState 'none' and the no-gesture spec. Probe confirmed
  headless Chromium genuinely hits the running branch (bed active at 0.5).
  FAMILY BEST tagline from loadHiscores('endless')[0], lime, hidden when
  empty; distance-ranked assert (richer-but-shorter row must not win).
- New GAME BALANCE knobs: SURVIVAL_BEAT_COOLDOWN 6, PHEW_PEAK_MIN 0.15,
  NEAR_MISS_FACTOR 1.5, DANGER_MUSIC_THRESHOLD 0.12.
- Gate at final HEAD: full runs 102/102, 101/102, 102/102 — the singleton
  was toys.spec:71 jump-over-rock (OFF-surface; the SAME spec B4 logged as
  a one-off), solo re-run 6/6 green + full re-run green per the flake
  policy → recorded as the known H4/H11 3-worker load-flake class. lint 0
  at every slice (one first-run false alarm: 25 no-undef from untracked
  probe .mjs helpers parked in .elves/runtime — relocated to the session
  scratchpad; committed source was always clean). build exit 0.

## 2026-08-08 — B6 worker: plan 024 complete (fun: species & hunt)

- All 6 steps, no STOP conditions hit. Suite 102 → 108 (+6 species.spec
  cases, every one through the real sim: debug.spawnSpecies + game-clock
  waits, no mocks).
- Step 1 (CAP-2): ENEMY_SPECIES {grunt 1.0, sprinter 2.2 orange, juja 2.6
  green} in GAME BALANCE; createEnemy(speciesKey) stores species + BASE
  body/cap colors; the killable un-flip restores the STORED base (plan's
  maintenance note — no literals), harmless species skip the color flip
  entirely (juja keeps its green identity; the effects.js aura/scared face
  still telegraph edibility off ud.killable). speciesSpeed threads exactly
  the four sites (flee/orbit/chase + 1.25x cap; drift/avoidance stay
  global). Full suite green pre/post = proven no-op for grunts.
- Step 2: rotation 4 → 8 bands ['prey','giant','peer','giant','sprinter',
  'giant','juja','peer'] — edible-NOW share 25% → 37.5%, giants 50% →
  37.5%. Sprinter band [0.5,0.7]x player (always edible by construction);
  juja fixed 0.35x. Harmless contact guard + species foodDrop wired.
- Step 3 (DT-4): bubble top-up TARGET gate counts THREATS only (live via
  canKillSpecificEnemy; pending discs by materialize size). Hard cap 12
  still counts every body. Hunting can no longer starve its own prey.
- Step 4 (DT-2): 2nd kill replacement = PREY-band grunt at 18-25u
  (KILL_SPAWN_PREY_MIN/MAX), 1st stays the far giant; economy unchanged.
  debug.pendingSpawnInfo() added. tension.spec music-fill adapted (it
  postdates the plan and used spawnNewEnemies as a giants-only source):
  now 4 spawnSpecies giants — same intent, zero prey, streaming silent.
- Step 5 (DT-9): warn duration = SPAWN_WARN_TIME x clamp(actualPlayerSpeed
  / SPAWN_WARN_SPEED_REF 6.0, 1.0, 2.2), captured per pending entry; disc
  pulse phase runs on each entry's own elapsed time.
- BALANCE-CHANGE SUMMARY for the family playtest:
  - New knobs: ENEMY_SPECIES (speed 1.0/2.2/2.6, juja harmless, foodDrop
    4/4/2), SPRINTER_HEIGHT_RANGE [0.5,0.7], JUJA_HEIGHT_FACTOR 0.35,
    KILL_SPAWN_PREY_MIN/MAX 18/25, SPAWN_WARN_SPEED_REF 6.0.
  - Combo reach BEFORE: nearest guaranteed killable after a kill ≥35u
    (bubble), reachable ~20u inside the 4s window at 1x scale-1 (6 u/s
    through the 1.45s warn+materialize latency, then 4.5 u/s closing on
    fleeing prey) → x2 arithmetically unreachable. AFTER: guaranteed
    killable at 18-25u — min-roll sprintable at scale 1, whole band by
    ~scale 2 (speed 7.1 → reach ~24.5u).
  - Owner speed rule intact: BASE_ENEMY_SPEED 1.5 / RAMP_SPEED_MAX 1.6
    untouched. Sprinter chase 3.3 u/s (ramp-max 5.28) vs player 6.0 —
    measured in-spec ~3.3 u/s closing on a standing player; can never catch
    a straight-line 1x player (STOP condition checked, not hit).
  - Warn notice: 1x/scale-1 unchanged 0.95s; 5x multiplier 2.09s; mobile
    (1.75x base) 1.66s — constant notice in player-travel.
- Spec engineering notes: sprinter-vs-grunt race runs on the CLASSIC flat
  arena (probe: the endless +40u lane wedged on a seeded boulder — the
  endless map, not speed, failed first); prey-supply scene stays ON the
  spawn mesa (probe: +600 teleport landed mid-lake, all 35-50u placements
  failed isWalkable); juja food-drop counts in classic (endless
  spawnCollectible may silently fail placement near rocks/water; eats are
  neutralized by the 1:1 spawnNearPlayer replacement). Combo spec reads the
  kill wave INSIDE the first score poll (pendings live 0.95s) and does NOT
  assert enemies[0]'s band — that would reintroduce the B3 same-frame
  expiry race.
- Gate at final HEAD: full runs 107/108, 107/108, 108/108, 108/108 (x2
  consecutive green). Singletons: endless-stream 400u walk (run 1) and
  effects.spec:12 pool count (run 2) — the EXACT pair B4's gate logged as
  the 3-worker H4/H11 load-flake class; each solo-green immediately and
  green in every subsequent full run; effects.js untouched by this batch.
  lint 0 at every slice; build exit 0.

## 2026-08-08 — B5+B6 review: BLOCK (doc-only) → driver revision → resolved

- Verdict: implementation APPROVED as-is; single blocker B-1 was DOCUMENTATION —
  the readme told players to "stand your ground and gobble [sprinters] before
  they reach you", but an always-edible enemy takes the FLEE branch: a
  production sprinter is a fast RUNNER you chase down. The B6 log line
  "measured ~3.3 u/s closing on a standing player" is hereby CORRECTED: that
  measurement used scale-2 non-killable hunters the production rotation can
  never create; production sprinters flee at ~3.3 u/s.
- Driver revision: readme + constants comment now describe the true mechanic
  (a catch-skill chase reward); ADV-5 stale nearMissArmed disarmed on the
  killable path; ADV-8 duplicate hiscores import merged.
- Reviewer also closed hard questions: threat-gate predicate is the exact
  complement of edibility (no double-count/starve); title bed can never play
  at volume 1 and cannot unlock on bypassed-gate boots; blob-shadow bendClone
  re-arm real; sprinter burst >6.0 u/s needs drift alignment at ramp ≥1800u
  vs an ungrown player for <3s — transient, not a catch (STOP condition holds).

### FAMILY PLAYTEST BRIEF (accumulating — B6 additions)

1. Sprinter design question (driver → owners): sprinters shipped as fast
   FLEEING bonus prey (coherent, honest). If you want harass pressure that
   runs AT you instead, that is a species-level flee exemption — say the word
   and it becomes a follow-up plan.
2. Juja past 1800u outruns a scale-1 player entirely (6.24 vs 6.0 flee) —
   intended "earn it" or frustrating? (ADV-1)
3. Dread music layer 2 + heartbeat are much rarer now that prey is plentiful
   (3/8 spawns edible + threat-only gate) — listen for whether dread still
   lands. (ADV-2)
4. Field population steady-state roughly doubled (killables accumulate to the
   hard cap 12) — busier board, watch the feel. (ADV-3)
5. Mobile warn rings run 1.66s at rest (speed-scaled notice) — iPad check.
6. Hardware: DB9 sticks via ?paddebug=1 — first wiggle claims the pad
   (deliberately not acted on), then play. Both ports, one at a time.

(B7 additions)

7. Family race ritual: everyone taps TODAY'S WORLD on the start overlay
   (button glows lime; the SEED line gains "· DAILY") — same map for all,
   deaths rank on TODAY'S BEST. Does the shared-map race land as a thing you
   actually do together? The toggle reloads the page by design (a world
   cannot be reseeded mid-session) — does that read as broken to anyone?
8. Titan check (push a run past 1000u, ~3-4 min of decent play): the
   SOMETHING BIG COMES... beat + double-length red ring — dread or confusion?
   The titan then STALKS FOREVER (never streams out) — delightfully menacing
   or annoying while you grow into eating it? It pays triple + a 10-block
   feast — worth the wait?
9. Gold blocks (glowing amber, slightly larger): are they noticed without
   being told? Do the kids detour for them? 5 points vs a normal 1 — enough
   to feel special, or should rarity/payout move?
10. DISCOVERED region banners (~every 300u of fresh travel): charming
    waypoints or noise? Do the names get used ("meet me in COPPER FLATS")?
    REGIONS count on the death screen — does anyone chase it?
11. Determinism party trick: ?seed=123 in the URL is the same world on every
    device, forever — try it on two screens side by side.

## 2026-08-08 — B7 worker: plan 025 complete (fun: world & late game)

- Batch start 6debd8f (B6 close); rollback ref
  refs/elves/rollback/audit-coop-2026/b7. All 6 steps landed, no STOPs hit.
- Step 1 — WORLD_SEED (be1b811): resolved ONCE at constants.js module load,
  priority ?seed=<int> (int32-wrapped) → daily flag (?daily=1 OR
  sessionStorage blocky.daily=1) → TERRAIN_SEED default; typeof-location +
  try/sessionStorage guards keep the Node-importable contract (fairness/toys
  specs). Consumers swept: terrain hash2 + rock/food LCG streams, clouds
  stream. STOP-condition grep: TERRAIN_SEED appears only as the constants.js
  definition + resolution default. dailySeed() = local YYYYMMDD, exported
  (hiscores reuses it — one date rule). TODAY'S WORLD toggle reuses the KEPT
  #mode-picker container + .mode-button CSS verbatim (022's guard paid off);
  pointerdown stopPropagation because the overlay itself starts runs on any
  press; click persists the flag, strips ?seed/?daily, navigates. SEED line
  under START. debug.worldSeedInfo().
- Step 2 — daily board (ca913c8): blocky.hiscores.daily.v1, keyForMode third
  branch, sortBoard daily = endless distance-first rules; rows stamped
  seed = WORLD_SEED (the world RUN, not the clock at death — a past-midnight
  finish self-retires next day); loadHiscores('daily') prunes non-today rows
  on read and the trimmed write persists the prune. endGame: daily runs
  record BOTH boards (a daily run is an endless run); the death screen shows
  the daily ladder titled TODAY'S BEST (renderHiscores boardTitle param).
- Step 3 — named regions (c5d9437): biomeAt() extracted from computeTint
  (same octave, TRUE coords); biomeRegion() = 5-bin quantize × 300u
  (BIOME_WAVELENGTH) cell, name = hash pick (WORLD_SEED mixed — new seed,
  new name map) from a 12-entry kid table, color = the biome's own tint
  direction. updateEndlessProgress restructured: the old
  no-forward-progress early return removed so region tracking runs EVERY
  frame; REGION_DISCOVER_DEBOUNCE 1.5gs on state.runTime absorbs shoreline
  bin flicker. First visit per run = DISCOVERED popup + milestone jingle;
  spawn region pre-seeded (no banner; REGIONS counts from 1); re-entries
  silent. Death distance line gains "REGIONS n".
- Step 4 — gold food (1d90057): ONE extra seeded roll per chunk BEFORE the
  spot loop (roll-all law: alignment + rebuild determinism intact); 8%
  chance, the same roll re-spread picks WHICH spot; a rejected spot = no
  gold (rarity honest). Shared emissive amber material (deliberately off the
  lime glow pulse), scale 1.25, userData.gold. Collect pays 5 with the SAME
  full clock reset (rationale: gold sweetens points, never a lifeline),
  "+5 GOLD!" popup + sfx.fanfare('short') — new variant, plan-literal
  short/full split. Live-probed seed fixtures (real engine, throwaway spec):
  default seed grows 3 boot-window gold, nearest (23.5, 5.6).
- Step 4 FOUND+FIXED: the 400u-walk resource spec (endless-stream) failed
  solo — textures +2 > allowed +1. Root: popup CanvasTextures upload lazily
  on each pool slot's FIRST visible render; DISCOVERED banners made a second
  slot debut mid-walk. Fix: initEffects renderer.initTexture()s all 8 at
  boot — the pool's "all GPU resources exist from here on" comment is now
  literally true, the spec bound is untouched (no weakening), and the
  first-use upload hitch that landed exactly on celebratory beats is gone.
- Step 5 — the titan (6b24cbe): trigger in updateEndlessProgress at the
  first furthestDistance >= 1000 (outside the progress block — water-blocked
  placement retries per frame; DISTANCE 1000! chimes first, SOMETHING BIG
  COMES... is the headline). Boss = grunt at currentEnemyScaleFactor (now
  exported) × 1.6, 40u along moveVector (stationary fallback: outward
  radial), isWalkable fan ±90° × 12. The boss flag rides pendingSpawns:
  warn ×2 ON TOP of 024's speed scaling (1.9s at 1×); markBoss at
  materialize = gold crown (per-instance cap material + cap mesh 1.3;
  killable cap flip skips the boss — body yellow signals edibility, the
  crown is identity). No edibility bypass. killEnemy single path: payout ×3;
  species drop replaced by a 10-piece feast ring (~6u, evenly-angled
  jittered pickers through the validated food path); full fanfare; TITAN
  DOWN! last. updateEnemyStreaming skips ud.boss (kill or run end only);
  setupNewGame clears flag + roster + pending disc — the plan's
  leak-across-restart STOP condition is spec-asserted (Restart mid-run →
  0 bosses, 0 pending, flag false).
- Step 5 SPEC RACE ROOTED (not waved off): titan-kill failed ~1 in 4. Frame
  recorder probe: with the boss parked 0.9u away, a min-radius feast roll
  could graze the SCARF-side render pickup box by ~0.01u → one bite ran the
  collect path → render scale synced to the tall playerScale → the giant
  hoovered all 10 ring pieces (+10 score exactly, matching every failure).
  Fix: boss parked at +5u — inside the 5.76u gameplay contact reach, feast
  ring beyond ANY render-box reach, scarf pointed away. 6/6 repeat green.
  Spec comments warn plan-026/H6: unifying the pickup box onto
  state.playerScale will need a post-kill shrink here instead.
- The boss occupies one threat slot + one cap slot for as long as it lives
  (it counts in the DT-4 threat gate and the hard cap 12) — one slot of
  twelve, judged acceptable; noted for the 026/027 reviewers.
- New spec file tests/worldfun.spec.js — 8 cases, all through the real sim
  (game-clock waits, seeded fixtures, zero mocks): seed determinism across
  reload + divergence; toggle round-trip across its reload (run NOT started
  by the toggle press); daily double-record + stale-seed prune + TODAY'S
  BEST; DISCOVERED + REGIONS death line; gold scatter + collect beat; titan
  warn/immunity/restart-clears; titan kill payout/feast/no-second;
  ?daily=1 + ?seed-outranks-daily.
- Docs (b86934e): readme world-identity paragraph (seeds, daily race,
  regions, gold, titan) + tests listing.
- Gate at final HEAD: npm test 116/116 (108+8) twice consecutively (6.0m,
  5.9m, workers:3, ZERO flakes either run); lint 0 at every slice; build
  exit 0. Balance changes live ONLY in the GAME BALANCE block
  (REGION_DISCOVER_DEBOUNCE, GOLD_FOOD_POINTS/GOLD_CHUNK_CHANCE, BOSS_* ×7)
  with rationale comments; BASE_ENEMY_SPEED/RAMP_SPEED_MAX untouched (the
  titan multiplies SIZE, never speed — the no-enemy-base-speed-change STOP
  condition holds).

## 2026-08-08 — B7 review: APPROVE-WITH-ADVISORIES, 0 blockers → reconciled

- Reviewer traced all five hard questions clean: no titan spawn-deadlock (1 of
  12 slots; always eventually edible), restart leak spec-pinned, Node-clean
  seed module w/ complete consumer sweep, prune path never writes on read,
  early-return removal preserved every guarded behavior.
- Driver folded: ADV-1 TITAN DOWN! banner now rides the terrain height;
  ADV-3 the cap comment names the sanctioned once-per-run 13th-body exception;
  ADV-9 ?daily=0 is an explicit off-switch.
- Routed: ADV-2 biomeRegion hot-path allocation → B10 perf pass (H13);
  ADV-4/7/8/10 recorded as notes (fleeing-titan slot, food-layout re-roll on
  the default seed, realized gold rarity ~1/14-16, region-name granularity).
- PLAYTEST BRIEF additions: (12) on daily runs the NEW BEST celebration now
  tracks TODAY'S board, not the all-time endless board — an all-time PB on a
  daily world gets no confetti; owner call whether both should fire. (13) A
  past-midnight daily death briefly shows a one-row TODAY'S BEST that
  self-retires on the next view — by design, may read as a glitch once a year.

## 2026-08-08 — B8: plan 026 two-player split-screen (stages A-F, complete)

- The run's HEADLINE batch. All six stages landed in order, each at full-suite
  green; no plan STOP condition fired. Commits: A ce9a709 (players[] refactor,
  116/116 x2), B 48e570f (split rendering + perf plumbing), C 8df1eb3 (seat
  claims + keyboard split, 121/121), D d9e3031 (two-anchor world services,
  123/123), E a8e9b5b (per-half rules/HUD/death/coop board, 125/125),
  F (entry buttons + docs; final gates in the Close).
- ARCHITECTURE: state.players[] + makePlayerState(seat) own every hero field;
  the classic singleton names (playerScale, score, collectTimeLeft, jump*,
  camY/Z, danger fields, ...) remain as accessor delegates to players[0] —
  the PERMANENT window.__game.state test surface, not temporary shims —
  while state.player/state.camera stay plain synced fields (the plan's
  "grep 'get player()' → none" criterion holds). Solo is byte-stable by
  construction: one player renders the exact pre-plan full-rect path (no
  scissor call), dual-mode HUD keeps every classic id, and Stages A-B landed
  with ZERO spec-assertion edits.
- H6 GRANT applied with a finding: setPlayerCollisionBox(box, player, scale,
  flatten) + new setCollectibleBox replace the pickup pass's render-tree
  setFromObject. The pickup site passes the RENDER scale (mesh.scale.y),
  keeping the render/gameplay-scale split the worldfun titan-kill spec
  depends on. The spec's self-described remedy ("post-kill shrink") for a
  GAMEPLAY-scale unification is provably unworkable: the kill and the
  collect sweep share one update() frame (no test-side interleave exists),
  and contact reach (5.76u) < the 6.67u the feast ring would need to clear a
  3.12u-half pickup box — geometrically unavoidable hoovering. Render-scale
  unification delivers H6's actual goals (body-block honesty — the scarf
  race the spec documents is now structurally impossible — plus the
  setFromObject cost gone); the spec comment was refreshed (assertions
  untouched).
- EN-ROUTE FIX (root-caused, not waved off as flake): the effects pool spec
  failed two consecutive full runs (solo-green both) — not a pool failure:
  "The enemy caught you." at game-time 0:03 froze every game-clock wait. Its
  own death-proofing (despawn live enemies each hop) let PENDING WARN DISCS
  materialize giants onto teleport landings. debug.clearPendingSpawns now
  exists and the spec clears the pipeline beside the bodies. Lesson recorded
  in learnings.md, alongside the three r128 renderer.info-resets-per-render
  trap (2P perfInfo needs autoReset=false + one reset per frame).
- PERF (matched 3-giant statue rig, H10 discipline): solo 263 calls / 50.1k
  tris / 0.78ms frameMsAvg → 2P 410 / 83.9k / 1.19ms = 1.56x / 1.68x /
  1.53x. The 2.4x frame-time STOP never approached; ratios sit under 2x
  because each half frustum-culls its own view. Plan 028 re-measures.
- Plan-expectation note for reviewers: the plan's Stage D "bump chunk/cloud
  pool caps (constants)" assumed fixed caps; the landed pools are lazy
  high-water pools with no cap constants — 2P self-sizes (~90 active chunks
  at 600u separation vs ~81 solo). The union window + per-seat bubbles and
  the new ENDLESS_ENEMY_CAP_COOP=16 are the real knobs (GAME BALANCE, with
  rationale).
- SCREENSHOTS (.elves/runtime/): b8-2p-divergent-a/b.png (keyboard-driven
  divergence, visible seam, hero centered per half), b8-2p-full-hud.png
  (per-seat columns + shared TIME), b8-solo-final.png vs b8-stageB-solo.png
  (solo view unchanged through C-F), b8-overlay-final.png (1P/2P buttons).
- Suite 116 → 126 (tests/coop.spec.js, 10 cases: pad seats + divergence,
  keyboard split, kb-active claim tiebreak + ghost immunity, per-seat jumps,
  union terrain/food, midpoint same-delta rebase, per-seat HUD, spectator →
  team death screen + coop board isolation, entry-button persistence, solo
  input regression).

### FAMILY PLAYTEST BRIEF (B8 additions)

- (14) TWO PLAYERS is live on the start screen. Cheat-sheet for the couch:
  P1 = WASD + Space (orange, left half); P2 = Arrows + / (slash) to jump
  (teal, right half). Pads: wiggle a stick and that pad OWNS that hero —
  first mover gets P1 unless someone's already walking on WASD, then the pad
  politely takes P2; the pad's A button jumps its own hero. P pauses both.
  One shared world: you can split up (the world streams around both of you)
  or hunt as a pack. An enemy shows YELLOW on YOUR half only if YOU can eat
  it — check your own screen before you charge.
- (15) When one of you falls, the other plays on — the fallen half watches
  the survivor under a WAITING chip (no rejoin until the next run; tell us
  if mid-run rejoin feels missed). Both down = one screen with both scores
  and a TEAM total; that total ranks on its own TEAM RUNS board — 2P runs
  deliberately never touch the solo or daily boards. Worth testing on the
  real couch: does 16 max monsters for two of you feel scary enough? And is
  the shared zoom level fine, or does someone want their own?

## 2026-08-08 — B8 REVISION: review blockers 1-4 fixed (plan 026)

- All four review BLOCKs closed, no fallback paths needed. BLOCK-1/ADV-3
  (daed48e): the coop vignette/score-pop/combo-pop CSS was id-only — base
  rules now carry the class selectors (+ reduced-motion twins), so the 2P
  clones actually paint. BLOCK-2 (8abc335): spawnNewEnemies reads the coop
  16 cap by the same players.length>=2 rule as the bubble — kill
  replacements flow again past population 12 in 2P. BLOCK-3 (7ede18c):
  viewAspect returns FULL aspect while onStartScreen (the overlay is
  single-view); startRun/setupNewGame re-aspect on both transitions — the
  2P title stretch is gone (b8r-2p-overlay-unstretched.png). BLOCK-4
  (57f04e8): per-half arrow passes landed as prescribed — one pass per
  living seat through its own camera, pool split 5/5, seam-clamped, colored
  by canKillSpecificEnemy(enemy, viewer); solo keeps the identical
  full-rect whole-pool pass (b8r-2p-arrows-in-half.png shows the same grunt
  yellow on P1's half, blue on P2's). ADV-7 (combo dies with the hero) and
  ADV-9 (pre-allocated anchor slots) rode along (57f04e8/f8afc3d).
- Suite 126 → 129: the three reviewer-demanded coop specs — per-half
  vignette (asserts the CSS rule MATCHED: radial background + absolute
  position, not just driven opacity), coop board ranking (teamScore desc,
  maxDistance tiebreak above the new run, trim to 5, is-new at rank 3), and
  per-half arrows (bounds + per-viewer colors). Session acceptance rows
  026-R1..R4 added with evidence.

## 2026-08-08 — B8 delta re-review: CLEAN → Batch 8 fully closed

- All 7 revision items verified: CSS specificity math (per-seat overrides win,
  solo byte-identical), cap predicates character-identical at both sites,
  onStartScreen flips at exactly two sites each followed by re-aspect, solo
  indicator arithmetic identical by substitution, seam untouchable (arrow
  half-diagonal 14.14px < 15px padding), pool 5/5 coverage incl. seat death,
  per-viewer color, no new allocations, all three specs non-vacuous, scope
  exact. Verdict CLEAN; zero blockers.
- Delta advisory banked (H14 → B9): coop-board tiebreak spec leg is not
  deletion-discriminating (stable sort masks it) — seed the high-distance
  equal-score row AFTER the other so deleting the tiebreak term fails.
- B8 review advisories routed: PLAYTEST BRIEF (16) beyond ~560u separation
  the water surface is out of view range for both heroes — lakes still block
  by math (shorelines read as invisible walls at extreme splits); (17) if one
  hero dies and the survivor travels far, the fallen half's frozen backdrop
  can show released terrain behind the death box. NOTES for a future pass:
  popup sizing uses P1's camera scale (ADV-4), scared-face is
  nearest-player not per-viewer (ADV-5), pickup box narrows ~13% during the
  collect squash (ADV-6), perfInfo accumulates a paused-zoom render (ADV-8).
  LEARNINGS: classic+2P via forceWorldMode is seat-0-only (ADV-10 — latent,
  debug path only).

## 2026-08-08 — B9 (plan 027): test depth + hygiene drain — COMPLETE

- `debug.advance(seconds)` landed (the batch's only game-code surface, per
  plan scope): `advanceGameTime` in game.js cancels the ONE pending rAF
  (animate re-requests at frame top, so `state.animationFrameId` is always
  the in-flight handle), loops the REAL `update(1/60)` `ceil(seconds*60)`
  times, nulls `lastFrameTime`, re-requests. Guard: throws on a dead run
  unless `{allowMenu:true}` (paused steps are deliberate no-ops — the game
  clock IS frozen under pause; that is the tested invariant, not a stepper
  gap). Single-rAF handback pinned by a Chromium rAF-id consumption probe
  (~2 ids/frame healthy vs ~3 doubled; lower bound also catches a dead loop).
- New deterministic-kill choreography now shared by balance/timing/gamepad:
  hang the hero MID-JUMP over a debug-spawned fixed-scale grunt — the
  flattened enemy-contact box makes the kill, the unflattened pickup box
  ignores the scattered food, so score deltas are PURE payout. Exact asserts
  all HOLD against live code (no real-bug STOP fired anywhere in B9):
  35 = 25+5*floor(1.2*2) at x1; 175 = bounty*5 at the seeded x5 cap (stays
  5, window refreshed); combo expiry at advance(4.5) zeroes count/window and
  hides a VISIBLE chip (two chained kills first).
- Rotation pinned: 8 consecutive overlay-deterministic schedules classify to
  SPAWN_SIZE_PATTERN exactly — species sequence + per-band height ratios
  (giants exactly 1.5, juja exactly 0.35, prey/peer/sprinter in-range);
  schedule-then-clear per slot keeps the threat gate out of the picture.
- Pause invariants: combo window + runTime byte-frozen across a 1s in-page
  wall wait (kill and pause land in ONE evaluate — live CDP-gap frames had
  ticked the window in the first draft); music off under pause, back on
  resume; spawn cooldown freeze proven over a 5s wall pause (0 scheduled)
  then ≤1 top-up inside the first 1.25s interval and ≥1 by 1.37s, all
  stepped inside a single evaluate so no live frame can pollute the window.
- New tests/spawnwarn.spec.js (4): schedule→disc-in-scene (RingGeometry at
  the warn coords)→zero enemies all window→exactly one after, at the disc's
  spot; 10 schedule/materialize cycles with real rendered frames between →
  geometry delta ≤1; death mid-warn FREEZES the pipeline (pending timer
  byte-identical across 40 rendered frames, nothing materializes over the
  death screen, advance() throws on the dead run, restart clears the disc);
  5x speed e2e — warnTime exactly 0.95*2.2, still pending at 1.9gs,
  delivered by 2.2gs. DRIFT NOTE: plan 027's step 4c phrase "disc cleared on
  the death frame" contradicts plan 019's own landed guard (C-1 freeze;
  "warn discs already clear there [setupNewGame]" — 019 Step 1 text). The
  spec asserts the LANDED freeze+restart-clear invariant; game code
  untouched. Flagged for the driver as drift, not a bug.
- Jump: apex(3)/apex(1) matches (1.55+0.75*2)/1.55 ±5% from real
  Space-launched arcs stepped per-frame; gravity float-identical across a
  mid-air scale-12 mutation (locked per arc). Rumble: spy vibrationActuator
  on the mock pad — kill fires the 55ms kick, death the 180ms pulse, BOTH
  while muted (rumble deliberately ignores mute; current behavior asserted
  per plan, with a flip-me comment). Bind sweep: every bind in input.js's
  header comment now has a spec — added D-pad move, A jump, B pause,
  Select mute (aria + storage), Y/X speed steps, LB/RB zoom, Start+Select
  chord (Select half provably not firing its single bind); a sweep map
  comment in gamepad.spec.js indexes bind → spec.
- Hygiene drained (survival-guide bank): H1 corrupt-storage now corrupts the
  ENDLESS key the death screen reads; H2 ranking seeds a 5-pt/900u row that
  must render FIRST; H3 zoom click-loops run over a calmed world (+ live
  gameActive proof); H4 popup spec got the drain-then-settle order; H5
  deviceScaleFactor:3 pins the 1.5 DPR cap exactly; H12 pending-threat gate
  (4 shrunk-hero discs suppress the top-up; clearing reopens it); H14 coop
  tiebreak reseeded so stable sort without the term fails 3 asserts.
- Wall-clock retirement: all 17 non-audio waitForTimeout sites converted —
  frame-settles (new helpers.settleFrames: rendered-rAF chain, the honest
  axis for GPU registration and for frozen-clock death/pause stability),
  game-clock waits (hop loops, touch integration, the reduced-motion 5s play
  — now death-proofed so the game-clock wait can never hang on a frozen
  death clock), and in-page setTimeout ONLY where "wall time passes, game
  must not move" is itself the assertion. audio.spec's two Web-Audio waits
  annotated + eslint-disabled. New tests/-scoped no-restricted-syntax rule
  bans page.waitForTimeout ("use waitGameSeconds/advance (game clock ≠ wall
  clock)") — proven firing on a probe file before removal.
- Gates: suite 129 → 150 (21 new cases, 1 new spec file), 150/150 twice
  consecutively at workers:3 (7.2m, 7.1m) with ZERO flakes either run — the
  H4/H11 load-flake class did not reappear post-retirement; lint 0; build
  exit 0. Commits e8839d2, 1a2d926, e92d42a, f2a7c19, 650b716, 60f87bd.

## 2026-08-08 — B9 driver reconcile

- Verified: lint 0, tree clean, 150/150 x2 zero-flake (wall-clock retirement
  drained the H4/H11 class — root fix confirmed). Hygiene H1-H5/H12/H14 all
  drained; survival-guide list cleared below.
- Drift reading CONFIRMED as intended: warn discs FREEZE on death (with the
  whole world) and clear on restart — consistent with the death-freeze
  aesthetic; the audit's C-1 note about them was a symptom description, not a
  clear-on-death requirement. One-line endGame change if the family ever
  prefers clearing.
- B9 is tests-only: dedicated review SKIPPED in favor of the imminent
  terminal cumulative review (recorded decision, elves proof-budget rule).

## 2026-08-08 — B10 (plan 028): perf pass 2 — measured, all three gated steps SKIPPED on the numbers; H8+H13 shipped; final docs re-touch

- MEASUREMENT DISCIPLINE (Step 0, binding): transient rig spec (H10 law — the
  pinned 3-giant-statue ring at fixed offsets riding the hero), 1280x800,
  per-frame instrumented. Per-frame body cost RECONSTRUCTED exactly from the
  frameMsAvg EMA (sample_k = avg_{k-1} + 20*(avg_k - avg_{k-1})); frames
  classified quiet / recolor / build by terrainInfo counter deltas. Travel
  scenarios: 60 game-seconds each, REAL input path (synthetic key events on
  document), stall-rotate steering (90° when 45 frames move <1.5u — first rig
  draft marched blind north and parked against the same shoreline in all four
  scenarios, betrayed by identical 160-162u distances at 1x AND 5x; kept as
  corroboration, per-event costs match), radial tall-foe push so no scripted
  march can end in a contact death. Zero deaths in all measured runs. Raw
  traces: .elves/runtime/b10-rig-{baseline,after,baseline-v1-stalled}.json;
  rig deleted before the gates.
- DECISION TABLE (baseline at 2c74403^, all four travel runs 60.2-60.7gs):
  | scenario | calls med/p95/max | tris | quiet ms | recolor ms (n) | build ms (n) |
  | parked-solo | 136/136/136 | 48.6k | 0.69 | — | — |
  | parked-2p | 286/286/286 | 82.5k | 1.09 | — | — |
  | travel-solo-1x | 139/227/243 | 56.3k | 0.78 | 1.27 max 1.5 (26) | 1.25 max 2.1 (56) |
  | travel-solo-5x | 121/223/283 | 57.5k | 0.78 | 1.32 max 1.8 (73) | 1.15 max 2.5 (156) |
  | travel-2p-1x | 324/483/550 | 93.6k | 1.43 | 2.00 max 2.3 (25) | 1.85 max 2.9 (63) |
  | travel-2p-5x | 273/433/552 | 98.2k | 1.40 | 2.02 max 2.7 (64) | 1.87 max 3.5 (182) |
- STEP 1 (water recolor) SKIPPED per Step 0 numbers: recolor frames cost
  +0.49/+0.54ms over quiet solo, +0.58/+0.62ms in 2P — the criterion was an
  avg jump >2ms; the WORST absolute recolor frame anywhere was 2.7ms total.
  The audit's 3-8ms burst estimate (P-3) measured 6-16x pessimistic on this
  hardware: 6,561 verts x 4 noise octaves is sub-millisecond work here.
- STEP 2 (chunk-tint corner interpolation) SKIPPED per Step 0 numbers: build
  frames at 5x cost +0.37ms (solo) / +0.47ms (2P) over quiet, worst absolute
  3.5ms at ~2 builds/frame — no spike (P-12's 1.2-2.6ms estimate roughly
  right per-burst, but ~20% of a 60fps budget at worst, not a stutter).
- STEP 3 (instancing) SKIPPED per Step 0 numbers: 2P steady-state calls
  286 parked / 273-324 travel medians — under the plan's >400 gate (B8's 410
  was a different scene mix; same game code — B9 was tests-only). Honest
  caveat recorded: transient P95/max peaks 406-591 when enemy clusters +
  camera facing align, but the plan gates on steady state, and the
  L-effort/MED-risk shader-patch ladder is not justified by transients that
  enemy meshes (not scenery) dominate.
- H13 SHIPPED (B7 review adv.2 grant): biomeRegion split into biomeRegionKey
  (identity-only hot path — one short string, no object/name-hash/CSS-color
  per player per frame from updateRegionDiscovery) + biomeRegion (display,
  built only on discovery commits / resets / debug). Shared biomeBin keeps
  one binning rule. Evidence: 23,961-point key-equality sweep 0 mismatches;
  micro 34ns vs 111.5ns per call (3.3x); worldfun pins hot===display keys
  permanently; DISCOVERED banner e2e still green.
- H8 SHIPPED (B2+B3 review adv.7 grant): pooled chunk-mesh re-acquire now
  gates frustumCulled on mesh.userData.registered (set by the eager-register
  onAfterRender flip at first real draw). Closes the reset-twice-without-
  render hole where a never-rendered pooled geometry could re-enter culled
  and defer GPU registration past the resource-plateau specs' premise.
  Unreachable today (every reset path renders between builds) — closed with
  the full why in the comment; un-registered re-acquires simply re-enter the
  eager path their still-pending flip already implements.
- AFTER-measurement (same rig, at 2c74403): parked scenarios reproduce
  byte-identically (136 / 286 calls, tris identical) — the deterministic rig
  is exact; travel quiet/event costs within noise of baseline (quiet 0.76/
  0.82/1.37/1.38ms; recolor 1.29-2.01; build 1.08-1.75). No regression.
- FINAL DOCS RE-TOUCH (021 maintenance note): readme tests listing +spawnwarn
  (B9 drift); readme deploy step no longer claims "no config file needed"
  (B4 shipped vercel.json security headers); CLAUDE.md suite ~5 -> ~7 min
  (150 tests / 3 workers). Verified against code with no drift found: species
  text, daily-world + seed lines, titan beat, 2P section + controls table,
  pad X/Y speed mapping, combo window 4s, cap 12, gold 5pts, milestone 250u,
  distance-first ranking. plans/README: row 028 DONE (skip table inline),
  run-section status line added (017-028 all DONE, branch unmerged).
- GATES at final code state (rig deleted, 2c74403+aa2976b): 150/150 twice
  consecutively (7.2m, 7.3m, workers 3, zero flakes — B9's zero-flake state
  holds); npm run build exit 0; lint 0. Commits 2c74403 (H13+H8), aa2976b
  (docs re-touch), Close. No plan STOP condition fired anywhere in B10.
