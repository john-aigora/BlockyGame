import * as THREE from 'three';
import { state } from './state.js';

// --- Shared GPU resource caches (plan 007) ---
// Geometries are cached per baseSize (every part dimension derives from
// baseSize, so the key covers all part dims) and materials per color; both
// live for the app's lifetime and are never disposed. The exceptions: an
// enemy's body material AND cap material must be PER-INSTANCE (cloned)
// because the killable-state color mutates per enemy — setHex on a shared
// material would repaint every enemy at once. disposeCharacter() cleans up
// exactly those clones.
const geometryCache = new Map(); // baseSize → { body, leg, foot, eye, pupil, brow, mouth, cap, ear, tail, fang, antenna, antennaTip }
const materialCache = new Map(); // color → MeshStandardMaterial (shared parts)

// Shade factors for the derived body-color materials (kid-tunable-ish, but
// they live here because they are a look, not game balance).
export const FOOT_SHADE = 0.6; // Feet: body color multiplied down — grounded look
export const CAP_LIGHTEN = 1.3; // Cap: top-face highlight shade

// Multiplies a hex color's channels by `factor` (clamped to valid range).
// Cheap enough to run at build time; the RESULT is what gets cached
// (materialCache keys on the shaded hex), so each (color, shade) pair costs
// one material total. enemies.js uses it for the killable cap flip colors.
const scratchShade = new THREE.Color();
export function shadeColor(hex, factor) {
    scratchShade.setHex(hex);
    scratchShade.r = Math.min(1, scratchShade.r * factor);
    scratchShade.g = Math.min(1, scratchShade.g * factor);
    scratchShade.b = Math.min(1, scratchShade.b * factor);
    return scratchShade.getHex();
}

function getGeometries(baseSize) {
    let geoms = geometryCache.get(baseSize);
    if (!geoms) {
        const legHeight = baseSize * 0.3;
        const legWidth = baseSize * 0.15;
        const eyeSize = baseSize * 0.15; // White of the two-layer eye
        const pupilSize = baseSize * 0.07;
        const mouthWidth = baseSize * 0.4;
        const mouthHeight = baseSize * 0.08;
        const mouthDepth = baseSize * 0.05;
        geoms = {
            body: new THREE.BoxGeometry(baseSize, baseSize, baseSize),
            leg: new THREE.BoxGeometry(legWidth, legHeight, legWidth),
            foot: new THREE.BoxGeometry(baseSize * 0.2, baseSize * 0.09, baseSize * 0.24),
            eye: new THREE.BoxGeometry(eyeSize, eyeSize, eyeSize),
            pupil: new THREE.BoxGeometry(pupilSize, pupilSize, pupilSize),
            brow: new THREE.BoxGeometry(baseSize * 0.26, baseSize * 0.055, baseSize * 0.06),
            mouth: new THREE.BoxGeometry(mouthWidth, mouthHeight, mouthDepth),
            cap: new THREE.BoxGeometry(baseSize * 0.92, baseSize * 0.06, baseSize * 0.92),
            // Enemy-only parts share the same per-baseSize cache entry; a
            // baseSize that never renders them never uploads them either.
            ear: new THREE.BoxGeometry(baseSize * 0.2, baseSize * 0.2, baseSize * 0.1),
            tail: new THREE.BoxGeometry(baseSize * 0.14, baseSize * 0.14, baseSize * 0.3),
            fang: new THREE.BoxGeometry(baseSize * 0.06, baseSize * 0.1, baseSize * 0.05),
            // Player-only signature accessory
            antenna: new THREE.BoxGeometry(baseSize * 0.06, baseSize * 0.28, baseSize * 0.06),
            antennaTip: new THREE.BoxGeometry(baseSize * 0.11, baseSize * 0.11, baseSize * 0.11)
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
// cube (with a lighter cap-block highlight on top), 4 legs with darker feet,
// two-layer eyes (white + pupil), angled eyebrows, and a mouth. Returns the
// THREE.Group without adding it to the scene.
// Options:
// - perInstanceBodyMaterial: for characters whose body color mutates at
//   runtime (enemies) — clones the body AND cap materials.
// - menacing: enemy styling — pointed ears, a tail (tagged for the walk-cycle
//   wobble), fangs, inward pupils, and angry brows. Without it the character
//   gets the heroic brows and the antenna accessory (player).
export function createCharacter({ baseSize, bodyColor, faceColor, perInstanceBodyMaterial = false, menacing = false }) {
    const group = new THREE.Group();

    // --- Define Dimensions ---
    const legHeight = baseSize * 0.3;
    const legWidth = baseSize * 0.15;
    const eyeSize = baseSize * 0.15;
    const pupilSize = baseSize * 0.07;
    const mouthDepth = baseSize * 0.05;
    const facePartDepthOffset = 0.01 * baseSize; // How much face parts embed into the block below them

    // --- Geometries (shared per baseSize) and Materials ---
    const geoms = getGeometries(baseSize);
    const bodyMaterial = perInstanceBodyMaterial
        ? getSharedMaterial(bodyColor).clone() // Own copy: this character's color flips independently
        : getSharedMaterial(bodyColor);
    const capMaterial = perInstanceBodyMaterial
        ? getSharedMaterial(shadeColor(bodyColor, CAP_LIGHTEN)).clone() // Flips with the body (enemies.js)
        : getSharedMaterial(shadeColor(bodyColor, CAP_LIGHTEN));
    const footMaterial = getSharedMaterial(shadeColor(bodyColor, FOOT_SHADE)); // SHARED even for enemies — feet stay dark when the body flips
    const faceMaterial = getSharedMaterial(faceColor);
    const whiteMaterial = getSharedMaterial(0xFFFFFF); // Eye whites + fangs
    if (perInstanceBodyMaterial) {
        group.userData.ownedMaterials = [bodyMaterial, capMaterial]; // disposeCharacter() releases these
        group.userData.capMaterial = capMaterial; // enemies.js flips it with the killable state
    }

    // --- Body Mesh ---
    // Face, cap, ears, tail, and antenna are CHILDREN of the body mesh, so
    // the walk-cycle body bounce (effects.js) carries the whole head along.
    const bodyMesh = new THREE.Mesh(geoms.body, bodyMaterial);
    bodyMesh.name = 'body'; // Assign a name to easily access it later for color changes
    bodyMesh.castShadow = true;
    bodyMesh.position.y = legHeight + (baseSize / 2); // Center of body above legs
    group.add(bodyMesh);
    // Tags for the walk animation (plan 015): effects.js drives leg swing and
    // a stride bounce without any per-frame traversal or name lookups.
    group.userData.bodyMesh = bodyMesh;
    group.userData.bodyBaseY = bodyMesh.position.y;

    // --- Cap Mesh (top-face highlight) ---
    // A slightly smaller, lighter slab riding the top face — the cheap way to
    // fake a lit top without per-vertex color plumbing through the caches.
    const capMesh = new THREE.Mesh(geoms.cap, capMaterial);
    capMesh.castShadow = true;
    capMesh.position.y = baseSize / 2 + baseSize * 0.03 - facePartDepthOffset;
    bodyMesh.add(capMesh);

    // --- Leg Meshes (x4) with Feet ---
    const legPositions = [
        { x: -baseSize / 2 + legWidth / 2 + legWidth * 0.5, z: -baseSize / 2 + legWidth / 2 + legWidth * 0.5 }, // Front-left
        { x: baseSize / 2 - legWidth / 2 - legWidth * 0.5, z: -baseSize / 2 + legWidth / 2 + legWidth * 0.5 },  // Front-right
        { x: -baseSize / 2 + legWidth / 2 + legWidth * 0.5, z: baseSize / 2 - legWidth / 2 - legWidth * 0.5 },  // Back-left
        { x: baseSize / 2 - legWidth / 2 - legWidth * 0.5, z: baseSize / 2 - legWidth / 2 - legWidth * 0.5 }   // Back-right
    ];

    // Legs are tagged in order FL, FR, BL, BR — effects.js swings diagonal
    // pairs in antiphase for the walk cycle (plan 015).
    group.userData.legs = legPositions.map(pos => {
        const leg = new THREE.Mesh(geoms.leg, bodyMaterial); // Legs use body material
        leg.castShadow = true;
        leg.position.set(pos.x, legHeight / 2, pos.z); // Leg base at y=0 of leg, so center at legHeight/2
        // Darker foot block, parented to the leg so it swings with the stride
        const foot = new THREE.Mesh(geoms.foot, footMaterial);
        foot.castShadow = true;
        foot.position.set(0, -legHeight / 2 + baseSize * 0.045, baseSize * 0.03); // Bottom-flush, toe forward
        leg.add(foot);
        group.add(leg);
        return leg;
    });

    // --- Two-Layer Eyes (white + pupil) ---
    const eyeLocalY = baseSize * 0.15; // Upper part of the body (local to bodyMesh)
    const eyeXSpacing = baseSize * 0.2;
    const eyeZOffset = baseSize / 2 + eyeSize / 2 - facePartDepthOffset; // Front face of body
    const pupilZOffset = eyeZOffset + eyeSize / 2 + pupilSize / 2 - facePartDepthOffset * 3; // Riding the eye, offset toward facing
    // Player pupils sit centered-forward (determined); enemy pupils shift
    // slightly inward (menacing).
    const pupilInset = menacing ? baseSize * 0.035 : 0;

    for (const side of [-1, 1]) {
        const eyeWhite = new THREE.Mesh(geoms.eye, whiteMaterial);
        eyeWhite.position.set(side * eyeXSpacing, eyeLocalY, eyeZOffset);
        eyeWhite.castShadow = true;
        bodyMesh.add(eyeWhite);

        const pupil = new THREE.Mesh(geoms.pupil, faceMaterial);
        pupil.position.set(side * (eyeXSpacing - pupilInset), eyeLocalY, pupilZOffset);
        pupil.castShadow = true;
        bodyMesh.add(pupil);

        // --- Angled Eyebrow ---
        // Signs: positive rotation.z raises the +x end. Both looks tilt the
        // inner ends DOWN — a slight heroic-determined angle for the player
        // (raised, open), a steep angry angle (closer to the eyes) for enemies.
        const brow = new THREE.Mesh(geoms.brow, faceMaterial);
        const browTilt = menacing ? 0.42 : 0.10;
        brow.position.set(
            side * (eyeXSpacing - (menacing ? baseSize * 0.02 : 0)),
            eyeLocalY + eyeSize / 2 + (menacing ? baseSize * 0.055 : baseSize * 0.09),
            baseSize / 2 + baseSize * 0.03 - facePartDepthOffset
        );
        brow.rotation.z = side * browTilt;
        brow.castShadow = true;
        bodyMesh.add(brow);
    }

    // --- Mouth Mesh ---
    const mouthMesh = new THREE.Mesh(geoms.mouth, faceMaterial);
    const mouthLocalY = -baseSize * 0.2;
    const mouthZOffset = baseSize / 2 + mouthDepth / 2 - facePartDepthOffset; // Front face
    mouthMesh.position.set(0, mouthLocalY, mouthZOffset);
    mouthMesh.castShadow = true;
    bodyMesh.add(mouthMesh);

    if (menacing) {
        // --- Pointed Ears (x2) ---
        // A 45°-rotated block reads as a pointed ear while staying a block.
        // Ears use the body material INSTANCE so they flip killable-yellow.
        group.userData.earMeshes = [-1, 1].map(side => {
            const ear = new THREE.Mesh(geoms.ear, bodyMaterial);
            ear.position.set(side * baseSize * 0.3, baseSize * 0.58, 0);
            ear.rotation.z = Math.PI / 4;
            ear.castShadow = true;
            ear.userData.baseY = ear.position.y; // Walk cycle bounces around this
            bodyMesh.add(ear);
            return ear;
        });

        // --- Tail ---
        // Body material instance (flips yellow too); tagged for the walk wag.
        const tail = new THREE.Mesh(geoms.tail, bodyMaterial);
        tail.position.set(0, -baseSize * 0.28, -(baseSize / 2 + baseSize * 0.12));
        tail.castShadow = true;
        bodyMesh.add(tail);
        group.userData.tailMesh = tail;

        // --- Fangs (x2) ---
        for (const side of [-1, 1]) {
            const fang = new THREE.Mesh(geoms.fang, whiteMaterial);
            fang.position.set(side * baseSize * 0.1, mouthLocalY - baseSize * 0.06, mouthZOffset + facePartDepthOffset);
            fang.castShadow = true;
            bodyMesh.add(fang);
        }
    } else {
        // --- Antenna (player's signature accessory) ---
        // A tiny body-colored antenna with a lime tip — the same lime as the
        // food he hunts. Slightly off-center back-right: cuter than symmetric.
        const antenna = new THREE.Mesh(geoms.antenna, bodyMaterial);
        antenna.position.set(baseSize * 0.18, baseSize / 2 + baseSize * 0.12, -baseSize * 0.12);
        antenna.castShadow = true;
        const tip = new THREE.Mesh(geoms.antennaTip, getSharedMaterial(0x76FF03)); // Food lime
        tip.position.set(0, baseSize * 0.14 + baseSize * 0.04, 0);
        tip.castShadow = true;
        antenna.add(tip);
        bodyMesh.add(antenna);
    }

    group.castShadow = true; // Though individual parts cast, good to set for group if needed
    return group;
}

// Releases a character's PER-INSTANCE GPU resources (the cloned enemy body
// and cap materials). Shared/cached geometries and materials are deliberately
// left alone — they outlive any single character. Call after scene.remove.
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
