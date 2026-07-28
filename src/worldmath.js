import { worldSize, worldBoundary } from './constants.js';
import { state } from './state.js';

// --- World Math (mode-aware) ---
// CLASSIC: the world wraps at ±worldBoundary on X/Z (torus). ALL distance/
// direction logic between world entities must go through these helpers —
// raw subVectors / distanceTo on world positions is the bug class plan 005
// eliminated (fine for screen/camera math).
// ENDLESS: the world is a flat infinite plane — wrapping is identity and
// deltas are plain Euclidean. This module is the ONE dispatch point: every
// AI/spawn/effect distance works in both modes because it routes through
// here. Signatures are identical in both modes.

// Maps any value into [-worldBoundary, worldBoundary), preserving overshoot.
// Endless: identity — there is no boundary to wrap at.
export function wrapCoord(v) {
    if (state.worldMode === 'endless') return v;
    return ((v + worldBoundary) % worldSize + worldSize) % worldSize - worldBoundary;
}

// Wraps a Vector3-like {x,z} in place (mutates and returns it).
export function wrapPosition(pos) {
    pos.x = wrapCoord(pos.x);
    pos.z = wrapCoord(pos.z);
    return pos;
}

// Shortest signed delta from→to along one axis (across the wrap in classic;
// plain subtraction in endless).
export function torusDeltaComponent(from, to) {
    let d = to - from;
    if (state.worldMode === 'endless') return d;
    if (d > worldBoundary) d -= worldSize;
    else if (d < -worldBoundary) d += worldSize;
    return d;
}

// Shortest XZ vector from→to; writes into `out` (THREE.Vector3).
export function torusDelta(fromPos, toPos, out) {
    out.set(torusDeltaComponent(fromPos.x, toPos.x), 0, torusDeltaComponent(fromPos.z, toPos.z));
    return out;
}

// Shortest XZ distance between two world positions.
export function torusDistance(a, b) {
    const dx = torusDeltaComponent(a.x, b.x), dz = torusDeltaComponent(a.z, b.z);
    return Math.hypot(dx, dz);
}
