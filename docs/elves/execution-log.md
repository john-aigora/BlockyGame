# Execution Log — feat/audit-2026-08

Chronological proof. Newest entries at the bottom. Digest-worthy lessons get
promoted to `learnings.md`; stable truths to CLAUDE.md.

## 2026-08-14 — Staging

- Global elves skill updated 2.23.1 → 2.29.0 (source `~/research/dev/elves`
  at upstream HEAD `344ae1a`; `sync_installed_skills.py --apply --target
  claude` via python3.12 — system python3 is 3.9, below the repo floor).
- Audit round complete before staging: plans 029–036 + ROADMAP authored,
  shipped as PR #19 (fork branch `plans/audit-2026-08-14`); bugs filed as
  issues #6–#18 on john-aigora/BlockyGame; baseline verified green
  (154/154, 8.3 m; lint 0; build 0) at `main@c1ffd13`.
- Run branch `feat/audit-2026-08` created off
  `plans/audit-2026-08-14@87262a6`. No worktree (recorded decision — see
  survival guide). Run docs written: run plan, survival guide, worker
  packet, this log, `.elves-session.json`.
- Push policy for this run: fork branch only; the previous run's LOCAL-ONLY
  rule is dead (PRs #4/#5/#19 precedent). Merge stays user-owned.
- Staged, NOT launched — awaiting kickoff.

## 2026-08-15 — B1 [plan 029] Ascension — COMPLETE

- Implemented per plan: constants (7 knobs), per-player ascension/ascended
  state, src/ascension.js (halo/beam pooled meshes, lift/rise/burst phases,
  settled-players return), game.js wiring (trigger in collect path, tick in
  update(), finishAscension settle owns endGame/settleAscendedPlayer routing
  — ascension.js stays ui-free), threat-surface stand-down (targeting,
  collision, collect clock, danger, indicators, pickup loop, jump, enemy
  mult), endGame ascended path (+recorder asc/ascCount marks, ✦ rows,
  ASCENDED!/GAME OVER per-show title), camera lift (reduced-motion gated),
  sfx.ascend/ascendBurst, debug ascensionInfo.
- Spec: tests/ascension.spec.js — 8 cases green (incl. exact-title restore
  invariant, 2P settle, pause freeze, GPU plateau ±1 chunk-pool jitter).
- DISCOVERY mid-batch: the food-pickup loop needed the same ascension
  stand-down (mid-ceremony sweeps drifted score) — added with comment.
- Behavior-driven spec update: balance.spec giant-scale probes (scale 20/35)
  now mark ascension spent — any collect at ≥10 legitimately crowns the run
  now; those specs test bounty/combo/display, not the ceremony. Full-suite
  failures before fix: balance kill trio; after: none.
- Gates: lint 0, build 0, FULL SUITE 162/162 (8.4m) at close.

## 2026-08-15 — B2 [plan 031] 2P fairness + canvas truth — COMPLETE

- Per-target enemy pace: state.enemyPaceForSeat filled in applySpeedMultiplier
  (enemyBase × seat mult × shared rampFactor); enemies.js speciesSpeed reads
  the TARGET's slot in coop, classic global solo (byte-stable). Legacy
  max-of-living actualEnemySpeed retained for world-level consumers.
- Canvas geometry single owner: onWindowResize writes gameCanvasRect +
  centers + NEW viewW/viewH (borderless render sizes — the rect is
  border-inclusive and must never size a scissor; caught mid-batch when the
  cached-rect width 1610 ≠ clientWidth 1600); input.js duplicate
  listener/initial-call deleted; renderFrame split path reads the cache.
- Specs: constants imported (T-14), i1 exact-index pin, per-target
  arithmetic + enemyPaceForSeat asserts, NEW kinematic per-target test
  (mesa-core arena — measured that z=0 is a LAKE from x≈30 on this seed;
  6u gap + 1s advance makes P2-contact deterministically impossible; P2
  survival asserted — the old rule's 5x hunter caught them), death-recompute
  (P2 dies at 5x → pace drops to survivor), roster-drop (label + pace),
  pad Y/X per-seat routing via 2 mock pads (pressEdge → helpers.js),
  coop-wide rect truth on entry + exit (T-16).
- Gates: lint 0; targeted coop/gamepad/touch/species/balance green;
  per-target ×4 repeat stable; FULL SUITE 164/164 (7.8m).

## 2026-08-15 — B3 [plan 033] Small-fix bundle — COMPLETE

- All nine items landed: P-15 smooth01 hoist; P-14 frame-cached pad list
  (all four navigator.getGamepads sites route through ONE helper) + scratch
  intent arrays + HUD identity memo; P-16 coop hidden-score reflow guard;
  C-20 scheduler stall clamp + C-8 suspended-ctx start guard + resume
  gesture unlock; C-21 camera anchor after grounding; C-22 warn-disc
  ceiling (SPAWN_WARN_RADIUS_MAX=12, both sites); C-23 five knobs to GAME
  BALANCE byte-identical; D-15 ui→game import deleted (enemyPaceDirty flag,
  consumed at update() top); D-17 four comment-truth fixes.
- Deviation (recorded): per-step commits adapted to 5 slices — steps
  sharing files (game/ui/constants) merged thematically; every slice green.
- Spec hardening: death-recompute assert polls across the D-15 one-frame
  deferral. Targeted 76/76; FULL SUITE 164/164 (8.0m).

## 2026-08-15 — B4 [plan 030] Security hardening — COMPLETE

- npm audit fix: lockfile-only; root now 0 vulnerabilities. video/ tree
  RECORDED (not fixed — local-only, off the deploy path): 3 high.
- vercel.json → four per-page CSP blocks: site-wide script-src 'self' (the
  game page needs no inline/CDN — verified against dist/index.html);
  /original.html + /pad-test.html keep inline allowances; /original/(.*)
  gets the EXACT pinned cdnjs three.js r128 path (SRI impossible — museum
  is byte-frozen) + Google Fonts (original/index.html:9 uses them);
  form-action 'self' added everywhere (no default-src fallback).
- Root .gitignore env net (+!.env.example) verified with a scratch .env;
  video/.env.example created (name only). readme deploy note rewritten,
  incl. the mandatory post-deploy console check (headers production-only).
- Gates: lint 0, build 0, FULL SUITE 164/164 (8.2m).

## 2026-08-15 — B5 [plan 032] CI + docs truth — COMPLETE

- ci.yml: build step (fails in seconds, before the 8-min suite), Playwright
  browser cache keyed by lockfile, push trigger scoped to main (PR double-run
  gone), timeout 30→45 with rationale. YAML parse-checked (ruby).
- test:one script + docs (readme commands, CLAUDE.md). CLAUDE.md now owns
  the exact test count (164 at this batch; B9 re-touches after the fun wave).
- Docs truth: learnings.md restructured (five live lessons rehomed from
  "Retired", never-push rule superseded with the fork-PR workflow, GAME OVER
  invariant amended for ascension); todo.md species/juja/titan/daily checked
  with shipped annotations, Roblox section banner REJECTED per CLAUDE.md,
  override header added; readme structure map gains public/ (incl.
  pad-test.html), vercel.json, CI, docs/elves; pad-test surfaced in How to
  play + the plan-018 hardware-check row; plans/README historical never-push
  note struck through with supersession.
- DX-8: eslint exemption comment names the two known unlinted inline
  scripts. T-17: bootEndless deduped into helpers (3 specs, 23/23 green).
- Gates: lint 0; stale-docs greps clean; FULL SUITE 164/164 (7.8m).

## 2026-08-15 — B6 [plan 034] Ghost runs — COMPLETE

- src/ghost.js: recorder (TRUE-coordinate quantized flat samples on the game
  clock; GHOST_MAX_SAMPLES decimation + cadence doubling), one-time spectral
  mesh (hero rig re-skinned to ONE additive material, shadows off), replay
  interpolated against state.runTime (rebase-proof: local = true − origin),
  end-of-path GHOST FELL HERE / GHOST ASCENDED HERE marker + 1s fade.
- Storage in hiscores.js (loadGhost/saveGhost, shape-validated, best-wins);
  finalize rides a state.runEnded signal from endGame consumed in animate()
  (ui.js cannot import ghost.js — cycle law); ghost.js imported ONLY by
  game.js (ghostInfo re-exported for the debug handle).
- Overlay RACING THE GHOST line (?ghost=0 read duplicated in ui.js by
  design); readme seeded-world paragraph extended.
- Spec: 8 cases, first-try green (record cadence, persist+never-worse-
  overwrite, path tracking at runTime 2.5, ?ghost=0, foreign seed, 2P
  exclusion, GPU plateau, cap/decimation via 48 chunked advances).
- Gates: lint 0; ghost.spec 8/8; FULL SUITE 172/172 (8.4m).

## 2026-08-15 — B7 [plan 035] Skins + milestone unlocks — COMPLETE

- SKIN_PALETTES (characters.js look-table: ember/lime/midnight/gold/
  celestial — teal reserved for P2) + GAME BALANCE thresholds; unlocks
  DERIVED live from endless+daily rows (distance/score/asc) — no unlock
  storage; selection under blocky.skin.v1 via hiscores.js (storage-owner
  law); resolveSkinColor keeps seat-0 default byte-identical (locked/
  missing/invalid all → ember).
- SKIN button in #mode-picker (Speed-button cycle, overlay-only): rebuilds
  the hero in place through the real createPlayer path; label refreshes on
  every overlay show so fresh unlocks appear post-run.
- Spec: 7 cases (byte-stable default, locked no-op cycle, live unlock+
  reskin, reload persistence, locked-selection fallback, 2-lap leak check
  with stream-settled sampling + established ±1 registration jitter,
  P2-always-teal). Debugged: scene-children sampling had to wait out the
  title-screen terrain/cloud stream (boot builds ~2 chunks/frame).
- Gates: lint 0; skins x2 repeat green; FULL SUITE 179/179 (8.7m).

## 2026-08-15 — B8 [plan 036] Board honesty (mult on rows) — COMPLETE

- state.runMaxMult high-water (reset+reseed in setupNewGame; captured in
  applySpeedMultiplier's living-seat pass — every mult change routes there);
  recordScore/recordCoopScore gain a trailing mult param (additive field,
  only when >1); renderHiscores appends " · Nx" to all three row shapes;
  sort functions byte-untouched (diff-verified).
- Spec learning: the seat's speed index persists across restarts BY DESIGN —
  the "clean 1x second run" case must drop the toy before restarting.
- Gates: lint 0; hiscores 5/5 + coop mult assert; FULL SUITE 180/180 (8.7m).
