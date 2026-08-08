// Gamepad vibration — isolated so audio/UI/enemies can pulse without
// importing input.js (avoids game ↔ input ↔ ui cycles). state.js is a
// leaf (no rumble import), so the coop-length check is cycle-safe.

import { state } from './state.js';

function activePad() {
    const list = navigator.getGamepads ? navigator.getGamepads() : null;
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].connected) return list[i];
    }
    return null;
}

// Seat routing (plan 026): input.js injects a resolver (seat → its claimed
// Gamepad) at setup — injection keeps this module free of an input import.
// 2P: only the claimed pad for that seat rumbles; unclaimed → silence (a
// keyboard P1 must never buzz P2's stick). Solo: fall back to the first
// connected pad when the seat has no claim (solo never claims seats).
let seatPadResolver = null;

export function setSeatPadResolver(fn) {
    seatPadResolver = fn;
}

// Light haptic pulse when the pad exposes a vibration actuator (many F310s no-op).
export function rumble(durationMs = 40, mag = 0.35, seat = null) {
    let gp = null;
    if (seat != null && seatPadResolver) {
        gp = seatPadResolver(seat);
        // Coop unclaimed seat: no fall-through to the other player's pad.
        if (!gp && state.players.length >= 2) return;
    }
    if (!gp) gp = activePad();
    const actuator = gp && (gp.vibrationActuator || gp.hapticActuators?.[0]);
    if (!actuator || typeof actuator.playEffect !== 'function') return;
    try {
        actuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration: durationMs,
            weakMagnitude: mag,
            strongMagnitude: Math.min(1, mag * 1.1)
        });
    } catch { /* unsupported shape */ }
}
