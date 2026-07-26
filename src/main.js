import './game.js';
import { state } from './state.js';

// Read-only debug/test handle; production code must never read it.
window.__game = { state };
