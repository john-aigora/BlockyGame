# Plan 018: Fix the joysticks — active-pad rescan, honest activity scoring, per-pad edge state

> **Executor instructions**: Follow step by step; verify each step. On any STOP
> condition, stop and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 128d18e..HEAD -- src/input.js tests/gamepad.spec.js`
> On drift vs the excerpts below, STOP.

## Status

- **Priority**: P1 · **Effort**: M · **Risk**: MED (real-hardware behavior; mocks can pass while hardware fails)
- **Depends on**: 017 (green suite)
- **Category**: bug
- **Planned at**: commit `128d18e`, 2026-07-31

## Why this matters

The owner reports "the joysticks aren't working." The family's sticks are classic
DB9 joysticks on a HuiJia dual DB9→USB adapter — per the proven notes in the
sibling repo `~/fun/battle-paddle/docs/atari-db9-dev-brief.md`: ONE USB device
(VID 0x0e8f, PID 0x3013) exposing TWO HID gamepad interfaces, often with the SAME
id string, where an idle second socket stays "connected" forever (a ghost pad).
BlockyGame's pad selection has two bugs that make exactly this hardware dead:

1. **The lock never lets go.** `activeGamepad()` returns the locked pad even
   when idle and never re-scans for another pad that IS producing input.
2. **Idle standard pads outrank live sticks.** `padActivityScore` adds +0.25 for
   `mapping === 'standard'` unconditionally — 0.25 alone clears the 0.15
   "producing input" bar, so a silent standard-mapping interface can claim the
   lock before the real stick is ever touched.

battle-paddle started from BlockyGame's code (its comment says "patterned on
BlockyGame") and fixed both; this plan ports the fix back.

## Current state

- `src/input.js:83-93` — `padActivityScore`:

```js
function padActivityScore(gp) {
    let score = 0;
    if (gp.mapping === 'standard') score += 0.25;   // ← unconditional bias
    ...
}
```

- `src/input.js:97-139` — `activeGamepad()`:

```js
if (preferredPadIndex != null) {
    const locked = list[preferredPadIndex];
    if (locked && locked.connected) {
        if (padActivityScore(locked) > 0.15) return locked;
        // Keep lock while connected even at rest, once claimed.
        return locked;                               // ← never re-scans
    }
    preferredPadIndex = null;
}
// ...then scans all pads for best activity, else locks the FIRST connected slot
```

- `src/input.js:54-61` — `prevPadButtons` is ONE global array; if the active pad
  switches, edges from the old pad leak onto the new one (false presses).
- REFERENCE (working) implementation:
  `~/fun/battle-paddle/outputs/pong-game/index.html:5236-5289` —
  `padActivityScore` biases standard mapping only `if (score > 0)`; and
  `activeGamepad()` scans ALL pads for activity FIRST, adopts any pad with
  `score > 0.15` (re-pointing the lock), and uses the lock only as the
  idle fallback. Comment: "Dual-port adapters leave a silent second interface
  connected forever. Never keep a preferred lock on an idle pad when another pad
  is producing input."
- Hardware facts to inline as a comment (from the DB9 brief; do not re-debug):
  digital sticks report ~±1 on axes 0/1 (clears the 0.18 deadzone); both
  interfaces may share an id → all identity handling stays by `gamepad.index`,
  never by id/name; Chrome may return an empty `getGamepads()` until the page
  has focus + one user gesture.
- Existing mock harness: `tests/gamepad.spec.js:8-35` installs a fake
  `navigator.getGamepads`; `tests/helpers.js` has the game-clock waits.
- `?paddebug=1` (`src/input.js:27-28`) shows a live pad HUD — the family's
  manual verification surface.

## Commands you will need

`export PATH="$HOME/.local/elves-tools/node/bin:$PATH"`

| Purpose | Command | Expected |
|---|---|---|
| Gamepad spec | `npx playwright test tests/gamepad.spec.js --workers=1` | all pass |
| Full suite | `npm test` | 0 failed |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope**: `src/input.js`, `tests/gamepad.spec.js`, `tests/helpers.js`
(extract the mock-pad installer), `readme.md` (one line in the Pad section
noting DB9-adapter support), `docs/elves/learnings.md` (one Known Traps entry).

**Out of scope**: two-player seat claims (plan 026); rumble; any button
remapping; `movement-continuous.js`.

## Git workflow

Run branch; `[<branch> · Batch N/M] <verb> <what>`; NEVER push.

## Steps

### Step 1: Fix `padActivityScore`

Move the standard-mapping bias behind activity, matching the reference:

```js
function padActivityScore(gp) {
    let score = 0;
    const ax = gp.axes || [];
    for (let i = 0; i < ax.length; i++) score += Math.abs(axisValue(ax, i));
    const btns = gp.buttons || [];
    for (let i = 0; i < btns.length; i++) if (buttonPressed(gp, i)) score += 2;
    // Bias standard mapping only when the pad is already producing input, so an
    // idle Xbox pad cannot outrank a live DirectInput/DB9 stick (battle-paddle fix).
    if (score > 0 && gp.mapping === 'standard') score += 0.25;
    return score;
}
```

**Verify**: `npm run lint` → 0.

### Step 2: Rescan-first `activeGamepad`

Restructure to: (1) scan every connected pad, track `best`/`bestScore`/`first`;
(2) if `bestScore > 0.15` → set `preferredPadIndex = bestIndex`, return best —
even if a lock exists on another pad; (3) else if the lock is connected, return
it; (4) else lock+return `first`; (5) else null. Keep the ghost-slot comment and
add: `// HuiJia dual DB9→USB: one device, two interfaces, same id, idle socket`
`// always connected — identity by gamepad.index only, and activity always wins.`
**Verify**: `npx playwright test tests/gamepad.spec.js --workers=1` → existing tests pass.

### Step 3: Per-pad edge state

Replace the single `prevPadButtons` array with a `Map` keyed by `gamepad.index`
(e.g. `prevPadButtonsByIndex`). `buttonEdge`/`snapshotButtons` take the pad and
use its own entry; delete entries on `gamepaddisconnected` if a listener exists
(add one if not — it is also where the pad HUD wake note lives). Behavior when
the active pad switches: the new pad's first poll snapshots without firing edges
(same first-poll seeding the code already does on connect — `src/input.js:278-281`).
**Verify**: gamepad spec passes; no `prevPadButtons` global remains (`grep -n "prevPadButtons" src/input.js` shows only the Map).

### Step 4: Regression tests (mock scenarios from the real hardware)

Extract the mock-pad installer from `tests/gamepad.spec.js:8-35` into
`tests/helpers.js` as `installMockPads(page, pads)` supporting MULTIPLE pads.
New tests in `tests/gamepad.spec.js`:

1. **Ghost-first dual interface**: pads = [idle DI pad (same id), active DI pad
   (same id, stick held −1 on axis 1)]. Assert the player moves (−Z) — i.e. the
   active interface wins even though the ghost enumerates first.
2. **Idle-standard vs live-DI**: pads = [idle standard-mapping pad, DI pad with
   stick held]. Assert movement follows the DI pad.
3. **Lock hand-off**: pad A active → A idle, pad B active. Assert B drives
   within one poll (no permanent lock on A).
4. **No cross-pad edges**: press Start on pad A (pause toggles), release; make
   pad B active with Start ALREADY held → assert pause does NOT toggle again
   (first-poll seeding on the new pad).

**Verify**: `npx playwright test tests/gamepad.spec.js --workers=1` → all pass (existing + 4 new).

### Step 5: Docs + manual hardware check

- readme Pad line: add "Classic DB9 joysticks via dual-port USB adapters work —
  each port is a separate pad; wiggle the stick once to claim."
- `docs/elves/learnings.md` Known Traps: one entry — dual-port DB9 adapters
  enumerate a permanently-connected ghost interface; pad selection must
  re-scan for activity every poll (this plan), identity by index only.
- Leave a note in the run log for the family: verify on real hardware via
  `?paddebug=1` — both sticks, one at a time, should each drive the player
  after one wiggle.
**Verify**: `npm test` → 0 failed.

## Test plan

The 4 scenarios in Step 4, modeled on the existing mock harness. Full suite
green. Real-hardware confirmation is a HUMAN step — flag it in the completion
report; do not claim hardware-verified.

## Done criteria

- [ ] `npm run lint` 0; `npm test` 0 failed
- [ ] All 4 new scenario tests exist and pass
- [ ] `grep -n "score += 0.25" src/input.js` shows it inside the `score > 0` guard
- [ ] `activeGamepad` scans before honoring the lock (code review)
- [ ] `plans/README.md` row updated (note "hardware check pending family")

## STOP conditions

- The Step 4 scenarios can't be expressed with the mock harness (e.g. the
  harness can't represent two pads) after one refactor attempt.
- Fixing selection changes behavior asserted by an existing test in a way that
  looks user-visible beyond the bug (e.g. F310 single-pad path regresses).

## Maintenance notes

- Plan 026 (two-player) builds seat claims on top of this: claims by
  `gamepad.index`, first MOVING pad = a seat — keep `padActivityScore` cheap.
- If the family reports sticks still dead after this, the next suspects (from
  the DB9 brief) are: page lacked focus/gesture (Chrome returns empty pad list),
  or the adapter mode switch — both are environment, not code.
