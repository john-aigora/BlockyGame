import { worldSize, worldBoundary } from './constants.js';

// --- Toroidal World Math ---
// The world wraps at ±worldBoundary on X/Z. ALL distance/direction logic
// between world entities must go through these helpers — raw subVectors /
// distanceTo on world positions is the bug class plan 005 eliminated
// (fine for screen/camera math). Pure functions: unit-testable without a
// three.js scene.

// Maps any value into [-worldBoundary, worldBoundary), preserving overshoot.
export function wrapCoord(v) {
    return ((v + worldBoundary) % worldSize + worldSize) % worldSize - worldBoundary;
}

// Wraps a Vector3-like {x,z} in place (mutates and returns it).
export function wrapPosition(pos) {
    pos.x = wrapCoord(pos.x);
    pos.z = wrapCoord(pos.z);
    return pos;
}

// Shortest signed delta from→to along one axis, across the wrap.
export function torusDeltaComponent(from, to) {
    let d = to - from;
    if (d > worldBoundary) d -= worldSize;
    else if (d < -worldBoundary) d += worldSize;
    return d;
}

// Shortest XZ vector from→to across the wrap; writes into `out` (THREE.Vector3).
export function torusDelta(fromPos, toPos, out) {
    out.set(torusDeltaComponent(fromPos.x, toPos.x), 0, torusDeltaComponent(fromPos.z, toPos.z));
    return out;
}

// Shortest XZ distance between two world positions across the wrap.
export function torusDistance(a, b) {
    const dx = torusDeltaComponent(a.x, b.x), dz = torusDeltaComponent(a.z, b.z);
    return Math.hypot(dx, dz);
}
