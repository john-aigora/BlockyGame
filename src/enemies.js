import * as THREE from 'three';
import {
    enemyBaseHeight, worldBoundary, engagementRadius, orbitStrengthFactor,
    enemyRandomDriftFactor, AVOID_SPEED_FACTOR, BASE_ENEMY_SPAWN_DISTANCE, SPAWN_DISTANCE_SCALE_FACTOR,
    KILL_POINTS, MAX_ENEMIES, ENEMIES_PER_KILL, ENEMY_HEIGHT_FACTOR
} from './constants.js';
import { state } from './state.js';
import { createCharacter, disposeCharacter } from './characters.js';
import { spawnAtPosition } from './collectibles.js';
import { endGame, updateScoreDisplay } from './ui.js';
import { wrapPosition, torusDelta, torusDistance } from './worldmath.js';
import { sfx } from './audio.js';

// Module-level scratch vectors — reused every frame to avoid per-frame allocation.
const tmpVec = new THREE.Vector3();
const avoidVec = new THREE.Vector3();
const awayVec = new THREE.Vector3();

// Module-level scratch AABBs — the ONLY Box3 instances in the codebase
// (plan 007). playerBox is refreshed once per collision section; scratchBox
// is reused for every enemy/collectible test. game.js imports both.
export const playerBox = new THREE.Box3();
export const scratchBox = new THREE.Box3();

export function createEnemy() {
    // perInstanceBodyMaterial: each enemy's body color flips independently
    // between killable-yellow and blue, so the material cannot be shared.
    const enemyGroup = createCharacter({ baseSize: enemyBaseHeight, bodyColor: 0x03A9F4, faceColor: 0x222222, perInstanceBodyMaterial: true }); // Electric Blue body, dark grey face

    // --- Enemy AI Properties ---
    enemyGroup.randomVelocity = new THREE.Vector3(0, 0, 0);
    enemyGroup.timeToChangeRandomVelocity = Math.random() * 2 + 1;
    enemyGroup.orbitDirection = Math.random() < 0.5 ? 1 : -1;

    state.scene.add(enemyGroup);
    state.enemies.push(enemyGroup);
    return enemyGroup;
}

// Player can kill if player is TALLER than the enemy
export function canKillSpecificEnemy(enemyGroup) {
    const playerActualHeight = state.playerScale * 1.0; // Player geometry base height is 1
    // enemyGroup.scale.y refers to the scale of the whole group.
    // The previous logic was: playerActualHeight > enemy.scale.y * enemyBaseHeight.
    // This refers to the enemy's main cube height. Let's stick to that for now for consistency in gameplay feel,
    // comparing player height against the scaled height of the enemy's main body part.
    const enemyScaledBodyHeight = enemyBaseHeight * enemyGroup.scale.y;
    return playerActualHeight > enemyScaledBodyHeight;
}

// --- Enemy Update (called every frame from update()) ---
// Handles enemy coloring, AI movement (flee/chase/orbit + random drift),
// avoidance, world wrapping, and collision with the player.
// All distances/directions between world entities are torus-aware
// (src/worldmath.js) so AI takes the short way across the wrap seam.
// dt is the frame delta in seconds; all speeds are units/second.
// Iterates backwards so killEnemy's splice never skips the next enemy;
// enemies appended mid-frame by spawnNewEnemies() get indexes above the
// cursor and intentionally act on the NEXT frame (same as the old forEach).
export function updateEnemies(dt) {
    // Refresh the player's AABB ONCE for this whole collision pass —
    // setFromObject traverses all child meshes and is too heavy per enemy.
    playerBox.setFromObject(state.player);
    for (let i = state.enemies.length - 1; i >= 0; i--) {
        const enemyGroup = state.enemies[i];
        const bodyMesh = enemyGroup.getObjectByName('body'); // Get the body mesh

        if (canKillSpecificEnemy(enemyGroup)) {
            if (bodyMesh) bodyMesh.material.color.setHex(0xFFEB3B); // Bright Yellow if killable
        } else {
            if (bodyMesh) bodyMesh.material.color.setHex(0x03A9F4); // Electric Blue otherwise
        }

        // --- Enemy AI: Movement Logic ---
        const distanceToPlayer = torusDistance(enemyGroup.position, state.player.position);
        let combinedMovement = new THREE.Vector3();

        // --- Random Movement Component (calculated for all states) ---
        enemyGroup.timeToChangeRandomVelocity -= dt;
        if (enemyGroup.timeToChangeRandomVelocity <= 0) {
            const randomStrength = state.actualEnemySpeed * enemyRandomDriftFactor;
            enemyGroup.randomVelocity.set(
                (Math.random() - 0.5) * 2 * randomStrength,
                0,
                (Math.random() - 0.5) * 2 * randomStrength
            );
            enemyGroup.timeToChangeRandomVelocity = Math.random() * 2 + 1;
        }

        if (canKillSpecificEnemy(enemyGroup)) {
            // --- Fleeing Behavior ---
            if (distanceToPlayer > 0) { // Avoid issues if somehow at the exact same spot
                // Flee = the shortest-path direction to the player, negated
                const fleeDirection = torusDelta(enemyGroup.position, state.player.position, tmpVec).normalize().negate();
                combinedMovement.copy(fleeDirection).multiplyScalar(state.actualEnemySpeed);
            }
        } else {
            // --- Normal Chase and Orbit Logic ---
            const chaseDirection = torusDelta(enemyGroup.position, state.player.position, tmpVec).normalize();
            if (distanceToPlayer < engagementRadius) {
                // --- Orbiting Behavior ---
                const orbitVector = new THREE.Vector3(-chaseDirection.z * enemyGroup.orbitDirection, 0, chaseDirection.x * enemyGroup.orbitDirection);
                const chaseComponent = chaseDirection.clone().multiplyScalar(1.0 - orbitStrengthFactor);
                const orbitComponent = orbitVector.normalize().multiplyScalar(orbitStrengthFactor);
                combinedMovement.add(chaseComponent).add(orbitComponent).normalize().multiplyScalar(state.actualEnemySpeed);
            } else {
                // --- Pure Chase Behavior (outside engagement radius) ---
                combinedMovement.copy(chaseDirection).multiplyScalar(state.actualEnemySpeed);
            }
        }

        // Add random drift to the calculated movement (applies to both flee and chase/orbit)
        combinedMovement.add(enemyGroup.randomVelocity);

        // Separation is a pre-cap steering component (NOT a post-movement
        // position shove — that caused the two-enemy jitter, plan 005).
        computeAvoidance(enemyGroup, avoidVec);
        if (avoidVec.lengthSq() > 0) {
            combinedMovement.addScaledVector(avoidVec.normalize(), state.actualEnemySpeed * AVOID_SPEED_FACTOR);
        }

        // Cap total speed; the 1.25 headroom lets separation win slightly
        // over chase without runaway speed.
        const maxSpeed = state.actualEnemySpeed * 1.25;
        if (combinedMovement.length() > maxSpeed) {
            combinedMovement.normalize().multiplyScalar(maxSpeed);
        }

        enemyGroup.position.addScaledVector(combinedMovement, dt);

        // Enemy Wrapping Logic (preserves overshoot across the seam)
        wrapPosition(enemyGroup.position);

        // --- Collision Detection (with player) ---
        scratchBox.setFromObject(enemyGroup); // enemyGroup is now the object
        if (playerBox.intersectsBox(scratchBox)) {
            if (canKillSpecificEnemy(enemyGroup)) {
                killEnemy(enemyGroup, i); // splice(i, 1) — safe going backwards
                continue;
            } else {
                endGame('The enemy caught you.');
                return; // NOW actually exits the enemy update
            }
        }
    }
}

// Removes a killed enemy and pays out its rewards: the flat KILL_POINTS
// bounty, 4 food particles at the death position, plus (up to) two new,
// larger enemies. The single kill path — future kill causes must call this too.
export function killEnemy(enemyGroup, index) {
    const enemyDeathPosition = enemyGroup.position.clone(); // Get position before removing

    state.scene.remove(enemyGroup);
    disposeCharacter(enemyGroup); // Release the per-instance body material
    state.enemies.splice(index, 1);
    sfx.kill();

    // Kill bounty (plan 011): hunting must beat pacifism — the README's
    // "strategically defeating enemies" promise, now actually paid.
    state.score += KILL_POINTS;
    updateScoreDisplay();

    // Spawn 4 food particles
    for (let i = 0; i < 4; i++) {
        spawnAtPosition(enemyDeathPosition);
    }

    spawnNewEnemies();
}

export function spawnNewEnemies() {
    // Population cap (plan 011): only spawn into free slots under
    // MAX_ENEMIES. Zero is valid — a full horde means the kill still paid
    // points and food, which is the difficulty curve's relief valve.
    const slots = Math.max(0, MAX_ENEMIES - state.enemies.length);
    const count = Math.min(ENEMIES_PER_KILL, slots);
    if (count === 0) return;

    const currentPlayerActualHeight = state.playerScale * 1.0;
    const newEnemyTargetHeight = currentPlayerActualHeight * ENEMY_HEIGHT_FACTOR;
    const newEnemyScaleFactor = newEnemyTargetHeight / enemyBaseHeight;

    // Calculate dynamic spawn distance based on playerScale, capped so spawns
    // always land inside the world even for a huge player (plan 005).
    const spawnDistance = Math.min(
        BASE_ENEMY_SPAWN_DISTANCE + (state.playerScale * SPAWN_DISTANCE_SCALE_FACTOR),
        worldBoundary * 0.8
    );
    console.log(`Player scale: ${state.playerScale}, New enemy spawn distance: ${spawnDistance}`); // For debugging

    // First enemy at a random angle; second on the opposite side (angle1 + PI)
    // with a random deviation of +/- 45 degrees (PI/4 radians).
    const angle1 = Math.random() * Math.PI * 2;
    for (let n = 0; n < count; n++) {
        const angle = n === 0
            ? angle1
            : angle1 + Math.PI + (Math.random() - 0.5) * (Math.PI / 2);
        const enemy = createEnemy();
        enemy.scale.set(newEnemyScaleFactor, newEnemyScaleFactor, newEnemyScaleFactor);
        enemy.position.y = 0;
        enemy.position.x = state.player.position.x + Math.cos(angle) * spawnDistance;
        enemy.position.z = state.player.position.z + Math.sin(angle) * spawnDistance;
        wrapPosition(enemy.position); // A capped distance can still cross the seam near an edge
    }
}

// Sums the normalized (torus-aware) away-directions from every neighbor
// within the avoid radius into `out`. The caller scales the result into a
// steering component before the speed cap.
function computeAvoidance(enemyGroup, out) {
    const avoidRadius = 7;
    out.set(0, 0, 0);
    state.enemies.forEach((otherEnemyGroup) => {
        if (otherEnemyGroup !== enemyGroup) {
            const distance = torusDistance(enemyGroup.position, otherEnemyGroup.position);
            if (distance > 0 && distance < avoidRadius) {
                // Direction away from the other enemy, across the seam if shorter
                torusDelta(otherEnemyGroup.position, enemyGroup.position, awayVec).normalize();
                out.add(awayVec);
            }
        }
    });
    return out;
}
