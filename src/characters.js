import * as THREE from 'three';
import { state } from './state.js';

// --- Character Factory ---
// Shared geometry recipe for the player and enemies: a group made of a body
// cube, 4 legs, 2 eyes, and a mouth. Returns the THREE.Group without adding
// it to the scene.
export function createCharacter({ baseSize, bodyColor, faceColor }) {
    const group = new THREE.Group();

    // --- Define Dimensions ---
    const legHeight = baseSize * 0.3;
    const legWidth = baseSize * 0.15;
    const eyeSize = baseSize * 0.1;
    const mouthWidth = baseSize * 0.4;
    const mouthHeight = baseSize * 0.08;
    const mouthDepth = baseSize * 0.05;
    const facePartDepthOffset = 0.01; // How much eyes/mouth stick out

    // --- Materials ---
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: bodyColor });
    const faceMaterial = new THREE.MeshStandardMaterial({ color: faceColor });

    // --- Body Mesh ---
    const bodyGeometry = new THREE.BoxGeometry(baseSize, baseSize, baseSize);
    const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
    bodyMesh.name = 'body'; // Assign a name to easily access it later for color changes
    bodyMesh.castShadow = true;
    bodyMesh.position.y = legHeight + (baseSize / 2); // Center of body above legs
    group.add(bodyMesh);

    // --- Leg Meshes (x4) ---
    const legGeometry = new THREE.BoxGeometry(legWidth, legHeight, legWidth);
    const legPositions = [
        { x: -baseSize / 2 + legWidth / 2 + legWidth * 0.5, z: -baseSize / 2 + legWidth / 2 + legWidth * 0.5 }, // Front-left
        { x: baseSize / 2 - legWidth / 2 - legWidth * 0.5, z: -baseSize / 2 + legWidth / 2 + legWidth * 0.5 },  // Front-right
        { x: -baseSize / 2 + legWidth / 2 + legWidth * 0.5, z: baseSize / 2 - legWidth / 2 - legWidth * 0.5 },  // Back-left
        { x: baseSize / 2 - legWidth / 2 - legWidth * 0.5, z: baseSize / 2 - legWidth / 2 - legWidth * 0.5 }   // Back-right
    ];

    legPositions.forEach(pos => {
        const leg = new THREE.Mesh(legGeometry, bodyMaterial); // Legs use body material
        leg.castShadow = true;
        leg.position.set(pos.x, legHeight / 2, pos.z); // Leg base at y=0 of leg, so center at legHeight/2
        group.add(leg);
    });

    // --- Eye Meshes (x2) ---
    const eyeGeometry = new THREE.BoxGeometry(eyeSize, eyeSize, eyeSize);
    const eyeY = bodyMesh.position.y + baseSize * 0.15; // Position eyes on upper part of body
    const eyeXSpacing = baseSize * 0.2;
    const eyeZOffset = baseSize / 2 + eyeSize / 2 - facePartDepthOffset; // Place on front face of body

    const leftEye = new THREE.Mesh(eyeGeometry, faceMaterial);
    leftEye.position.set(-eyeXSpacing, eyeY, eyeZOffset);
    leftEye.castShadow = true;
    group.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeometry, faceMaterial);
    rightEye.position.set(eyeXSpacing, eyeY, eyeZOffset);
    rightEye.castShadow = true;
    group.add(rightEye);

    // --- Mouth Mesh ---
    const mouthGeometry = new THREE.BoxGeometry(mouthWidth, mouthHeight, mouthDepth);
    const mouthMesh = new THREE.Mesh(mouthGeometry, faceMaterial);
    const mouthY = bodyMesh.position.y - baseSize * 0.2;
    const mouthZOffset = baseSize / 2 + mouthDepth / 2 - facePartDepthOffset; // Place on front face
    mouthMesh.position.set(0, mouthY, mouthZOffset);
    mouthMesh.castShadow = true;
    group.add(mouthMesh);

    group.castShadow = true; // Though individual parts cast, good to set for group if needed
    return group;
}

export function createPlayer() {
    if (state.player) {
        state.scene.remove(state.player); // Remove old player group if it exists
    }
    const playerGroup = createCharacter({ baseSize: 1.0, bodyColor: 0xFF4500, faceColor: 0x000000 }); // Bright Orange-Red body, black face

    // Assign to shared player state
    state.player = playerGroup;
    playerGroup.position.y = 0; // Group's origin at feet level on the ground
    playerGroup.scale.set(state.playerScale, state.playerScale, state.playerScale); // Apply initial/current scale
    state.scene.add(playerGroup);
}
