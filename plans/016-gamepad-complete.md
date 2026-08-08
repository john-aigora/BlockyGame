# Plan 016 — Gamepad-complete play (F310 + slow-down)

**Status:** DONE (expanded: classic retired + in-app gate)  
**Branch:** `feat/gamepad-complete`  
**Driver note:** Full Elves overnight orchestration is Claude Code / Codex only. This plan is Elves-shaped batches executed in-session.

## Intent

A full play session on the Logitech F310 (Mac **D** mode) without keyboard/mouse, plus a dedicated **slow down** control (not only a cycle that eventually hits 0.5x). Product is **endless-only**; classic arena UI retired. In-app password gate `blocky` (not Vercel).

## Acceptance

| ID | Criterion |
|---|---|
| B1-A1 | ~~Title: D-pad / stick left-right switches Classic ↔ Endless without starting~~ — superseded mid-plan by the classic retirement (see line 3) |
| B1-A2 | Title: face button starts; D-pad alone never starts |
| B2-A1 | `speedUp` / `speedDown` step along ordered multipliers; UI button still cycles |
| B2-A2 | Pad **Y** = faster, **X** = slower; keyboard **R** = slower (F still cycles) |
| B3-A1 | **LB/RB** zoom out/in; **Select/Back** toggles mute (Start remains pause) |
| B3-A2 | **Start+Select** together restarts mid-run |
| B4-A1 | Stick ease-in curve after deadzone; right stick never moves player |
| B4-A2 | Optional light rumble on collect / kill / death when actuator exists |
| B5-A1 | Pad HUD shows live binds; `?paddebug=1` shows axes/buttons |
| B5-A2 | ~~First pad wake on title this session prefers Endless once~~ — superseded mid-plan by the classic retirement (see line 3) |
| B6-A1 | Playwright covers speedDown, ~~title mode toggle via mock pad~~ (superseded mid-plan by the classic retirement — see line 3), right-stick isolation |

## Batches

1. **Speed up/down API + UI labels**
2. **Title mode on pad + auto-Endless on first wake**
3. **Shoulders / mute / restart combo + keyboard R**
4. **Stick curve + rumble hooks**
5. **HUD / paddebug + tests + readme**

## Non-goals

- Full bind remapping UI
- Co-op / second player
- Logitech Profiler dependency
- Changing default speed ladder order (keeps index 0 = 1.0x for existing tests)

## Risk

`standard` — input-only; no world sim changes. Manual F310 check on Mac D after land.
