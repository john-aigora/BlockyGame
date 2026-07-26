import './game.js';
import { state } from './state.js';
import { spawnNearPlayer, spawnAtPosition } from './collectibles.js';

// Read-only debug/test handle; production code must never read it.
// `debug` exposes spawners for the Playwright suites (world/resources specs).
window.__game = { state, debug: { spawnNearPlayer, spawnAtPosition } };
