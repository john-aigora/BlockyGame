import * as THREE from 'three';
import {
    enemyBaseHeight, worldBoundary, engagementRadius, orbitStrengthFactor,
    enemyRandomDriftFactor, AVOID_FORCE, BASE_ENEMY_SPAWN_DISTANCE, SPAWN_DISTANCE_SCALE_FACTOR
} from './constants.js';
import { state } from './state.js';
import { createCharacter } from './characters.js';
import { spawnAtPosition } from './collectibles.js';
import { showMessage } from './ui.js';

export function createEnemy() {
    const enemyGroup = createCharacter({ baseSize: enemyBaseHeight, bodyColor: 0x03A9F4, faceColor: 0x222222 }); // Electric Blue body, dark grey face

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
// dt is the frame delta in seconds; all speeds are units/second.
export function updateEnemies(dt) {
    state.enemies.forEach((enemyGroup, index) => {
        const bodyMesh = enemyGroup.getObjectByName('body'); // Get the body mesh

        if (canKillSpecificEnemy(enemyGroup)) {
            if (bodyMesh) bodyMesh.material.color.setHex(0xFFEB3B); // Bright Yellow if killable
        } else {
            if (bodyMesh) bodyMesh.material.color.setHex(0x03A9F4); // Electric Blue otherwise
        }

        // --- Enemy AI: Movement Logic ---
        const distanceToPlayer = state.player.position.distanceTo(enemyGroup.position);
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
                const fleeDirection = new THREE.Vector3().subVectors(enemyGroup.position, state.player.position).normalize();
                combinedMovement.copy(fleeDirection).multiplyScalar(state.actualEnemySpeed);
            }
        } else {
            // --- Normal Chase and Orbit Logic ---
            const chaseDirection = new THREE.Vector3().subVectors(state.player.position, enemyGroup.position).normalize();
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
        // Ensure total speed doesn't exceed actualEnemySpeed due to drift, by re-normalizing if drift was added to a full-speed vector
        if (combinedMovement.length() > state.actualEnemySpeed) {
            combinedMovement.normalize().multiplyScalar(state.actualEnemySpeed);
        }

        enemyGroup.position.addScaledVector(combinedMovement, dt);

        // Apply avoidance after all other movement calculations for this frame
        avoidOtherEnemies(enemyGroup, index, dt);

        // Enemy Wrapping Logic
        if (enemyGroup.position.x > worldBoundary) enemyGroup.position.x = -worldBoundary + 0.1; // Add small offset to prevent immediate re-wrap issues
        if (enemyGroup.position.x < -worldBoundary) enemyGroup.position.x = worldBoundary - 0.1;
        if (enemyGroup.position.z > worldBoundary) enemyGroup.position.z = -worldBoundary + 0.1;
        if (enemyGroup.position.z < -worldBoundary) enemyGroup.position.z = worldBoundary - 0.1;

        // --- Collision Detection (with player) ---
        const playerBox = new THREE.Box3().setFromObject(state.player);
        const enemyBox = new THREE.Box3().setFromObject(enemyGroup); // enemyGroup is now the object
        if (playerBox.intersectsBox(enemyBox)) {
            if (canKillSpecificEnemy(enemyGroup)) {
                const enemyDeathPosition = enemyGroup.position.clone(); // Get position before removing

                state.scene.remove(enemyGroup);
                state.enemies.splice(index, 1);

                // Spawn 4 food particles
                for (let i = 0; i < 4; i++) {
                    spawnAtPosition(enemyDeathPosition);
                }

                spawnNewEnemies();
            } else {
                state.gameActive = false;
                showMessage(`GAME OVER! The enemy caught you. Final Score: ${state.score}`);
                return; // Exit forEach loop and update function if game over
            }
        }
    });
}

export function spawnNewEnemies() {
    const currentPlayerActualHeight = state.playerScale * 1.0;
    const newEnemyTargetHeight = currentPlayerActualHeight * 1.5;
    const newEnemyScaleFactor = newEnemyTargetHeight / enemyBaseHeight;

    // Calculate dynamic spawn distance based on playerScale
    const spawnDistance = BASE_ENEMY_SPAWN_DISTANCE + (state.playerScale * SPAWN_DISTANCE_SCALE_FACTOR);
    console.log(`Player scale: ${state.playerScale}, New enemy spawn distance: ${spawnDistance}`); // For debugging

    // Spawn first enemy at a random angle
    const enemy1 = createEnemy();
    enemy1.scale.set(newEnemyScaleFactor, newEnemyScaleFactor, newEnemyScaleFactor);
    enemy1.position.y = 0;
    const angle1 = Math.random() * Math.PI * 2; // Random angle (0 to 360 degrees)
    enemy1.position.x = state.player.position.x + Math.cos(angle1) * spawnDistance;
    enemy1.position.z = state.player.position.z + Math.sin(angle1) * spawnDistance;

    // Spawn second enemy on the opposite side with some deviation
    const enemy2 = createEnemy();
    enemy2.scale.set(newEnemyScaleFactor, newEnemyScaleFactor, newEnemyScaleFactor);
    enemy2.position.y = 0;
    // Opposite side (angle1 + PI) with a random deviation of +/- 45 degrees (PI/4 radians)
    const angle2 = angle1 + Math.PI + (Math.random() - 0.5) * (Math.PI / 2);
    enemy2.position.x = state.player.position.x + Math.cos(angle2) * spawnDistance;
    enemy2.position.z = state.player.position.z + Math.sin(angle2) * spawnDistance;
}

function avoidOtherEnemies(enemyGroup, index, dt) {
    const avoidRadius = 7; // INCREASED from 5 to 7

    state.enemies.forEach((otherEnemyGroup, otherIndex) => {
        if (index !== otherIndex) {
            const distance = enemyGroup.position.distanceTo(otherEnemyGroup.position);
            if (distance < avoidRadius) {
                // Calculate direction away from other enemy
                const avoidDirection = new THREE.Vector3()
                    .subVectors(enemyGroup.position, otherEnemyGroup.position)
                    .normalize();

                // Apply avoidance force (units/second × dt)
                enemyGroup.position.addScaledVector(avoidDirection, AVOID_FORCE * dt);
            }
        }
    });
}
