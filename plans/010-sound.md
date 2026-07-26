# Plan 010: Retro sound effects with zero audio assets, plus a persistent mute toggle

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: plan 008 must be DONE (`startRun()` must exist
> as the single "run begins" entry point — this plan hangs the browser
> autoplay-unlock on it). If missing, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/008-start-and-death-screens.md
- **Category**: direction (feature)
- **Planned at**: commit `f4d3ecc`, 2026-07-25

## Why this matters

The game is fully silent. The maintainers' `todo.md` has a 16-item audio wishlist ("Sound Effects: ... Food collection ... Enemy defeat ... game over ... Button clicks ... Music"). Synthesized WebAudio needs **no asset files, no licensing, no loading** — a few oscillator envelopes give the game an arcade feel that players (especially the co-author, a kid) will feel immediately. Scope: the five effects with the highest feel-per-line, a mute toggle that persists, and correct handling of the browser autoplay policy (an AudioContext may only start after a user gesture — get this wrong and every sound silently fails).

## Current state

- No audio code anywhere: `grep -rn "AudioContext\|Audio(" src/` → empty.
- Run-begin gesture: `startRun()` (plan 008) fires on the start button / key / pointer — a valid user gesture for `AudioContext.resume()`.
- Event sites to hook (post-002/004/008 module layout):
  - Food collected: the collect branch in `src/game.js` (originally `game.js:804-814`, where score increments and `resetCollectClock()` is called).
  - Enemy killed: `killEnemy(...)` in `src/enemies.js` (plan 004).
  - Death: `endGame(reason)` (plan 004).
  - Run start: `startRun()` (plan 008).
  - UI clicks: the button listeners wired in `init()` (originally `game.js:160-166`).
- UI corners are all occupied (pause TR, restart TL, speed BL, zoom BR per `style.css:188-206`) — the mute button goes into `#ui-container` (the panel below the canvas, `index.html:29-42`).
- localStorage pattern with try/catch exists in `src/hiscores.js` (plan 009) — mirror it; if 009 hasn't run yet the pattern description here is self-sufficient.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |

## Scope

**In scope**: `src/audio.js` (create), one-line hook calls in `src/game.js` / `src/enemies.js` / `src/ui.js` / `src/input.js`, `index.html` (mute button), `style.css` (mute button), `tests/audio.spec.js` (create).

**Out of scope**: background music (wishlist, but loops need real composition — defer), volume slider, any gameplay change. Do not add audio asset files of any kind.

## Git workflow

- Branch: `improve/010-sound`
- Commit style: `Feat: ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: The synth module

Create `src/audio.js` — self-contained, lazily initialized, mute-aware:

```js
let ctx = null;
let muted = loadMuted();

function loadMuted() { try { return localStorage.getItem('blocky.muted') === '1'; } catch { return false; } }
export function isMuted() { return muted; }
export function setMuted(m) { muted = m; try { localStorage.setItem('blocky.muted', m ? '1' : '0'); } catch {} }

export function unlockAudio() {           // call from a user gesture (startRun)
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } }
    if (ctx && ctx.state === 'suspended') ctx.resume();
}

function blip({ freq = 440, endFreq, type = 'square', dur = 0.1, vol = 0.2, delay = 0 }) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
}

export const sfx = {
    collect: () => blip({ freq: 660, endFreq: 990, dur: 0.08, vol: 0.15 }),
    kill:    () => { blip({ freq: 220, endFreq: 55, type: 'sawtooth', dur: 0.25, vol: 0.25 });
                     blip({ freq: 880, endFreq: 1760, dur: 0.12, vol: 0.12, delay: 0.05 }); },
    death:   () => { blip({ freq: 330, endFreq: 82, type: 'triangle', dur: 0.6, vol: 0.3 }); },
    start:   () => { [523, 659, 784].forEach((f, i) => blip({ freq: f, dur: 0.09, vol: 0.15, delay: i * 0.09 })); },
    click:   () => blip({ freq: 880, dur: 0.03, vol: 0.08 }),
};
```

Every public function must be a no-op (never a throw) when `ctx` is null or muted — audio failure must never break gameplay.

### Step 2: Hooks

One line each: `sfx.collect()` in the collect branch; `sfx.kill()` in `killEnemy`; `sfx.death()` in `endGame`; `unlockAudio(); sfx.start();` in `startRun()`; `sfx.click()` in the shared button-click paths (pause/restart/speed/zoom/mute listeners — if there's no shared path, add the call per listener; do not build an abstraction for 6 lines).

### Step 3: Mute toggle

- `index.html`: in `#ui-container`, before the score element: `<button id="mute-button" class="game-button" aria-pressed="false">🔊</button>`
- `src/ui.js`: click toggles `setMuted(!isMuted())`, sets text `🔊`/`🔇` and `aria-pressed`. Initialize the label from `isMuted()` at init (persisted state).
- `style.css`: size it like the corner buttons (inline in the panel, min 40px tap target).

**Verify (manual, dev server)**: start a run → 3-note jingle; collect → rising blip; kill an enemy → thud+chirp; die → descending tone; mute → silence, label 🔇; reload → still muted.

## Test plan

Create `tests/audio.spec.js` (audio output can't be asserted headlessly; assert STATE and RESILIENCE):

1. **Mute persists**: click `#mute-button` → `page.evaluate(() => localStorage.getItem('blocky.muted'))` === '1'; reload → button shows 🔇.
2. **No crash without gesture**: `page.evaluate(() => window.__game.debug.sfx.collect())` before any click (expose `sfx` + `isMuted` on `window.__game.debug` in `src/main.js`) → no pageerror (the shared beforeEach trap enforces).
3. **Unlock wiring**: start a run via the start button, then `page.evaluate(() => window.__game.debug.audioState())` (expose `() => ctx?.state ?? 'none'`) → `'running'` in Chromium (Playwright Chromium allows autoplay after gesture; if it reports 'suspended' in CI, assert only `!== 'none'` and note it).
4. **Full playthrough silence-safety**: with mute ON, play an idle run to death → no pageerror.

**Verify**: `npm test` → all pass.

## Done criteria

- [ ] `grep -rn "new Audio\|\.mp3\|\.wav\|\.ogg" src/ index.html` → no matches (synth only)
- [ ] `grep -rn "localStorage" src/` → only `src/hiscores.js` and `src/audio.js`
- [ ] `npm run lint` / `npm test` exit 0 (incl. audio.spec.js)
- [ ] Manual: all five effects audible; mute persists across reload
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plan 008 not DONE (`startRun` missing).
- Sounds play distorted/clipped (gain stacking) — lower `vol` values; if artifacts persist across browsers, report with which effect.
- Any test requires real audio capture — that's out of scope; assert state only.

## Maintenance notes

- Background music (todo wishlist) would live in `src/audio.js` as a scheduled pattern loop — the `ctx`/mute plumbing here is ready for it; keep `sfx` envelope-style one-shots separate from any future music scheduler.
- The `blip` envelope is the house sound — new effects should be `blip` compositions first, custom nodes only if genuinely needed.
- iOS resumes the context only on a REAL user gesture — never call `unlockAudio()` from timers; `startRun()` and button handlers are the sanctioned sites.
