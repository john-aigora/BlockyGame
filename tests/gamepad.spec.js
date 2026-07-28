import { test, expect } from '@playwright/test';
import { startGame, waitGameSeconds } from './helpers.js';

// Physical gamepad support (HTML Gamepad API). Playwright cannot inject a
// real controller, so the suite installs a standard-mapping mock pad on
// navigator.getGamepads and drives axes/buttons through it.

const installMockPad = () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const pad = {
    id: 'Mock Pad',
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons,
    timestamp: performance.now()
  };
  navigator.getGamepads = () => [pad];
  window.__mockPad = {
    pad,
    setAxis(x, y) {
      pad.axes[0] = x;
      pad.axes[1] = y;
      pad.timestamp = performance.now();
    },
    setButton(index, pressed) {
      const b = pad.buttons[index];
      b.pressed = pressed;
      b.value = pressed ? 1 : 0;
      pad.timestamp = performance.now();
    }
  };
  return true;
};

test('left stick moves the player in classic', async ({ page }) => {
  await page.goto('/');
  await startGame(page);

  await page.evaluate(installMockPad);
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
  await page.goto('/');
  await expect(page.locator('#start-overlay')).toBeVisible();

  await page.evaluate(installMockPad);
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
  await page.goto('/');
  await startGame(page);
  await page.evaluate(installMockPad);
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

// Logitech F310 in DirectInput (D switch): A is button 1, mapping is empty.
test('F310 DirectInput A button starts a run', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#start-overlay')).toBeVisible();

  await page.evaluate(() => {
    const buttons = Array.from({ length: 12 }, () => ({ pressed: false, value: 0 }));
    const pad = {
      id: 'Logitech Logitech Dual Action (STANDARD GAMEPAD Vendor: 046d Product: c216)',
      index: 0,
      connected: true,
      mapping: '', // DirectInput / D-switch
      axes: [0, 0, 0, 0],
      buttons,
      timestamp: performance.now()
    };
    navigator.getGamepads = () => [pad];
    window.__mockPad = {
      pad,
      setButton(index, pressed) {
        const b = pad.buttons[index];
        b.pressed = pressed;
        b.value = pressed ? 1 : 0;
      }
    };
    window.__game.debug.pollGamepad();
    window.__mockPad.setButton(1, true); // DI A (not 0)
    window.__game.debug.pollGamepad();
  });

  await expect(page.locator('#start-overlay')).toBeHidden();
});
