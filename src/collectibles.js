import * as THREE from 'three';
import { worldSize, worldBoundary, collectibleSpawnRadius, minSpawnDistanceFromPlayer } from './constants.js';
import { state } from './state.js';

// Builds the shared collectible mesh (small lime-green cube).
function buildCollectible() {
    const collectibleGeometry = new THREE.BoxGeometry(0.7, 0.7, 0.7); // Smaller cube
    const collectibleMaterial = new THREE.MeshStandardMaterial({ color: 0x76FF03 }); // Lime Green for collectibles (food)
    const collectible = new THREE.Mesh(collectibleGeometry, collectibleMaterial);
    collectible.castShadow = true;
    collectible.receiveShadow = true; // Though small, good practice
    return collectible;
}

// Single spawner: the caller supplies the placement strategy via pickPosition.
export function spawnCollectible(pickPosition) {
    const collectible = buildCollectible();
    const { x, z } = pickPosition();
    collectible.position.set(x, 0.35, z); // Position on the ground
    state.collectibles.push(collectible);
    state.scene.add(collectible);
}

// Spawn a collectible in a random box around the player.
export function spawnNearPlayer() {
    if (!state.player) return; // Can't spawn relative to non-existent player

    spawnCollectible(() => {
        let spawnX, spawnZ;
        let distanceToPlayer;
        // Keep trying to find a spawn position until it's not too close to the player
        do {
            // Random position within a square area around the player
            spawnX = state.player.position.x + (Math.random() * collectibleSpawnRadius * 2) - collectibleSpawnRadius;
            spawnZ = state.player.position.z + (Math.random() * collectibleSpawnRadius * 2) - collectibleSpawnRadius;
            distanceToPlayer = Math.sqrt(Math.pow(spawnX - state.player.position.x, 2) + Math.pow(spawnZ - state.player.position.z, 2));
        } while (distanceToPlayer < minSpawnDistanceFromPlayer);
        return { x: spawnX, z: spawnZ };
    });
}

// Spawn a collectible anywhere in the world (initial even distribution).
export function spawnAnywhere() {
    spawnCollectible(() => {
        let spawnX, spawnZ;
        let distanceToPlayerStart;
        const playerInitialX = 0; // Player starts at 0,0,0
        const playerInitialZ = 0;

        // Keep trying to find a spawn position until it's not too close to player's initial spot
        do {
            spawnX = (Math.random() * worldSize) - worldBoundary; // Random pos in [-worldBoundary, +worldBoundary]
            spawnZ = (Math.random() * worldSize) - worldBoundary; // Random pos in [-worldBoundary, +worldBoundary]
            distanceToPlayerStart = Math.sqrt(Math.pow(spawnX - playerInitialX, 2) + Math.pow(spawnZ - playerInitialZ, 2));
        } while (distanceToPlayerStart < minSpawnDistanceFromPlayer);
        return { x: spawnX, z: spawnZ };
    });
}

// Spawn a collectible scattered around a specific position (e.g., enemy death).
export function spawnAtPosition(position) {
    spawnCollectible(() => {
        const scatterRange = 1.5; // How far the particles can scatter
        return {
            x: position.x + (Math.random() - 0.5) * scatterRange * 2,
            z: position.z + (Math.random() - 0.5) * scatterRange * 2
        };
    });
}
