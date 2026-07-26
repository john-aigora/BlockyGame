import * as THREE from 'three';
import {
    worldSize, collectibleSpawnRadius,
    ZOOM_STEP, ZOOM_MIN, ZOOM_MAX, GROWTH_FRAME_FACTOR,
    INITIAL_CAMERA_Y_OFFSET, INITIAL_CAMERA_Z_OFFSET
} from './constants.js';
import { state } from './state.js';

// --- World Creation ---
// Builds the scene, camera, renderer, lights, and ground plane.
// Returns the directional light so init() can point it at the player.
export function createWorld() {
    // 1. Scene: The container for all 3D objects.
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x004D40); // Dark Teal background
    state.scene.fog = new THREE.Fog(0x004D40, 20, 100); // Fog for depth perception

    // 2. Camera: Defines the viewpoint.
    // PerspectiveCamera(fov, aspect_ratio, near_clipping_plane, far_clipping_plane)
    const aspect = state.gameContainer.clientWidth / state.gameContainer.clientHeight;
    state.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    state.camera.position.set(0, 15, 10); // Initial camera position (x, y, z)
    state.camera.lookAt(0, 0, 0); // Camera looks at the center of the scene

    // 3. Renderer: Draws the scene from the camera's perspective.
    state.renderer = new THREE.WebGLRenderer({ antialias: true }); // antialias for smoother edges
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
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x004D40, side: THREE.DoubleSide }); // Dark Teal
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
    state.camera.position.set(
        state.player.position.x,
        state.player.position.y + state.camY,
        state.player.position.z + state.camZ
    );
    state.camera.lookAt(state.player.position);
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
