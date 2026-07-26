# Design notes: Little Big Snake-style continuous movement + boost (plan 014 spike)

Written 2026-07-25 during the plan-014 design spike. The prototype lives in
`src/movement-continuous.js` behind the `?move=continuous` URL flag; classic
movement is byte-for-byte untouched on the default URL. **The decision this
document drives is the deliverable — the prototype code is disposable.**

## 1. How to run both modes

```
npm run dev
```

| Mode | URL | Controls |
|------|-----|----------|
| Classic (unchanged) | `http://localhost:5173/` | Arrows move (4-dir), Space = pause, drag on touch |
| Continuous prototype | `http://localhost:5173/?move=continuous` | Player always moves toward the mouse cursor; **hold Space = boost** (×1.5, drains the cyan energy bar); **P = pause**. Touch: drag to steer, heading persists after finger lift; hold the round BOOST button. |

Same URLs on the deployed site — just append `?move=continuous`. Play a full
run in each mode (die at least once); it takes ~10 minutes total.

## 2. Family playtest scorecard

Rate each 1-5 per mode (or circle a winner). One column per player.

| # | Question | Classic | Continuous | Notes |
|---|----------|---------|------------|-------|
| 1 | Easier to **dodge** enemies? | | | |
| 2 | Easier to **hunt** yellow (killable) enemies? | | | |
| 3 | Which **feels faster** / more exciting? | | | |
| 4 | **Mobile comfort** — steering + boost button reachable, no cramped thumbs? | | | |
| 5 | "**One more try**" pull — which mode makes you restart without thinking? | | | |
| 6 | **Kid's verdict** — which one would you show a friend? | | | |

Tie-breaker question: did anyone *miss* being able to stand still?

## 3. What the prototype does (and its numbers)

- Desktop: mouse raycast to the y=0 plane; heading steered with a
  framerate-independent lerp `1 - e^(-6·dt)`; constant `actualPlayerSpeed`;
  the cube rotates to face its heading (its face genuinely leads).
- A ~0.5-unit deadzone around the cursor holds course instead of spinning.
- Mobile: the existing drag vector steers; on release the last heading
  **persists** (verified: the player keeps gliding on the lifted heading).
- Boost: ×1.5 speed while held and energy > 0. Energy 100 max, −10/s
  boosting, +5/s regen (measured in a scripted run: 9.95/s drain, 4.93/s
  regen, speeds 4.49 vs 3.0 world-units/s at 1x). Faint cyan particle trail
  while boosting (reuses the plan-015 pool).
- Wrapping, collisions, camera, enemies, timers: completely unchanged.

## 4. Open design questions discovered while prototyping

1. **Space is contested.** Classic uses Space for pause; boost wants
   hold-Space. The prototype moves pause to **P** in continuous mode only.
   If adopted, pick one for real: P for pause everywhere (retraining), or
   boost on left-click/Shift instead. The pause *button* still works in both.
2. **Constant motion vs. the 15s collect timer.** You can no longer park next
   to a block and wait — you orbit it or overshoot. That's mostly good
   (pressure!), but with growth the deadzone-to-player-size ratio shifts;
   large players jitter-orbit food. A real version should scale the cursor
   deadzone (and maybe pickup radius) with `playerScale`.
3. **Does boost trivialize fleeing yellows?** Enemy speed is 50% of player
   base; boost makes the gap enormous. Kills may become free — the +25
   bounty and the 2-per-kill spawn rule were tuned around 4-dir chase
   geometry. Candidate fix: yellows get a panic-flee speed burst, or boost
   drains faster (15/s) so it's a commitment.
4. **Camera look-ahead.** The camera sits straight down-behind; at boost
   speed you outrun your own view heading up-screen. A real version should
   bias the camera target a few units along the heading (and maybe widen
   fog/zoom while boosting).
5. **Diagonal speed identical, but feel differs.** Classic diagonals move at
   √2 speed (two axes summed); continuous is a true constant speed. The game
   is effectively *slower* in continuous mode for skilled classic players —
   retune `BASE_PLAYER_SPEED` (or accept the nerf) if adopted.
6. **Mobile boost button placement** is a guess (bottom-right circle).
   Left-handed kid? Test question 4 covers it.
7. **Heading persistence + world wrap**: gliding untouched into the wrap seam
   works fine (worldmath untouched), but a persisted heading means an idle
   phone drifts forever — fine for a snake game, worth confirming it doesn't
   feel like "the game plays itself".

## 5. Recommendation

**Pending family playtest** (the scorecard above makes it a 10-minute task) —
but the spike's own verdict is **adapt, don't adopt-as-is**. The scheme works
mechanically (steering feels deliberate at turn-rate 6, boost is a real
risk/reward with 10/5 drain/regen), and rotation + persistence came out clean.
A real implementation needs, at minimum:

1. **Retuning pass**: `engagementRadius`, `BASE_ENEMY_SPAWN_DISTANCE`,
   enemy orbit strength, and collect-timer pressure all assume a player who
   can stop. Boost also needs an answer for fleeing-yellow chases (see Q3).
2. **Input decision**: settle Space-vs-P (Q1) and mobile boost-button
   ergonomics; update `#instructions` and the start overlay copy.
3. **Camera look-ahead + deadzone scaling** with `playerScale` (Q2, Q4).

If the playtest says yes: write a new full plan (real tests, retune, decide
whether classic stays as an accessibility option) and delete this prototype
module as part of it. If no: delete `src/movement-continuous.js`, the
`MOVEMENT_MODE` branches in `game.js`/`input.js`/`constants.js`/`main.js`,
and note the cleanup in `plans/README.md` — this writeup stays either way.
