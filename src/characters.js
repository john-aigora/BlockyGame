import * as THREE from 'three';
import { state } from './state.js';
import { applyWorldBend } from './terrain.js';

// --- Shared GPU resource caches (plan 007) ---
// Geometries are cached per baseSize (every part dimension derives from
// baseSize, so the key covers all part dims) and materials per color; both
// live for the app's lifetime and are never disposed. The exceptions: an
// enemy's body material AND cap material must be PER-INSTANCE (cloned)
// because the killable-state color mutates per enemy — setHex on a shared
// material would repaint every enemy at once. disposeCharacter() cleans up
// exactly those clones.
const geometryCache = new Map(); // baseSize → { body, heroBody, leg, foot, eye, pupil, brow, mouth, cap, ear, tail, spike, jaw, tooth, antenna, antennaTip, scarf }
const materialCache = new Map(); // color → MeshStandardMaterial (shared parts)

// --- Glow accents (art iteration 2) ---
// Static shared materials WITH emissive — deliberately not in materialCache
// (it keys on color alone: 0xFFFFFF there is the matte eye white, and a
// scared pupil must glow without dragging every eye white along with it).
// HERO_GLOW breathes at ~0.5Hz — effects.js drives emissiveIntensity.
export const HERO_GLOW_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x76FF03, emissive: 0x76FF03, emissiveIntensity: 0.7 });
export const ENEMY_PUPIL_HUNT_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x1A0505, emissive: 0xFF1744, emissiveIntensity: 0.9 });
export const ENEMY_PUPIL_SCARED_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, emissive: 0xFFFFFF, emissiveIntensity: 0.3 });
// Cartoon outline: an inverted hull (BackSide shell) on the body cube only.
const OUTLINE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
// Horizon bend (endless) so far characters sit on the curved ground, not above it.
applyWorldBend(HERO_GLOW_MATERIAL);
applyWorldBend(ENEMY_PUPIL_HUNT_MATERIAL);
applyWorldBend(ENEMY_PUPIL_SCARED_MATERIAL);
applyWorldBend(OUTLINE_MATERIAL);

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
            // Hero body: marginally WIDER than deep — chunky reads heroic.
            // Same height as `body`: kill math compares body heights, so
            // only x may flex.
            heroBody: new THREE.BoxGeometry(baseSize * 1.08, baseSize, baseSize),
            leg: new THREE.BoxGeometry(legWidth, legHeight, legWidth),
            foot: new THREE.BoxGeometry(baseSize * 0.26, baseSize * 0.1, baseSize * 0.3),
            eye: new THREE.BoxGeometry(eyeSize, eyeSize, eyeSize),
            pupil: new THREE.BoxGeometry(pupilSize, pupilSize, pupilSize),
            brow: new THREE.BoxGeometry(baseSize * 0.26, baseSize * 0.055, baseSize * 0.06),
            mouth: new THREE.BoxGeometry(mouthWidth, mouthHeight, mouthDepth),
            cap: new THREE.BoxGeometry(baseSize * 0.92, baseSize * 0.06, baseSize * 0.92),
            // Enemy-only parts share the same per-baseSize cache entry; a
            // baseSize that never renders them never uploads them either.
            ear: new THREE.BoxGeometry(baseSize * 0.2, baseSize * 0.2, baseSize * 0.1),
            tail: new THREE.BoxGeometry(baseSize * 0.14, baseSize * 0.14, baseSize * 0.3),
            spike: new THREE.BoxGeometry(baseSize * 0.17, baseSize * 0.17, baseSize * 0.17),
            jaw: new THREE.BoxGeometry(baseSize * 0.46, baseSize * 0.12, baseSize * 0.16),
            tooth: new THREE.BoxGeometry(baseSize * 0.08, baseSize * 0.1, baseSize * 0.06),
            // Player-only signature accessories
            antenna: new THREE.BoxGeometry(baseSize * 0.06, baseSize * 0.28, baseSize * 0.06),
            antennaTip: new THREE.BoxGeometry(baseSize * 0.13, baseSize * 0.13, baseSize * 0.13),
            scarf: new THREE.BoxGeometry(baseSize * 0.34, baseSize * 0.1, baseSize * 0.26)
        };
        geometryCache.set(baseSize, geoms);
    }
    return geoms;
}

function getSharedMaterial(color) {
    let material = materialCache.get(color);
    if (!material) {
        material = new THREE.MeshStandardMaterial({ color });
        applyWorldBend(material); // Match terrain curve (food/enemies at distance)
        materialCache.set(color, material);
    }
    return material;
}

// three r128 Material.clone() drops onBeforeCompile but copies userData, so
// a naive clone loses the horizon bend while userData.worldBend stays true
// and blocks re-patch. Clear the flag and re-arm the shader.
function bendClone(mat) {
    const c = mat.clone();
    c.userData.worldBend = false;
    applyWorldBend(c);
    return c;
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
//   wobble), back spikes, an underbite jaw with teeth, glowing hunter
//   pupils, a forward hunch, and heavy brows. Without it the character gets
//   the heroic brows, smirk, glowing antenna, and scarf (player).
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
        ? bendClone(getSharedMaterial(bodyColor)) // Own copy + re-armed horizon bend
        : getSharedMaterial(bodyColor);
    const capMaterial = perInstanceBodyMaterial
        ? bendClone(getSharedMaterial(shadeColor(bodyColor, CAP_LIGHTEN))) // Flips with body (enemies.js)
        : getSharedMaterial(shadeColor(bodyColor, CAP_LIGHTEN));
    const footMaterial = getSharedMaterial(shadeColor(bodyColor, FOOT_SHADE)); // SHARED even for enemies — feet stay dark when the body flips
    const faceMaterial = getSharedMaterial(faceColor);
    const whiteMaterial = getSharedMaterial(0xFFFFFF); // Eye whites + teeth
    if (perInstanceBodyMaterial) {
        group.userData.ownedMaterials = [bodyMaterial, capMaterial]; // disposeCharacter() releases these
        group.userData.capMaterial = capMaterial; // enemies.js flips it with the killable state
    }

    // --- Body Mesh ---
    // Face, cap, ears, tail, and antenna are CHILDREN of the body mesh, so
    // the walk-cycle body bounce (effects.js) carries the whole head along.
    // The player gets the chunkier hero body; enemies keep the pure cube.
    const bodyMesh = new THREE.Mesh(menacing ? geoms.body : geoms.heroBody, bodyMaterial);
    bodyMesh.name = 'body'; // Assign a name to easily access it later for color changes
    bodyMesh.castShadow = true;
    bodyMesh.position.y = legHeight + (baseSize / 2); // Center of body above legs
    if (menacing) bodyMesh.rotation.x = 0.07; // Slight forward hunch — looming, not perky
    group.add(bodyMesh);
    // Tags for the walk animation (plan 015): effects.js drives leg swing and
    // a stride bounce without any per-frame traversal or name lookups.
    group.userData.bodyMesh = bodyMesh;
    group.userData.bodyBaseY = bodyMesh.position.y;

    // --- Cartoon Outline Shell ---
    // The classic inverted hull: the SAME body geometry scaled up 6% with a
    // back-face-only black material. Its far faces sit just behind the body,
    // so all you see is a black rim around the silhouette. One extra mesh
    // per character, one shared material, zero per-instance resources.
    const outlineMesh = new THREE.Mesh(bodyMesh.geometry, OUTLINE_MATERIAL);
    outlineMesh.scale.setScalar(1.06);
    bodyMesh.add(outlineMesh);

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
        foot.position.set(0, -legHeight / 2 + baseSize * 0.05, baseSize * 0.03); // Bottom-flush, toe forward
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

    // Face parts are tagged for effects.js: blink timers squash the eye
    // whites + pupils, and the enemy's scared state (killable) swaps pupil
    // materials and flips the brows from angry to worried.
    group.userData.eyeWhites = [];
    group.userData.pupils = [];
    group.userData.brows = [];

    for (const side of [-1, 1]) {
        const eyeWhite = new THREE.Mesh(geoms.eye, whiteMaterial);
        eyeWhite.position.set(side * eyeXSpacing, eyeLocalY, eyeZOffset);
        eyeWhite.castShadow = true;
        bodyMesh.add(eyeWhite);
        group.userData.eyeWhites.push(eyeWhite);

        // Hunter pupils GLOW faint red; the player keeps matte face-color
        // pupils. Both are shared materials — effects.js swaps enemy pupils
        // to the scared (white, wide) material by reference when killable.
        const pupil = new THREE.Mesh(geoms.pupil, menacing ? ENEMY_PUPIL_HUNT_MATERIAL : faceMaterial);
        pupil.position.set(side * (eyeXSpacing - pupilInset), eyeLocalY, pupilZOffset);
        pupil.castShadow = true;
        bodyMesh.add(pupil);
        group.userData.pupils.push(pupil);

        // --- Angled Eyebrow ---
        // Signs: positive rotation.z raises the +x end. Both looks tilt the
        // inner ends DOWN — a slight heroic-determined angle for the player
        // (raised, open), a steep heavy angle (right on the eyes) for enemies.
        const brow = new THREE.Mesh(geoms.brow, faceMaterial);
        const browTilt = menacing ? 0.52 : 0.10;
        brow.position.set(
            side * (eyeXSpacing - (menacing ? baseSize * 0.02 : 0)),
            eyeLocalY + eyeSize / 2 + (menacing ? baseSize * 0.04 : baseSize * 0.09),
            baseSize / 2 + baseSize * 0.03 - facePartDepthOffset
        );
        brow.rotation.z = side * browTilt;
        brow.castShadow = true;
        // Scared flip targets (worried = inner ends UP, raised off the eyes);
        // effects.js snaps between these on the killable transition.
        brow.userData.baseRotZ = brow.rotation.z;
        brow.userData.baseY = brow.position.y;
        brow.userData.scaredRotZ = -side * 0.35;
        brow.userData.scaredY = brow.position.y + baseSize * 0.08;
        bodyMesh.add(brow);
        group.userData.brows.push(brow);
    }

    // --- Mouth Mesh ---
    const mouthMesh = new THREE.Mesh(geoms.mouth, faceMaterial);
    const mouthLocalY = -baseSize * 0.2;
    const mouthZOffset = baseSize / 2 + mouthDepth / 2 - facePartDepthOffset; // Front face
    mouthMesh.position.set(menacing ? 0 : baseSize * 0.03, mouthLocalY, mouthZOffset);
    if (!menacing) mouthMesh.rotation.z = 0.12; // Cocky smirk — heroes grin
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
        // Sits far enough back to clear the outline shell (which would
        // otherwise swallow its front half and leave a sad little nub).
        const tail = new THREE.Mesh(geoms.tail, bodyMaterial);
        tail.position.set(0, -baseSize * 0.28, -(baseSize / 2 + baseSize * 0.22));
        tail.castShadow = true;
        bodyMesh.add(tail);
        group.userData.tailMesh = tail;

        // --- Back Spikes (x3) ---
        // Cubes rotated 45° on TWO axes read as jagged gems from every
        // camera angle — instantly "don't touch me". Body material INSTANCE:
        // they flip killable-yellow with the body, ears, and tail.
        for (const spec of [{ z: 0.3, s: 0.8 }, { z: 0.04, s: 1.1 }, { z: -0.24, s: 0.9 }]) {
            const spike = new THREE.Mesh(geoms.spike, bodyMaterial);
            spike.position.set(0, baseSize * 0.58, spec.z * baseSize);
            spike.rotation.set(Math.PI / 4, 0, Math.PI / 4);
            spike.scale.setScalar(spec.s);
            spike.castShadow = true;
            bodyMesh.add(spike);
        }

        // --- Underbite Jaw with Chunky Teeth ---
        // A darker slab (the feet's shared shade — stays dark on the killable
        // flip, exactly like the feet) jutting past the front face, with
        // three teeth pointing UP over the mouth. Replaces the tiny fangs,
        // which vanished at gameplay zoom.
        const jaw = new THREE.Mesh(geoms.jaw, footMaterial);
        jaw.position.set(0, -baseSize * 0.32, baseSize / 2 + baseSize * 0.04);
        jaw.castShadow = true;
        for (const tx of [-0.15, 0, 0.15]) {
            const tooth = new THREE.Mesh(geoms.tooth, whiteMaterial);
            tooth.position.set(tx * baseSize, baseSize * 0.1, baseSize * 0.03);
            tooth.castShadow = true;
            jaw.add(tooth);
        }
        bodyMesh.add(jaw);
    } else {
        // --- Antenna (player's signature accessory) ---
        // A tiny body-colored antenna with a GLOWING lime tip — the same lime
        // as the food he hunts (and now the grid's glow language). Slightly
        // off-center back-right: cuter than symmetric.
        const antenna = new THREE.Mesh(geoms.antenna, bodyMaterial);
        antenna.position.set(baseSize * 0.18, baseSize / 2 + baseSize * 0.12, -baseSize * 0.12);
        antenna.castShadow = true;
        const tip = new THREE.Mesh(geoms.antennaTip, HERO_GLOW_MATERIAL);
        tip.position.set(0, baseSize * 0.14 + baseSize * 0.04, 0);
        tip.castShadow = true;
        antenna.add(tip);
        bodyMesh.add(antenna);

        // --- Hero Scarf (3 chained segments) ---
        // Glowing lime, chained mesh-to-mesh so one rotation curls the whole
        // tail (and the compounding child scale tapers it). effects.js
        // streams it back with the stride and lets it hang at rest.
        // Characters never yaw (faces always point at the camera), so a
        // straight-back scarf would live permanently hidden behind the body —
        // the first segment yaws the chain back-LEFT so it peeks past the
        // silhouette (the antenna leans right; asymmetry is charm).
        const scarfSegs = [];
        let scarfParent = bodyMesh;
        for (let i = 0; i < 3; i++) {
            const seg = new THREE.Mesh(geoms.scarf, HERO_GLOW_MATERIAL);
            if (i === 0) {
                seg.position.set(-baseSize * 0.3, baseSize * 0.34, -(baseSize / 2 + baseSize * 0.06));
                seg.rotation.y = 0.95; // Yaw only here; children inherit it
            } else {
                seg.position.set(0, 0, -baseSize * 0.21);
                seg.scale.setScalar(0.86);
            }
            seg.rotation.x = -0.5; // Rest droop; effects.js animates from here
            seg.userData.restRotX = -0.5;
            seg.castShadow = true;
            scarfParent.add(seg);
            scarfSegs.push(seg);
            scarfParent = seg;
        }
        group.userData.scarfSegs = scarfSegs;
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
