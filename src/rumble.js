// Gamepad vibration — isolated so audio/UI/enemies can pulse without
// importing input.js (avoids game ↔ input ↔ ui cycles).

function activePad() {
    const list = navigator.getGamepads ? navigator.getGamepads() : null;
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].connected) return list[i];
    }
    return null;
}

// Seat routing (plan 026): input.js injects a resolver (seat → its claimed
// Gamepad) at setup — injection keeps this module import-cycle-free. A call
// with a seat rumbles THAT seat's pad; no resolver / no claim falls back to
// the first connected pad (the exact solo behavior — solo never claims).
let seatPadResolver = null;

export function setSeatPadResolver(fn) {
    seatPadResolver = fn;
}

// Light haptic pulse when the pad exposes a vibration actuator (many F310s no-op).
export function rumble(durationMs = 40, mag = 0.35, seat = null) {
    let gp = null;
    if (seat != null && seatPadResolver) gp = seatPadResolver(seat);
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
