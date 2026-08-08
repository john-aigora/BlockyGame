import { test, expect } from '@playwright/test';
import { openGame, startGame, waitGameSeconds, installMockPads } from './helpers.js';

// Physical gamepad support (HTML Gamepad API). Playwright cannot inject a
// real controller, so the suite installs mock pads on navigator.getGamepads
// and drives axes/buttons through them (installMockPads in helpers.js).

test('left stick moves the player', async ({ page }) => {
  await openGame(page);
  await startGame(page);

  await installMockPads(page);
  // One poll with axes at rest so prev-button state is clean
  await page.evaluate(() => window.__game.debug.pollGamepad());

  const before = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    z: window.__game.state.player.position.z
  }));

  await page.evaluate(() => {
    window.__mockPad.setAxis(0.9, 0); // full right, above deadzone
  });
  // Stick is sampled inside keyboardVector during update — advance sim time
  await waitGameSeconds(page, 0.4);

  const after = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    z: window.__game.state.player.position.z,
    vec: window.__game.debug.gamepadVector()
  }));

  expect(after.vec.x).toBeGreaterThan(0.5);
  expect(after.x).toBeGreaterThan(before.x + 0.5);
  // No meaningful Z drift when only X is tilted
  expect(Math.abs(after.z - before.z)).toBeLessThan(0.35);
});

test('A button starts a run from the title screen', async ({ page }) => {
  await openGame(page);
  await expect(page.locator('#start-overlay')).toBeVisible();

  await installMockPads(page);
  // Rest frame first (no edge), then press A
  await page.evaluate(() => {
    window.__game.debug.pollGamepad();
    window.__mockPad.setButton(0, true);
    window.__game.debug.pollGamepad();
  });

  await expect(page.locator('#start-overlay')).toBeHidden();
  const active = await page.evaluate(() => window.__game.state.gameActive);
  expect(active).toBe(true);
});

test('Start button toggles pause mid-run', async ({ page }) => {
  await openGame(page);
  await startGame(page);
  await installMockPads(page);
  await page.evaluate(() => window.__game.debug.pollGamepad());

  await page.evaluate(() => {
    window.__mockPad.setButton(9, true); // Start
    window.__game.debug.pollGamepad();
  });
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(true);
  await expect(page.locator('#pause-button')).toHaveText('Resume');

  // Release then press again to resume
  await page.evaluate(() => {
    window.__mockPad.setButton(9, false);
    window.__game.debug.pollGamepad();
    window.__mockPad.setButton(9, true);
    window.__game.debug.pollGamepad();
  });
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(false);
});

// Fugu P1 guard: right stick (axes 2/3) must never drive movement on
// standard-mapping pads (Xbox / F310 X). Only left stick + D-pad buttons do.
test('right stick does not move the player on standard pads', async ({ page }) => {
  await openGame(page);
  await startGame(page);
  await installMockPads(page);
  await page.evaluate(() => window.__game.debug.pollGamepad());

  const before = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    z: window.__game.state.player.position.z
  }));

  await page.evaluate(() => {
    const pad = window.__mockPad.pad;
    pad.axes[2] = 0.95; // right stick X
    pad.axes[3] = 0.95; // right stick Y
    pad.timestamp = performance.now();
  });
  await waitGameSeconds(page, 0.4);

  const after = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    z: window.__game.state.player.position.z,
    vec: window.__game.debug.gamepadVector()
  }));

  expect(Math.abs(after.vec.x)).toBeLessThan(0.05);
  expect(Math.abs(after.vec.z)).toBeLessThan(0.05);
  expect(Math.abs(after.x - before.x)).toBeLessThan(0.2);
  expect(Math.abs(after.z - before.z)).toBeLessThan(0.2);
});

test('speedDown steps to a slower multiplier', async ({ page }) => {
  await openGame(page);
  await startGame(page);
  // Default index 0 = 1.0x; one step down → 0.5x
  const after = await page.evaluate(() => {
    const ok = window.__game.debug.speedDown();
    return {
      ok,
      mult: window.__game.state.actualPlayerSpeed,
      index: window.__game.state.currentSpeedMultiplierIndex
    };
  });
  expect(after.ok).toBe(true);
  // 0.5x of the device base (desktop 6.0 → 3.0)
  expect(after.mult).toBeCloseTo(3.0, 5);
});

// Logitech F310 in DirectInput (D switch): A is button 1, mapping is empty.
test('F310 DirectInput A button starts a run', async ({ page }) => {
  await openGame(page);
  await expect(page.locator('#start-overlay')).toBeVisible();

  await installMockPads(page, [{
    id: 'Logitech Logitech Dual Action (STANDARD GAMEPAD Vendor: 046d Product: c216)',
    mapping: '', // DirectInput / D-switch
    buttonCount: 12
  }]);
  await page.evaluate(() => {
    window.__game.debug.pollGamepad();
    window.__mockPad.setButton(1, true); // DI A (not 0)
    window.__game.debug.pollGamepad();
  });

  await expect(page.locator('#start-overlay')).toBeHidden();
});

// --- Dual-pad selection scenarios (plan 018) ---
// Modeled on the family's HuiJia dual DB9→USB adapter: ONE USB device exposing
// TWO HID interfaces with the SAME id string; the idle socket stays
// "connected" forever (a ghost pad). Digital sticks report ~±1 on axes 0/1.

const HUIJIA_ID = 'HuiJia USB GamePad (Vendor: 0e8f Product: 3013)';

test('dual-interface ghost first: the active DI pad wins the lock', async ({ page }) => {
  await openGame(page);
  await startGame(page);
  await installMockPads(page, [
    { id: HUIJIA_ID, mapping: '' }, // idle ghost socket, enumerates first
    { id: HUIJIA_ID, mapping: '' } // the socket the stick is plugged into
  ]);
  // Idle poll first: the ghost (slot 0) claims the fallback lock.
  await page.evaluate(() => window.__game.debug.pollGamepad());

  const before = await page.evaluate(() => window.__game.state.player.position.z);
  // Digital stick full-throw up: −1 on axis 1 (clears the 0.18 deadzone).
  await page.evaluate(() => window.__mockPads.setAxis(1, 0, -1));
  await waitGameSeconds(page, 0.4);

  const after = await page.evaluate(() => ({
    z: window.__game.state.player.position.z,
    vec: window.__game.debug.gamepadVector(),
    index: window.__game.debug.gamepadDebugInfo().index
  }));
  expect(after.vec.z).toBeLessThan(-0.5);
  expect(after.z).toBeLessThan(before - 0.5); // player moved −Z
  expect(after.index).toBe(1); // the live interface, not the ghost
});

test('idle standard pad does not outrank a live DirectInput stick', async ({ page }) => {
  await openGame(page);
  await startGame(page);
  await installMockPads(page, [
    { id: 'Xbox Wireless Controller', mapping: 'standard' }, // idle
    { id: HUIJIA_ID, mapping: '' } // DB9 stick held right
  ]);
  await page.evaluate(() => window.__game.debug.pollGamepad());

  const before = await page.evaluate(() => window.__game.state.player.position.x);
  await page.evaluate(() => window.__mockPads.setAxis(1, 1, 0));
  await waitGameSeconds(page, 0.4);

  const after = await page.evaluate(() => ({
    x: window.__game.state.player.position.x,
    vec: window.__game.debug.gamepadVector(),
    index: window.__game.debug.gamepadDebugInfo().index
  }));
  expect(after.vec.x).toBeGreaterThan(0.5);
  expect(after.x).toBeGreaterThan(before + 0.5); // movement follows the DI pad
  expect(after.index).toBe(1);
});

test('lock hands off from an idle pad to the pad producing input', async ({ page }) => {
  await openGame(page);
  await startGame(page);
  await installMockPads(page, [{ id: 'Pad A' }, { id: 'Pad B' }]);
  await page.evaluate(() => window.__game.debug.pollGamepad());

  // Pad A drives and claims the lock.
  await page.evaluate(() => window.__mockPads.setAxis(0, 0.9, 0));
  await waitGameSeconds(page, 0.3);
  expect(await page.evaluate(() => window.__game.debug.gamepadDebugInfo().index)).toBe(0);

  // A goes idle, B starts moving: B must drive within one poll.
  const after = await page.evaluate(() => {
    window.__mockPads.setAxis(0, 0, 0);
    window.__mockPads.setAxis(1, -0.9, 0);
    window.__game.debug.pollGamepad();
    return {
      vec: window.__game.debug.gamepadVector(),
      index: window.__game.debug.gamepadDebugInfo().index
    };
  });
  expect(after.index).toBe(1); // no permanent lock on A
  expect(after.vec.x).toBeLessThan(-0.5);
});

test('held button on a newly active pad does not fire a stale edge', async ({ page }) => {
  await openGame(page);
  await startGame(page);
  await installMockPads(page, [{ id: 'Pad A' }, { id: 'Pad B' }]);
  await page.evaluate(() => window.__game.debug.pollGamepad());

  // Start on pad A toggles pause on.
  await page.evaluate(() => {
    window.__mockPads.setButton(0, 9, true);
    window.__game.debug.pollGamepad();
  });
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(true);

  // Release on A.
  await page.evaluate(() => {
    window.__mockPads.setButton(0, 9, false);
    window.__game.debug.pollGamepad();
  });

  // B becomes active with Start ALREADY held: the hand-off poll seeds B's
  // edge state and must NOT toggle pause again (old shared-array bug: A's
  // released snapshot made B's held Start look like a fresh press).
  await page.evaluate(() => {
    window.__mockPads.setButton(1, 9, true);
    window.__game.debug.pollGamepad(); // hand-off: seed only
    window.__game.debug.pollGamepad(); // still held: no edge either
  });
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(true);

  // A genuine release→press on B still works after the seed.
  await page.evaluate(() => {
    window.__mockPads.setButton(1, 9, false);
    window.__game.debug.pollGamepad();
    window.__mockPads.setButton(1, 9, true);
    window.__game.debug.pollGamepad();
  });
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(false);
});
