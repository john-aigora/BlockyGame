import * as THREE from 'three';
import {
    worldSize, collectibleSpawnRadius,
    ZOOM_STEP, ZOOM_MIN, ZOOM_MAX, GROWTH_FRAME_FACTOR,
    INITIAL_CAMERA_Y_OFFSET, INITIAL_CAMERA_Z_OFFSET,
    SHAKE_DURATION, SHAKE_AMPLITUDE,
    ATTRACT_ORBIT_PERIOD, ATTRACT_EASE_TIME
} from './constants.js';
import { state } from './state.js';

// --- World Creation ---
// Builds the scene, camera, renderer, lights, and ground plane.
// Returns the directional light so init() can point it at the player.
// --- Procedural sky (plan 015) ---
// Vertical gradient canvas: deep near-black teal at the zenith easing to a
// brighter teal at the horizon. The fog color matches the horizon color so
// the ground plane dissolves seamlessly into the sky.
const HORIZON_COLOR = 0x00695C;

function makeSkyTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#011E1A'); // Zenith: deep teal-black
    grad.addColorStop(0.55, '#02423A');
    grad.addColorStop(1, '#00695C'); // Horizon: matches the fog color
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 512);
    return new THREE.CanvasTexture(canvas);
}

// --- Living ground (plan 015) ---
// Procedural canvas tile: subtle darker-teal grid lines with faint glowing
// intersections on the base teal. Drawn once; tiled via RepeatWrapping.
// GROUND_TILE is the world-space size of one canvas tile (5x5 grid cells of
// 4 units each). It MUST divide worldSize evenly (200 / 20 = 10): the wrap
// seam then lands exactly on a tile boundary, so the texture offset stays
// continuous when the player wraps (16 gave 12.5 repeats — a visible snap).
// The grid stays FIXED IN THE WORLD even though the ground
// plane follows the player — updateGroundScroll offsets the texture by the
// player position, which is what makes movement visible on empty stretches.
const GROUND_TILE = 20; // world units per canvas tile — must divide worldSize
let groundTexture = null;

function makeGroundTexture(renderer) {
    const size = 640; // 5x5 cells → 128px per 4-unit cell (same density as before)
    const cell = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#004D40'; // Base teal — palette identity preserved
    ctx.fillRect(0, 0, size, size);
    // Grid lines: a darker teal, thin, low-contrast (readability first)
    ctx.strokeStyle = 'rgba(0, 30, 24, 0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 5; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cell + 0.5, 0);
        ctx.lineTo(i * cell + 0.5, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * cell + 0.5);
        ctx.lineTo(size, i * cell + 0.5);
        ctx.stroke();
    }
    // Faint glow dots at intersections — reads as an arcade grid floor
    for (let gx = 0; gx <= 5; gx++) {
        for (let gy = 0; gy <= 5; gy++) {
            const dot = ctx.createRadialGradient(gx * cell, gy * cell, 0, gx * cell, gy * cell, 14);
            dot.addColorStop(0, 'rgba(0, 121, 107, 0.75)');
            dot.addColorStop(1, 'rgba(0, 121, 107, 0)');
            ctx.fillStyle = dot;
            ctx.beginPath();
            ctx.arc(gx * cell, gy * cell, 14, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    // Very subtle per-cell tone variation so the floor isn't flat. (With an
    // odd 5x5 cell count the checkerboard parity repeats at tile edges — at
    // 2% alpha that is imperceptible, and continuity across the wrap wins.)
    for (let gx = 0; gx < 5; gx++) {
        for (let gy = 0; gy < 5; gy++) {
            if ((gx + gy) % 2 === 0) continue;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
            ctx.fillRect(gx * cell, gy * cell, cell, cell);
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(worldSize / GROUND_TILE, worldSize / GROUND_TILE);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
}

// The ground plane recenters on the player every frame; sliding the texture
// offset by the player position keeps the grid pattern fixed in WORLD space
// (offset math derived from the plane's -PI/2 X rotation: u tracks +x,
// v tracks -z). Called from the ground-follow block in game.js.
export function updateGroundScroll() {
    if (!groundTexture || !state.player) return;
    groundTexture.offset.set(
        state.player.position.x / GROUND_TILE,
        -state.player.position.z / GROUND_TILE
    );
}

// --- Kill micro-shake (score-juice pass) ---
// A tiny additive camera offset that decays over SHAKE_DURATION. Lives at
// the CAMERA layer (applied after the follow + lookAt), never on the player
// — gameplay positions are untouched. Screen-space motion, so it is fully
// disabled under prefers-reduced-motion (checked once in createWorld).
let shakeTime = 0;
let shakeEnabled = true;

export function triggerKillShake() {
    if (!shakeEnabled) return;
    shakeTime = SHAKE_DURATION;
}

export function createWorld() {
    shakeEnabled = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 1. Scene: The container for all 3D objects.
    state.scene = new THREE.Scene();
    state.scene.background = makeSkyTexture(); // Gradient sky (plan 015)
    state.scene.fog = new THREE.Fog(HORIZON_COLOR, 20, 100); // Fog for depth perception, tuned to the horizon

    // 2. Camera: Defines the viewpoint.
    // PerspectiveCamera(fov, aspect_ratio, near_clipping_plane, far_clipping_plane)
    const aspect = state.gameContainer.clientWidth / state.gameContainer.clientHeight;
    state.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    state.camera.position.set(0, 15, 10); // Initial camera position (x, y, z)
    state.camera.lookAt(0, 0, 0); // Camera looks at the center of the scene

    // 3. Renderer: Draws the scene from the camera's perspective.
    state.renderer = new THREE.WebGLRenderer({ antialias: true }); // antialias for smoother edges
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Sharp on retina; cap 2 — dpr 3+ costs GPU for invisible gains
    state.renderer.setSize(state.gameContainer.clientWidth, state.gameContainer.clientHeight);
    state.renderer.shadowMap.enabled = true; // Enable shadows in the scene
    // Add the renderer's canvas element to the game container div
    state.gameContainer.insertBefore(state.renderer.domElement, state.gameContainer.firstChild);

    // 4. Lighting: Illuminates the scene.
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Soft white light, illuminates all objects equally
    state.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); // Light from a specific direction (like the sun)
    directionalLight.position.set(10, 20, 5);
    directionalLight.castShadow = true; // This light will cast shadows
    // Configure shadow properties for better performance and appearance
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -collectibleSpawnRadius;
    directionalLight.shadow.camera.right = collectibleSpawnRadius;
    directionalLight.shadow.camera.top = collectibleSpawnRadius;
    directionalLight.shadow.camera.bottom = -collectibleSpawnRadius;
    state.scene.add(directionalLight);

    // 5. Ground Plane: The surface the player and objects are on.
    const groundGeometry = new THREE.PlaneGeometry(worldSize, worldSize);
    groundTexture = makeGroundTexture(state.renderer);
    // White base color: the teal lives in the texture (color would multiply it)
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: groundTexture, side: THREE.DoubleSide });
    state.ground = new THREE.Mesh(groundGeometry, groundMaterial);
    state.ground.rotation.x = -Math.PI / 2; // Rotate to be flat on XZ plane
    state.ground.receiveShadow = true; // Ground can receive shadows
    state.scene.add(state.ground);

    return directionalLight;
}

// Handles window resize events to keep the game looking correct.
export function onWindowResize() {
    if (!state.gameContainer || !state.renderer || !state.camera) return; // Ensure elements are initialized

    const newWidth = state.gameContainer.clientWidth;
    const newHeight = state.gameContainer.clientHeight;

    state.camera.aspect = newWidth / newHeight; // Update camera aspect ratio
    state.camera.updateProjectionMatrix(); // Apply changes to camera
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Window may have moved to a display with a different dpr
    state.renderer.setSize(newWidth, newHeight); // Resize renderer
}

// The camera offset the current zoom level and player size ask for.
// Growth compensation pulls the camera back as the player grows so the
// player never dominates the screen.
function cameraTargets() {
    const growthComp = 1 + (state.playerScale - 1) * GROWTH_FRAME_FACTOR;
    return {
        y: INITIAL_CAMERA_Y_OFFSET * state.zoomLevel * growthComp,
        z: INITIAL_CAMERA_Z_OFFSET * state.zoomLevel * growthComp
    };
}

// --- Attract mode (spectacle pass) ---
// While the start overlay is up the camera slowly orbits the player
// (ATTRACT_ORBIT_PERIOD s/revolution, gentle height bob) instead of the
// static behind-view — the title scene feels alive. The blend ramps
// linearly over ATTRACT_EASE_TIME (smoothstepped on use), so startRun eases
// back into gameplay framing rather than cutting. Camera orbit is
// SCREEN-SPACE motion, so under prefers-reduced-motion (shakeEnabled=false,
// resolved in createWorld) the orbit never runs and framing changes snap.
// attractAngle 0 IS the behind-view, so the boot blend-in has no seam.
let attractAngle = 0; // Orbit phase (radians)
let attractBob = 0; // Height-bob clock (seconds)
let attractBlend = 0; // 0 = gameplay framing, 1 = full orbit view

// Updates camera position to follow the player, easing the offset toward the
// zoom/growth target, and keeps the fog scaled to the camera distance.
// dt is the frame delta in seconds; callers outside the frame loop (e.g.
// zoom clicks while paused) pass 1/60.
export function updateCameraPosition(dt) {
    if (!state.player || !state.camera) return; // Check for player and camera
    const target = cameraTargets();
    const smoothing = 1 - Math.exp(-6 * dt);
    state.camY += (target.y - state.camY) * smoothing;
    state.camZ += (target.z - state.camZ) * smoothing;

    const wantAttract = state.onStartScreen && shakeEnabled;
    const blendStep = shakeEnabled ? dt / ATTRACT_EASE_TIME : 1; // Reduced motion: snap
    attractBlend = Math.max(0, Math.min(1, attractBlend + (wantAttract ? blendStep : -blendStep)));
    if (wantAttract) {
        attractAngle += dt * (Math.PI * 2 / ATTRACT_ORBIT_PERIOD);
        attractBob += dt;
    } else if (attractBlend === 0 && attractAngle !== 0) {
        attractAngle = 0; // The next overlay always starts from the behind-view
        attractBob = 0;
    }

    const p = state.player.position;
    let camX = p.x; // Gameplay framing: the behind-view
    let camYpos = p.y + state.camY;
    let camZpos = p.z + state.camZ;
    if (attractBlend > 0) {
        // Orbit at the CURRENT framing distance (camY/camZ keep easing above,
        // so zoom and player growth still frame correctly mid-orbit).
        const k = attractBlend * attractBlend * (3 - 2 * attractBlend); // Smoothstep
        const bob = 1 + 0.06 * Math.sin(attractBob * 0.7); // Gentle height breath
        camX += (p.x + Math.sin(attractAngle) * state.camZ - camX) * k;
        camYpos += (p.y + state.camY * bob - camYpos) * k;
        camZpos += (p.z + Math.cos(attractAngle) * state.camZ - camZpos) * k;
    }
    state.camera.position.set(camX, camYpos, camZpos);
    state.camera.lookAt(state.player.position);
    // Kill micro-shake: additive offset AFTER lookAt, so the camera jitters
    // in place without re-aiming — a punchy 0.12s thump, not a swing. The
    // amplitude decays linearly to zero; at ~7 frames total this is far from
    // any strobe, and reduced-motion users never get here (triggerKillShake).
    if (shakeTime > 0) {
        shakeTime = Math.max(0, shakeTime - dt);
        const amp = SHAKE_AMPLITUDE * (shakeTime / SHAKE_DURATION);
        state.camera.position.x += (Math.random() * 2 - 1) * amp;
        state.camera.position.y += (Math.random() * 2 - 1) * amp;
        state.camera.position.z += (Math.random() * 2 - 1) * amp;
    }
    updateFog();
}

// Fog follows the camera distance so the game stays visible at every zoom
// level, with the same depth-haze character as the original fixed 20/100.
function updateFog() {
    if (!state.scene || !state.scene.fog) return;
    const camDist = Math.hypot(state.camY, state.camZ);
    state.scene.fog.near = camDist * 1.1;
    state.scene.fog.far = camDist * 4.5;
}

// Resets the zoom for a new game and snaps the camera straight to the
// default framing (no lerp-in from the previous game's zoom).
export function resetCameraZoom() {
    state.zoomLevel = 1.0;
    shakeTime = 0; // A new run never inherits the last kill's shake
    const target = cameraTargets();
    state.camY = target.y;
    state.camZ = target.z;
    updateFog();
}

// Clamped zoom, shared by both buttons. Forces a camera update + render so
// zoom responds while paused.
function setZoomLevel(level) {
    state.zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
    updateCameraPosition(1 / 60); // Immediately step the camera toward the new target
    if (state.renderer && state.scene && state.camera) { // Ensure renderer is ready
        state.renderer.render(state.scene, state.camera); // Re-render if paused to show zoom change
    }
}

// Handles the zoom button clicks.
export function zoomIn() {
    setZoomLevel(state.zoomLevel / ZOOM_STEP);
}

export function zoomOut() {
    setZoomLevel(state.zoomLevel * ZOOM_STEP);
}
