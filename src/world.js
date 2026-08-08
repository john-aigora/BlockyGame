import * as THREE from 'three';
import {
    worldSize, collectibleSpawnRadius,
    ZOOM_STEP, ZOOM_MIN, ZOOM_MAX, GROWTH_FRAME_FACTOR,
    INITIAL_CAMERA_Y_OFFSET, INITIAL_CAMERA_Z_OFFSET,
    SHAKE_DURATION, SHAKE_AMPLITUDE,
    ATTRACT_ORBIT_PERIOD, ATTRACT_EASE_TIME, CAMERA_TERRAIN_CLEARANCE
} from './constants.js';
import { state } from './state.js';
// Import cycle note: terrain.js imports makeGroundTexture from this module,
// and enemies.js imports triggerKillShake while we import its per-viewer
// paint (plan 026). All edges are function-references used at call time
// (never during module evaluation), so the cycles are benign under ES modules.
import { groundHeightAt } from './terrain.js';
import { applyEdibilityTint } from './enemies.js';

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
// Exported for terrain.js: endless chunks reuse the SAME canvas art,
// world-UV-mapped per vertex (their own texture instance, repeat 1).
export const GROUND_TILE = 20; // world units per canvas tile — must divide worldSize
let groundTexture = null;

export function makeGroundTexture(renderer) {
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

    // 2. Camera: Defines the viewpoint. Seat 0's camera IS state.camera
    // (createCameraFor syncs the alias); 2P adds a second via the same path.
    createCameraFor(state.players[0]);

    // 3. Renderer: Draws the scene from the camera's perspective.
    // MOBILE TIER (plan 020 P-10): coarse-pointer devices trade MSAA, the
    // retina DPR cap, and shadows for frame rate — phone GPUs were paying
    // desktop-tier fill cost on a 6x smaller screen. init() resolves
    // state.isMobile BEFORE calling createWorld (ordering contract).
    state.renderer = new THREE.WebGLRenderer({ antialias: !state.isMobile });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, state.isMobile ? 1.5 : 2)); // Desktop cap 2 — dpr 3+ costs GPU for invisible gains
    state.renderer.setSize(state.gameContainer.clientWidth, state.gameContainer.clientHeight);
    state.renderer.shadowMap.enabled = !state.isMobile; // Shadows are a desktop luxury
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

// --- Split-screen layout (plan 026) ---
// One canvas, two viewports: P1 LEFT half, P2 RIGHT half, one shared scene,
// one camera per player. Solo keeps the EXACT single full-rect render path
// (no scissor calls at all) so one-player play is bit-identical.
function isSplitScreen() {
    return state.players.length >= 2;
}

// The aspect each player camera should carry under the current layout.
// The start overlay is SINGLE-VIEW by design even with two players selected
// (renderFrame's splitLive gate falls through to the full-rect attract
// render there), so its cameras must carry the FULL aspect — a half aspect
// projected into the full rect stretched the title world 2x horizontally
// (B8 review BLOCK-3). startRun/setupNewGame re-apply aspects on both
// overlay transitions via onWindowResize.
function viewAspect() {
    const w = state.gameContainer.clientWidth;
    const h = state.gameContainer.clientHeight;
    return isSplitScreen() && !state.onStartScreen ? (w / 2) / h : w / h;
}

// Builds (or rebuilds the aspect of) the camera for one player slot; keeps
// the classic state.camera alias pointed at seat 0's camera.
export function createCameraFor(playerState) {
    // PerspectiveCamera(fov, aspect_ratio, near_clipping_plane, far_clipping_plane)
    const camera = new THREE.PerspectiveCamera(75, viewAspect(), 0.1, 1000);
    camera.position.set(0, 15, 10); // Initial camera position (x, y, z)
    camera.lookAt(0, 0, 0); // Camera looks at the center of the scene
    playerState.camera = camera;
    if (playerState === state.players[0]) state.camera = camera;
    return camera;
}

// Handles window resize events (and 1P/2P layout flips) to keep the game
// looking correct.
export function onWindowResize() {
    if (!state.gameContainer || !state.renderer) return; // Ensure elements are initialized

    const newWidth = state.gameContainer.clientWidth;
    const newHeight = state.gameContainer.clientHeight;

    for (const player of state.players) {
        if (!player.camera) continue;
        player.camera.aspect = viewAspect(); // Per-half aspect in 2P; full-rect solo
        player.camera.updateProjectionMatrix(); // Apply changes to camera
    }
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, state.isMobile ? 1.5 : 2)); // Same tier rule as createWorld; the window may have moved displays
    state.renderer.setSize(newWidth, newHeight); // Resize renderer
}

// The camera offset the current zoom level and THIS player's size ask for.
// Growth compensation pulls the camera back as the player grows so the
// player never dominates the screen.
function cameraTargets(player) {
    const growthComp = 1 + (player.scale - 1) * GROWTH_FRAME_FACTOR;
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

const lookTarget = new THREE.Vector3(); // Scratch for the smoothed lookAt

// Updates every player camera (plan 026): each follows ITS hero, easing the
// offset toward the zoom/growth target, with the attract orbit on camera 0
// only. dt is the frame delta in seconds; callers outside the frame loop
// (e.g. zoom clicks while paused) pass 1/60.
export function updateCameraPosition(dt) {
    // Kill micro-shake decays ONCE per frame (both cameras thump together —
    // a kill is a world event); the per-camera jitter is applied below.
    if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);
    // Attract state advances once per frame too — it belongs to camera 0.
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
    for (const player of state.players) {
        updateCameraForPlayer(player, dt);
    }
    // Scene fog is per-render-pass in 2P (renderFrame overrides per half);
    // between frames it carries seat 0's framing — the solo behavior.
    updateFog(state.players[0]);
}

function updateCameraForPlayer(player, dt) {
    if (!player.mesh || !player.camera) return; // Check for player and camera
    const target = cameraTargets(player);
    const smoothing = 1 - Math.exp(-6 * dt);
    player.camY += (target.y - player.camY) * smoothing;
    player.camZ += (target.z - player.camZ) * smoothing;

    const p = player.mesh.position;
    // Vertical follow base: classic is the raw player y (always 0); endless
    // eases toward the terrain height under the player.
    let followY = p.y;
    if (state.worldMode === 'endless') {
        // Follow the TERRAIN under the player, not the jump arc: subtracting
        // jump.offset keeps the camera glued to the ground line so a hop
        // reads through the player, not as a camera bounce.
        player.camAnchorY += ((p.y - player.jump.offset) - player.camAnchorY) * (1 - Math.exp(-4 * dt));
        followY = player.camAnchorY;
    }
    let camX = p.x; // Gameplay framing: the behind-view
    let camYpos = followY + player.camY;
    let camZpos = p.z + player.camZ;
    // Attract orbit is CAMERA 0 only (plan 026: the title scene stays
    // single-view); the P2 camera never blends.
    if (attractBlend > 0 && player.seat === 0) {
        // Orbit at the CURRENT framing distance (camY/camZ keep easing above,
        // so zoom and player growth still frame correctly mid-orbit).
        const k = attractBlend * attractBlend * (3 - 2 * attractBlend); // Smoothstep
        const bob = 1 + 0.06 * Math.sin(attractBob * 0.7); // Gentle height breath
        camX += (p.x + Math.sin(attractAngle) * player.camZ - camX) * k;
        camYpos += (followY + player.camY * bob - camYpos) * k;
        camZpos += (p.z + Math.cos(attractAngle) * player.camZ - camZpos) * k;
    }
    if (state.worldMode === 'endless') {
        // Terrain clearance (stage 3): the camera — attract orbit included —
        // never dips below the hill under it. At default framing the offset
        // clears every possible crest with room to spare, so this is a
        // guard rail for the close-zoom + tall-hill corner, not a per-frame
        // course correction; terrain is smooth, so when it does engage the
        // lift is continuous (no pop).
        const camGround = groundHeightAt(camX, camZpos);
        if (camYpos < camGround + CAMERA_TERRAIN_CLEARANCE) {
            camYpos = camGround + CAMERA_TERRAIN_CLEARANCE;
        }
    }
    player.camera.position.set(camX, camYpos, camZpos);
    if (state.worldMode === 'endless') {
        // Aim at the smoothed height too — aiming at the raw p.y would put
        // the crest jolt right back into the frame.
        player.camera.lookAt(lookTarget.set(p.x, followY, p.z));
    } else {
        player.camera.lookAt(p);
    }
    // Kill micro-shake: additive offset AFTER lookAt, so the camera jitters
    // in place without re-aiming — a punchy 0.12s thump, not a swing. The
    // amplitude decays linearly to zero; at ~7 frames total this is far from
    // any strobe, and reduced-motion users never get here (triggerKillShake).
    if (shakeTime > 0) {
        const amp = SHAKE_AMPLITUDE * (shakeTime / SHAKE_DURATION);
        player.camera.position.x += (Math.random() * 2 - 1) * amp;
        player.camera.position.y += (Math.random() * 2 - 1) * amp;
        player.camera.position.z += (Math.random() * 2 - 1) * amp;
    }
}

// Fog follows the camera distance so the game stays visible at every zoom
// level, with the same depth-haze character as the original fixed 20/100.
// Takes the VIEWING player (plan 026): renderFrame re-aims the one scene
// fog before each half's render pass.
function updateFog(player) {
    if (!state.scene || !state.scene.fog || !player) return;
    const camDist = Math.hypot(player.camY, player.camZ);
    state.scene.fog.near = camDist * 1.1;
    state.scene.fog.far = camDist * 4.5;
}

// --- Frame render (plan 026) ---
// Solo (or the single-view attract screen): the EXACT pre-split path — one
// full-rect render, scissor test untouched. 2P: left/right halves with
// viewport + scissor set together per pass, each with its own camera + fog.
export function renderFrame() {
    const renderer = state.renderer;
    if (!renderer || !state.scene) return;
    const p2 = state.players[1];
    const splitLive = isSplitScreen() && p2.camera && !state.onStartScreen;
    if (!splitLive) {
        if (scissorActive) {
            // Leaving split rendering (death screen keeps both halves, so
            // this is the overlay/solo return): restore the full rect once.
            scissorActive = false;
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, state.gameContainer.clientWidth, state.gameContainer.clientHeight);
        }
        renderer.render(state.scene, state.camera);
        return;
    }
    const w = state.gameContainer.clientWidth;
    const h = state.gameContainer.clientHeight;
    const halfW = Math.floor(w / 2);
    const p1 = state.players[0];
    // Spectator halves (plan 026 Stage E): a dead hero's half shows the
    // LIVING partner's camera (under the WAITING chip) until both are down
    // — then each half freezes on its own last view behind the death screen.
    const p1View = p1.alive || !p2.alive ? p1 : p2;
    const p2View = p2.alive || !p1.alive ? p2 : p1;
    scissorActive = true;
    renderer.setScissorTest(true);
    // P1 — LEFT half
    renderer.setViewport(0, 0, halfW, h);
    renderer.setScissor(0, 0, halfW, h);
    updateFog(p1View);
    applyEdibilityTint(p1View); // This half's colors = this viewer's edibility
    renderer.render(state.scene, p1View.camera);
    // P2 — RIGHT half
    renderer.setViewport(halfW, 0, w - halfW, h);
    renderer.setScissor(halfW, 0, w - halfW, h);
    updateFog(p2View);
    applyEdibilityTint(p2View);
    renderer.render(state.scene, p2View.camera);
}

let scissorActive = false; // True while the last frame rendered split halves

// Resets the zoom for a new game and snaps every camera straight to the
// default framing (no lerp-in from the previous game's zoom).
export function resetCameraZoom() {
    state.zoomLevel = 1.0;
    shakeTime = 0; // A new run never inherits the last kill's shake
    for (const player of state.players) {
        player.camAnchorY = player.mesh ? player.mesh.position.y : 0; // Snap the vertical follow — no lerp-in from the last run's hill
        const target = cameraTargets(player);
        player.camY = target.y;
        player.camZ = target.z;
    }
    updateFog(state.players[0]);
}

// Clamped zoom, shared by both buttons. Forces a camera update + render so
// zoom responds while paused.
function setZoomLevel(level) {
    state.zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
    updateCameraPosition(1 / 60); // Immediately step the cameras toward the new target
    if (state.renderer && state.scene && state.camera) { // Ensure renderer is ready
        renderFrame(); // Re-render if paused to show zoom change
    }
}

// Handles the zoom button clicks.
export function zoomIn() {
    setZoomLevel(state.zoomLevel / ZOOM_STEP);
}

export function zoomOut() {
    setZoomLevel(state.zoomLevel * ZOOM_STEP);
}
