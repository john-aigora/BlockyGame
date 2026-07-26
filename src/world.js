import * as THREE from 'three';
import { worldSize, collectibleSpawnRadius, ZOOM_OUT_FACTOR } from './constants.js';
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

// Updates camera position to follow the player.
export function updateCameraPosition() {
    if (!state.player || !state.camera) return; // Check for player and camera
    const cameraOffset = new THREE.Vector3(0, state.activeCameraYOffset, state.activeCameraZOffset);
    state.camera.position.copy(state.player.position).add(cameraOffset);
    state.camera.lookAt(state.player.position);
}

// Handles the zoom out button click.
export function zoomOutCamera() {
    state.activeCameraYOffset *= ZOOM_OUT_FACTOR;
    state.activeCameraZOffset *= ZOOM_OUT_FACTOR;
    console.log(`Zoomed Out. New YOffset: ${state.activeCameraYOffset}, New ZOffset: ${state.activeCameraZOffset}`);
    updateCameraPosition(); // Immediately update camera position
    if (state.renderer && state.scene && state.camera) { // Ensure renderer is ready
        state.renderer.render(state.scene, state.camera); // Re-render if paused to show zoom change
    }
}
