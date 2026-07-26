import * as THREE from 'three';
import { state } from './state.js';

// --- Shared GPU resource caches (plan 007) ---
// Geometries are cached per baseSize and materials per color; both live for
// the app's lifetime and are never disposed. The ONE exception: an enemy's
// body material must be PER-INSTANCE (cloned) because the killable-state
// color mutates per enemy — setHex on a shared material would repaint every
// enemy at once. disposeCharacter() cleans up exactly those clones.
const geometryCache = new Map(); // baseSize → { body, leg, eye, mouth }
const materialCache = new Map(); // color → MeshStandardMaterial (face + player body)

function getGeometries(baseSize) {
    let geoms = geometryCache.get(baseSize);
    if (!geoms) {
        const legHeight = baseSize * 0.3;
        const legWidth = baseSize * 0.15;
        const eyeSize = baseSize * 0.1;
        const mouthWidth = baseSize * 0.4;
        const mouthHeight = baseSize * 0.08;
        const mouthDepth = baseSize * 0.05;
        geoms = {
            body: new THREE.BoxGeometry(baseSize, baseSize, baseSize),
            leg: new THREE.BoxGeometry(legWidth, legHeight, legWidth),
            eye: new THREE.BoxGeometry(eyeSize, eyeSize, eyeSize),
            mouth: new THREE.BoxGeometry(mouthWidth, mouthHeight, mouthDepth)
        };
        geometryCache.set(baseSize, geoms);
    }
    return geoms;
}

function getSharedMaterial(color) {
    let material = materialCache.get(color);
    if (!material) {
        material = new THREE.MeshStandardMaterial({ color });
        materialCache.set(color, material);
    }
    return material;
}

// --- Character Factory ---
// Shared geometry recipe for the player and enemies: a group made of a body
// cube, 4 legs, 2 eyes, and a mouth. Returns the THREE.Group without adding
// it to the scene. Pass perInstanceBodyMaterial: true for characters whose
// body color mutates at runtime (enemies).
export function createCharacter({ baseSize, bodyColor, faceColor, perInstanceBodyMaterial = false }) {
    const group = new THREE.Group();

    // --- Define Dimensions ---
    const legHeight = baseSize * 0.3;
    const legWidth = baseSize * 0.15;
    const eyeSize = baseSize * 0.1;
    const mouthDepth = baseSize * 0.05;
    const facePartDepthOffset = 0.01; // How much eyes/mouth stick out

    // --- Geometries (shared per baseSize) and Materials ---
    const geoms = getGeometries(baseSize);
    const bodyMaterial = perInstanceBodyMaterial
        ? getSharedMaterial(bodyColor).clone() // Own copy: this character's color flips independently
        : getSharedMaterial(bodyColor);
    const faceMaterial = getSharedMaterial(faceColor);
    if (perInstanceBodyMaterial) {
        group.userData.ownedMaterials = [bodyMaterial]; // disposeCharacter() releases these
    }

    // --- Body Mesh ---
    const bodyMesh = new THREE.Mesh(geoms.body, bodyMaterial);
    bodyMesh.name = 'body'; // Assign a name to easily access it later for color changes
    bodyMesh.castShadow = true;
    bodyMesh.position.y = legHeight + (baseSize / 2); // Center of body above legs
    group.add(bodyMesh);

    // --- Leg Meshes (x4) ---
    const legPositions = [
        { x: -baseSize / 2 + legWidth / 2 + legWidth * 0.5, z: -baseSize / 2 + legWidth / 2 + legWidth * 0.5 }, // Front-left
        { x: baseSize / 2 - legWidth / 2 - legWidth * 0.5, z: -baseSize / 2 + legWidth / 2 + legWidth * 0.5 },  // Front-right
        { x: -baseSize / 2 + legWidth / 2 + legWidth * 0.5, z: baseSize / 2 - legWidth / 2 - legWidth * 0.5 },  // Back-left
        { x: baseSize / 2 - legWidth / 2 - legWidth * 0.5, z: baseSize / 2 - legWidth / 2 - legWidth * 0.5 }   // Back-right
    ];

    legPositions.forEach(pos => {
        const leg = new THREE.Mesh(geoms.leg, bodyMaterial); // Legs use body material
        leg.castShadow = true;
        leg.position.set(pos.x, legHeight / 2, pos.z); // Leg base at y=0 of leg, so center at legHeight/2
        group.add(leg);
    });

    // --- Eye Meshes (x2) ---
    const eyeY = bodyMesh.position.y + baseSize * 0.15; // Position eyes on upper part of body
    const eyeXSpacing = baseSize * 0.2;
    const eyeZOffset = baseSize / 2 + eyeSize / 2 - facePartDepthOffset; // Place on front face of body

    const leftEye = new THREE.Mesh(geoms.eye, faceMaterial);
    leftEye.position.set(-eyeXSpacing, eyeY, eyeZOffset);
    leftEye.castShadow = true;
    group.add(leftEye);

    const rightEye = new THREE.Mesh(geoms.eye, faceMaterial);
    rightEye.position.set(eyeXSpacing, eyeY, eyeZOffset);
    rightEye.castShadow = true;
    group.add(rightEye);

    // --- Mouth Mesh ---
    const mouthMesh = new THREE.Mesh(geoms.mouth, faceMaterial);
    const mouthY = bodyMesh.position.y - baseSize * 0.2;
    const mouthZOffset = baseSize / 2 + mouthDepth / 2 - facePartDepthOffset; // Place on front face
    mouthMesh.position.set(0, mouthY, mouthZOffset);
    mouthMesh.castShadow = true;
    group.add(mouthMesh);

    group.castShadow = true; // Though individual parts cast, good to set for group if needed
    return group;
}

// Releases a character's PER-INSTANCE GPU resources (the cloned enemy body
// material). Shared/cached geometries and materials are deliberately left
// alone — they outlive any single character. Call after scene.remove.
export function disposeCharacter(group) {
    if (group.userData.ownedMaterials) {
        group.userData.ownedMaterials.forEach(material => material.dispose());
        group.userData.ownedMaterials = null;
    }
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
