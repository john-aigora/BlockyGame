import { test, expect } from '@playwright/test';
import { openGame, startGame, waitGameSeconds, installMockPads, pressEdge } from './helpers.js';

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

// --- Bind sweep (plan 027 Step 5c) ---
// Every bind documented in src/input.js's header comment has a spec:
//   stick move        → 'left stick moves the player'
//   D-pad move        → 'D-pad buttons move the player' (below)
//   A jump            → 'A jumps mid-run' (below; title A = the start tests above)
//   B pause           → 'B pauses mid-run' (below)
//   Start pause       → 'Start button toggles pause mid-run'
//   Select mute       → 'Select mutes' (below)
//   Y faster/X slower → 'Y steps faster, X steps slower' (below)
//   LB/RB zoom        → 'LB zooms out, RB zooms in' (below)
//   Start+Select      → 'the Start+Select chord restarts' (below)
//   Title: face start → 'A button starts a run from the title screen' (+ F310 DI)

// Shared prologue: run started, mock pad installed, one rest poll so the
// pad's edge state is seeded (a fresh pad's first poll never fires).
async function padReady(page) {
  await openGame(page);
  await startGame(page);
  await installMockPads(page);
  await page.evaluate(() => window.__game.debug.pollGamepad());
}

// pressEdge (press → poll → release → poll) now lives in helpers.js
// (plan 031) — same behavior, plus a pad-slot arg for dual-pad scenarios.

test('D-pad buttons move the player (standard mapping 12-15)', async ({ page }) => {
  await padReady(page);
  const before = await page.evaluate(() => ({
    z: window.__game.state.player.position.z,
    x: window.__game.state.player.position.x
  }));
  await page.evaluate(() => window.__mockPad.setButton(12, true)); // D-pad up
  await waitGameSeconds(page, 0.4);
  const after = await page.evaluate(() => ({
    z: window.__game.state.player.position.z,
    x: window.__game.state.player.position.x,
    vec: window.__game.debug.gamepadVector()
  }));
  await page.evaluate(() => window.__mockPad.setButton(12, false));
  expect(after.vec.z).toBe(-1); // Digital up = full-throw north
  expect(after.z).toBeLessThan(before.z - 0.5); // The player really walked north
  expect(Math.abs(after.x - before.x)).toBeLessThan(0.35);
});

test('A jumps mid-run (endless)', async ({ page }) => {
  await padReady(page);
  await pressEdge(page, 0); // Standard A
  const jump = await page.evaluate(() => ({
    airborne: window.__game.state.players[0].jump.airborne,
    paused: window.__game.state.isPaused
  }));
  expect(jump.airborne).toBe(true); // A launched the hop...
  expect(jump.paused).toBe(false); // ...and did not pause (that is B/Start)
});

test('B pauses mid-run, and again to resume', async ({ page }) => {
  await padReady(page);
  await pressEdge(page, 1); // Standard B
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(true);
  await expect(page.locator('#pause-button')).toHaveText('Resume');
  await pressEdge(page, 1);
  expect(await page.evaluate(() => window.__game.state.isPaused)).toBe(false);
});

test('Select mutes through the real mute path (aria + persistence included)', async ({ page }) => {
  await padReady(page);
  expect(await page.evaluate(() => window.__game.debug.isMuted())).toBe(false);
  await pressEdge(page, 8); // Standard Select/Back
  expect(await page.evaluate(() => window.__game.debug.isMuted())).toBe(true);
  // Same path as the mute button: label + aria + stored flag all flip.
  await expect(page.locator('#mute-button')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('blocky.muted'))).toBe('1');
  await pressEdge(page, 8); // And back
  expect(await page.evaluate(() => window.__game.debug.isMuted())).toBe(false);
});

test('Y steps the speed faster, X steps it slower', async ({ page }) => {
  await padReady(page);
  const base = await page.evaluate(() => window.__game.state.actualPlayerSpeed);
  await pressEdge(page, 3); // Y: 1.0x → 1.5x (the next ladder rung)
  const faster = await page.evaluate(() => window.__game.state.actualPlayerSpeed);
  expect(faster).toBeCloseTo(base * 1.5, 5);
  await pressEdge(page, 2); // X: back down to 1.0x
  const slower = await page.evaluate(() => window.__game.state.actualPlayerSpeed);
  expect(slower).toBeCloseTo(base, 5);
});

test('LB zooms out, RB zooms in (one ZOOM_STEP each)', async ({ page }) => {
  await padReady(page);
  expect(await page.evaluate(() => window.__game.state.zoomLevel)).toBe(1);
  await pressEdge(page, 4); // LB
  expect(await page.evaluate(() => window.__game.state.zoomLevel)).toBeCloseTo(1.25, 9);
  await pressEdge(page, 5); // RB
  expect(await page.evaluate(() => window.__game.state.zoomLevel)).toBeCloseTo(1, 9);
});

test('the Start+Select chord restarts the run to the start overlay', async ({ page }) => {
  await padReady(page);
  await page.evaluate(() => {
    window.__mockPad.setButton(9, true); // Start and Select land in the SAME poll —
    window.__mockPad.setButton(8, true); // the chord takes priority over both single binds
    window.__game.debug.pollGamepad();
  });
  await expect(page.locator('#start-overlay')).toBeVisible();
  const s = await page.evaluate(() => ({
    onStartScreen: window.__game.state.onStartScreen,
    score: window.__game.state.score,
    muted: window.__game.debug.isMuted()
  }));
  expect(s.onStartScreen).toBe(true); // A fresh session...
  expect(s.score).toBe(0);
  expect(s.muted).toBe(false); // ...and the Select half never fired its single bind
});

// --- Rumble call sites (plan 027 Step 5b) ---
test('rumble: kill and death both playEffect on the pad — and mute does not gate it', async ({ page }) => {
  await openGame(page);
  await startGame(page);
  await installMockPads(page);
  await page.evaluate(() => {
    // Spy actuator: rumble() feature-detects playEffect on the active pad.
    const calls = [];
    window.__rumbleCalls = calls;
    window.__mockPad.pad.vibrationActuator = {
      playEffect: (type, params) => {
        calls.push({ type, duration: params.duration });
        return Promise.resolve('complete');
      }
    };
  });
  // Mute FIRST: rumble deliberately ignores mute today (it is haptics, not
  // audio — plan 027 says assert the CURRENT behavior; flip this assert if
  // that policy ever changes deliberately).
  await page.locator('#mute-button').click();
  expect(await page.evaluate(() => window.__game.debug.isMuted())).toBe(true);

  // Deterministic kill (the balance exactness choreography): airborne over
  // a fixed grunt, one stepped contact.
  const afterKill = await page.evaluate(() => {
    const g = window.__game;
    const s = g.state;
    s.enemies.forEach((e) => s.scene.remove(e));
    s.enemies = [];
    g.debug.clearPendingSpawns();
    s.players.forEach((p) => { p.collectTimeLeft = 900; });
    s.playerScale = 3;
    s.player.scale.set(3, 3, 3);
    const p0 = s.players[0];
    p0.jump.airborne = true;
    p0.jump.offset = 2.5;
    p0.jump.velocity = 0;
    p0.jump.gravity = 45;
    g.debug.spawnSpecies('grunt', s.player.position.x, s.player.position.z, 2);
    g.debug.advance(3 / 60);
    return { combo: s.comboCount, calls: window.__rumbleCalls.slice() };
  });
  expect(afterKill.combo).toBe(1); // The kill really landed
  expect(afterKill.calls.some((c) => c.duration === 55)).toBe(true); // The kill kick — while muted
  expect(afterKill.calls.every((c) => c.type === 'dual-rumble')).toBe(true);

  // Death: the collect clock expires; the death pulse is the long 180ms one.
  const afterDeath = await page.evaluate(() => {
    const s = window.__game.state;
    s.players.forEach((p) => { p.collectTimeLeft = 0.05; });
    window.__game.debug.advance(0.2);
    return { gameActive: s.gameActive, calls: window.__rumbleCalls.slice() };
  });
  expect(afterDeath.gameActive).toBe(false);
  expect(afterDeath.calls.some((c) => c.duration === 180)).toBe(true); // The death pulse — still muted
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
