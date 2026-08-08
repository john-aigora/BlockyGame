import { test, expect } from '@playwright/test';

// In-app gate password (src/gate.js). Tests skip the form via sessionStorage.
export const GATE_PASSWORD = 'blocky';

// Call before page.goto so the gate never blocks module load.
export async function bypassGate(page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem('blocky.gate.unlocked', '1'); } catch { /* */ }
  });
}

export async function unlockGate(page) {
  const gated = await page.locator('#gate-overlay').isVisible().catch(() => false);
  if (!gated) return;
  await page.locator('#gate-password').fill(GATE_PASSWORD);
  await page.locator('#gate-form').evaluate((form) => form.requestSubmit());
  await expect(page.locator('#gate-overlay')).toBeHidden({ timeout: 10000 });
  await page.waitForFunction(() => window.__game && window.__game.state, null, { timeout: 15000 });
}

// Default entry: unlock + load + wait until the game is alive.
export async function openGame(page) {
  await bypassGate(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.state?.enemies?.length >= 1, null, { timeout: 30000 });
}

// Shared game-start helper (plan 008). The game boots into the start
// overlay; every spec that needs a running game goes through the real
// entry point — the overlay's START button — never the pause button.
export async function startGame(page) {
  // If the suite only did page.goto without bypass, unlock interactively.
  await unlockGate(page);
  if (!(await page.evaluate(() => !!window.__game?.state).catch(() => false))) {
    await page.waitForFunction(() => window.__game?.state, null, { timeout: 15000 });
  }
  await page.locator('#start-button').click();
  await expect(page.locator('#start-overlay')).toBeHidden();
}

// Classic torus for wrap/AI suites (product UI no longer exposes it).
export async function forceClassic(page) {
  await page.evaluate(() => window.__game.debug.forceWorldMode('classic'));
  await expect.poll(async () => page.evaluate(() => window.__game.state.worldMode)).toBe('classic');
}

// Plays an idle run out to the death screen (collect-clock expiry or enemy
// contact). The collect clock needs 15 GAME seconds — but game time is not
// wall time: under parallel-suite load, headless software rendering drops
// below 20fps and the MAX_DELTA=0.05 frame clamp (src/game.js) dilates game
// time to a fraction of wall time, so 15 game seconds can cost 40+ wall
// seconds. The wait is condition-based — green runs still finish the moment
// the death screen appears (~16s); the large ceilings only buy headroom
// when the machine is saturated.
export async function waitForGameOver(page) {
  test.setTimeout(150000);
  await expect(page.locator('#message-box')).toBeVisible({ timeout: 120000 });
}

// Installs mock gamepads on navigator.getGamepads (Playwright cannot inject
// real controllers). Extracted from tests/gamepad.spec.js and extended to
// MULTIPLE pads for the dual-port DB9-adapter scenarios (plan 018).
// Each descriptor may set: id, index, mapping, connected, axes, buttonCount.
// Exposes window.__mockPads (setAxis/setButton take the pad slot first) plus
// window.__mockPad, the slot-0 alias the original single-pad specs use.
export async function installMockPads(page, pads = [{}]) {
  await page.evaluate((specs) => {
    const list = specs.map((spec, slot) => ({
      id: spec.id ?? 'Mock Pad',
      index: spec.index ?? slot,
      connected: spec.connected ?? true,
      mapping: spec.mapping ?? 'standard',
      axes: (spec.axes ?? [0, 0, 0, 0]).slice(),
      buttons: Array.from({ length: spec.buttonCount ?? 16 }, () => ({ pressed: false, value: 0 })),
      timestamp: performance.now()
    }));
    navigator.getGamepads = () => list;
    const api = {
      pads: list,
      setAxis(slot, x, y) {
        const pad = list[slot];
        pad.axes[0] = x;
        pad.axes[1] = y;
        pad.timestamp = performance.now();
      },
      setButton(slot, index, pressed) {
        const pad = list[slot];
        const b = pad.buttons[index];
        b.pressed = pressed;
        b.value = pressed ? 1 : 0;
        pad.timestamp = performance.now();
      }
    };
    window.__mockPads = api;
    window.__mockPad = {
      pad: list[0],
      setAxis: (x, y) => api.setAxis(0, x, y),
      setButton: (index, pressed) => api.setButton(0, index, pressed)
    };
  }, pads);
}

// Waits until the simulation advances `seconds` more GAME-clock seconds
// (state.runTime is dt-accumulated in update()). Use this — never a
// wall-clock waitForTimeout — before asserting on anything the game clock
// drives; the generous wall ceiling exists only for load headroom.
export async function waitGameSeconds(page, seconds) {
  const start = await page.evaluate(() => window.__game.state.runTime);
  await page.waitForFunction(
    ([t0, s]) => window.__game.state.runTime >= t0 + s,
    [start, seconds],
    { timeout: 60000 }
  );
}
