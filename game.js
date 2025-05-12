// --- Global Variables ---
// Scene, camera, and renderer are fundamental to Three.js
let scene, camera, renderer;
// Game objects
let player, enemy, ground;
let collectibles = []; // Array to store collectible items
// Game state
let score = 0;
let gameActive = false;
let playerScale = 1; // Track player's current scale
let isPaused = false; // Track if game is paused
const growthFactor = 0.1; // How much to grow by each block
const enemyBaseHeight = 1.2; // Base height of enemy
let enemies = []; // Array to store multiple enemies
let canKillEnemy = false; // Track if player is big enough to kill enemies
let killIndicatorVisible = false; // For flashing kill indicator

// Speed Multiplier Variables
const speedMultipliers = [1.0, 1.5, 2.0, 3.0, 5.0, 0.5]; // ADDED 5.0x, re-ordered
let currentSpeedMultiplierIndex = 0;
let actualPlayerSpeed; // Will store the fully adjusted player speed
let actualEnemySpeed;  // Will store the fully adjusted enemy speed

// Zoom Variables
let currentZoomLevel = 1.0; // 1.0 for normal, 1.5 for zoomed out
const NORMAL_CAMERA_Y_OFFSET = 15;
const ZOOMED_OUT_CAMERA_Y_OFFSET = NORMAL_CAMERA_Y_OFFSET * 1.5;
const NORMAL_CAMERA_Z_OFFSET = 12;
const ZOOMED_OUT_CAMERA_Z_OFFSET = NORMAL_CAMERA_Z_OFFSET * 1.5;
let activeCameraYOffset = NORMAL_CAMERA_Y_OFFSET; // To store current offset
let activeCameraZOffset = NORMAL_CAMERA_Z_OFFSET; // To store current offset

// Movement and speed constants
const BASE_PLAYER_SPEED = 0.05; // Player speed reduced to 1/4 of previous base
const MOBILE_SPEED_MULTIPLIER = 1.75; // Player is 75% faster on mobile than desktop base
let playerSpeed; // To be set in init
let enemySpeed;  // To be set in init
const keys = {}; // Object to keep track of currently pressed keys
// NEW Joystick Variables - repurposed for touch-anywhere
let touchActive = false;
let gameScreenContainer;
let touchStartPoint = { x: 0, y: 0 };
let currentTouchPoint = { x: 0, y: 0 };
let movementVector = { x: 0, y: 0 };
const MAX_DRAG_DISTANCE = 75;
const DEAD_ZONE_RADIUS = 10;
// World and spawning parameters
const worldSize = 200; // Defines the size of the ground plane (illusion of infinite space)
const worldBoundary = worldSize / 2; // Define world boundary for wrapping
let targetCollectiblesOnScreen = 15; // How many collectibles should be active at once
const initialFoodDensityArea = 1000; // Target one food item per this many square units for initial spawn
const collectibleSpawnRadius = 30; // How far from the player new collectibles can appear
const minSpawnDistanceFromPlayer = 5; // Minimum distance a new collectible spawns from player
const enemyStartOffset = 10; // Initial distance of enemy from player
const maxEnemyTeleportDistance = 40; // If enemy is further than this, it teleports
const engagementRadius = 15; // Enemies within this radius will try to orbit
const orbitStrengthFactor = 0.4; // How strongly enemies try to orbit (0 to 1)
const enemyRandomDriftFactor = 0.3; // How strong the random drift is, relative to enemySpeed

// HTML Element references
let gameContainer; // The div that will hold the Three.js canvas
let animationFrameId; // ID for the animation loop, used for potential cancellation

// Collect Timer variables
const initialCollectTime = 15; // MODIFIED from 10 to 15 seconds
let collectTimerValue = initialCollectTime;
let collectTimerInterval; // Stores the interval ID for the collect timer

let isMobile = false; // For mobile-specific adjustments

// --- Initialization Function ---
// This function sets up the entire game scene, objects, and event listeners.
function init() {
    gameContainer = document.getElementById('game-container');
    if (!gameContainer) {
        console.error('Game container not found!');
        return;
    }

    // Mobile detection and speed adjustment
    isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || /Mobi|Android/i.test(navigator.userAgent);
    if (isMobile) {
        playerSpeed = BASE_PLAYER_SPEED * MOBILE_SPEED_MULTIPLIER;
        console.log("Mobile device detected. Player speed adjusted to:", playerSpeed);
    } else {
        playerSpeed = BASE_PLAYER_SPEED;
        console.log("Desktop device detected. Player speed base:", playerSpeed);
    }
    // REMOVED: enemySpeed = playerSpeed * 0.5; // This is now handled by applySpeedMultiplier
    // console.log("Enemy speed set to:", enemySpeed);

    applySpeedMultiplier(); // Apply initial speed multiplier
    applyZoomLevel(); // Apply initial zoom level and set button text

    // 1. Scene: The container for all 3D objects.
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x004D40); // Dark Teal background
    scene.fog = new THREE.Fog(0x004D40, 20, 100); // Fog for depth perception

    // 2. Camera: Defines the viewpoint.
    // PerspectiveCamera(fov, aspect_ratio, near_clipping_plane, far_clipping_plane)
    const aspect = gameContainer.clientWidth / gameContainer.clientHeight;
    camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    camera.position.set(0, 15, 10); // Initial camera position (x, y, z)
    camera.lookAt(0, 0, 0); // Camera looks at the center of the scene

    // 3. Renderer: Draws the scene from the camera's perspective.
    renderer = new THREE.WebGLRenderer({ antialias: true }); // antialias for smoother edges
    renderer.setSize(gameContainer.clientWidth, gameContainer.clientHeight);
    renderer.shadowMap.enabled = true; // Enable shadows in the scene
    // Add the renderer's canvas element to the game container div
    gameContainer.insertBefore(renderer.domElement, gameContainer.firstChild);

    // 4. Lighting: Illuminates the scene.
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Soft white light, illuminates all objects equally
    scene.add(ambientLight);

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
    scene.add(directionalLight);

    // 5. Ground Plane: The surface the player and objects are on.
    const groundGeometry = new THREE.PlaneGeometry(worldSize, worldSize);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x004D40, side: THREE.DoubleSide }); // Dark Teal
    ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2; // Rotate to be flat on XZ plane
    ground.receiveShadow = true; // Ground can receive shadows
    scene.add(ground);

    // 6. Player and Enemy Objects
    createPlayer();
    createEnemy();
    directionalLight.target = player; // Make the directional light follow the player for consistent shadows

    // 7. Event Listeners for user input and window resizing.
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onWindowResize);
    document.getElementById('restart-button').addEventListener('click', resetGame);
    document.getElementById('restart-game-button').addEventListener('click', resetGame);

    // Add event listeners for pause and restart buttons
    document.getElementById('pause-button').addEventListener('click', togglePause);
    document.getElementById('speed-cycle-button').addEventListener('click', cycleSpeed);
    document.getElementById('zoom-toggle-button').addEventListener('click', toggleZoom);

    // NEW Touch Anywhere Event Listeners
    gameScreenContainer = document.getElementById('game-container'); // Control area

    if (gameScreenContainer) {
        gameScreenContainer.addEventListener('touchstart', (e) => {
            const targetElement = e.target;
            if (!targetElement.closest('button')) {
                e.preventDefault();
            }
            if (e.touches.length > 0) {
                touchActive = true;
                touchStartPoint.x = e.touches[0].clientX;
                touchStartPoint.y = e.touches[0].clientY;
                currentTouchPoint.x = e.touches[0].clientX;
                currentTouchPoint.y = e.touches[0].clientY;
                updateMovementVector();
            }
        });

        gameScreenContainer.addEventListener('touchmove', (e) => {
            if (touchActive) {
                e.preventDefault();
            }
            if (touchActive && e.touches.length > 0) {
                currentTouchPoint.x = e.touches[0].clientX;
                currentTouchPoint.y = e.touches[0].clientY;
                updateMovementVector();
            }
        });

        const onTouchEndOrCancel = (e) => {
            if (touchActive) {
                touchActive = false;
                movementVector = { x: 0, y: 0 };
            }
        };

        gameScreenContainer.addEventListener('touchend', onTouchEndOrCancel);
        gameScreenContainer.addEventListener('touchcancel', onTouchEndOrCancel);
    } else {
        console.warn("Game container element not found for touch controls!");
    }

    // 8. Initial Game Setup
    setupNewGame();

    // 9. Start the Animation Loop
    // This function will be called repeatedly to update and render the game.
    animate();

    console.log('Game initialized successfully');
}

// --- Setup New Game ---
// Resets game state for a new session (called by init and when restarting).
function setupNewGame() {
    gameActive = true;
    isPaused = true; // Start the game in a paused state
    score = 0;
    playerScale = 1.0; // Player's initial scale (acts as height for 1x1x1 geometry)
    document.getElementById('score').textContent = score;

    // Set initial state for the pause button
    const pauseButton = document.getElementById('pause-button');
    if (pauseButton) {
        pauseButton.textContent = 'Resume';
        pauseButton.classList.add('paused');
    }

    collectibles.forEach(c => scene.remove(c));
    collectibles = [];
    enemies.forEach(e => scene.remove(e));
    enemies = [];

    if (player) {
        player.position.set(0, 0, 0); // MODIFIED: Group origin at feet
        player.scale.set(playerScale, playerScale, playerScale);
    } else {
        createPlayer(); // createPlayer sets scale to playerScale by default
    }

    // Create initial enemy, 50% taller than player
    const firstEnemy = createEnemy();
    const initialPlayerActualHeight = playerScale * 1.0; // Player's geometry height is 1
    const firstEnemyTargetHeight = initialPlayerActualHeight * 1.5;
    // enemyBaseHeight is the enemy's unscaled geometry height (1.2)
    const firstEnemyScaleFactor = firstEnemyTargetHeight / enemyBaseHeight;
    firstEnemy.scale.set(firstEnemyScaleFactor, firstEnemyScaleFactor, firstEnemyScaleFactor);
    firstEnemy.position.y = 0; // MODIFIED: Group origin is at feet level

    if (enemies.length > 0) {
        enemies[0].position.x = player.position.x + enemyStartOffset;
        enemies[0].position.z = player.position.z + enemyStartOffset;
    }

    // Calculate initial food count based on density
    const initialFoodCount = Math.floor((worldSize * worldSize) / initialFoodDensityArea);
    targetCollectiblesOnScreen = initialFoodCount; // Update the target to maintain this density

    for (let i = 0; i < initialFoodCount; i++) {
        spawnCollectibleAnywhere(); // Use new function for initial even distribution
    }

    for (const key in keys) {
        keys[key] = false;
    }
    hideMessage();

    // Initialize the collect timer display, but don't start the interval yet.
    // The timer will start when the player first unpauses.
    collectTimerValue = initialCollectTime;
    document.getElementById('collect-time').textContent = collectTimerValue;
    // startCollectTimer(); //  Timer will be started by togglePause when unpausing
}


// --- Game Object Creation Functions ---
function createPlayer() {
    if (player) {
        scene.remove(player); // Remove old player group if it exists
    }
    const playerGroup = new THREE.Group();
    const playerBaseSize = 1.0;

    // --- Define Dimensions ---
    const legHeight = playerBaseSize * 0.3;
    const legWidth = playerBaseSize * 0.15;
    const eyeSize = playerBaseSize * 0.1;
    const mouthWidth = playerBaseSize * 0.4;
    const mouthHeight = playerBaseSize * 0.08;
    const mouthDepth = playerBaseSize * 0.05;
    const facePartDepthOffset = 0.01; // How much eyes/mouth stick out

    // --- Materials ---
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xFF4500 }); // Bright Orange-Red
    const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 }); // Black

    // --- Body Mesh ---
    const bodyGeometry = new THREE.BoxGeometry(playerBaseSize, playerBaseSize, playerBaseSize);
    const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
    bodyMesh.castShadow = true;
    bodyMesh.position.y = legHeight + (playerBaseSize / 2); // Center of body above legs
    playerGroup.add(bodyMesh);

    // --- Leg Meshes (x4) ---
    const legGeometry = new THREE.BoxGeometry(legWidth, legHeight, legWidth);
    const legPositions = [
        { x: -playerBaseSize / 2 + legWidth / 2 + legWidth * 0.5, z: -playerBaseSize / 2 + legWidth / 2 + legWidth * 0.5 },
        { x: playerBaseSize / 2 - legWidth / 2 - legWidth * 0.5, z: -playerBaseSize / 2 + legWidth / 2 + legWidth * 0.5 },
        { x: -playerBaseSize / 2 + legWidth / 2 + legWidth * 0.5, z: playerBaseSize / 2 - legWidth / 2 - legWidth * 0.5 },
        { x: playerBaseSize / 2 - legWidth / 2 - legWidth * 0.5, z: playerBaseSize / 2 - legWidth / 2 - legWidth * 0.5 }
    ];

    legPositions.forEach(pos => {
        const leg = new THREE.Mesh(legGeometry, bodyMaterial);
        leg.castShadow = true;
        leg.position.set(pos.x, legHeight / 2, pos.z);
        playerGroup.add(leg);
    });

    // --- Eye Meshes (x2) ---
    const eyeGeometry = new THREE.BoxGeometry(eyeSize, eyeSize, eyeSize);
    const eyeY = bodyMesh.position.y + playerBaseSize * 0.15;
    const eyeXSpacing = playerBaseSize * 0.2;
    // Place on body's local +Z face (player moves in -Z for up, +Z for down, so +Z is typically a side)
    // For simplicity, let's assume player faces world +Z when starting / looking forward.
    const eyeZOffset = playerBaseSize / 2 + eyeSize / 2 - facePartDepthOffset;

    const leftEye = new THREE.Mesh(eyeGeometry, faceMaterial);
    leftEye.position.set(-eyeXSpacing, eyeY, bodyMesh.position.z + eyeZOffset); // Relative to body's center + offset for face
    leftEye.castShadow = true;
    playerGroup.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeometry, faceMaterial);
    rightEye.position.set(eyeXSpacing, eyeY, bodyMesh.position.z + eyeZOffset); // Relative to body's center + offset for face
    rightEye.castShadow = true;
    playerGroup.add(rightEye);

    // --- Mouth Mesh ---
    const mouthGeometry = new THREE.BoxGeometry(mouthWidth, mouthHeight, mouthDepth);
    const mouthMesh = new THREE.Mesh(mouthGeometry, faceMaterial);
    const mouthY = bodyMesh.position.y - playerBaseSize * 0.2;
    const mouthZOffset = playerBaseSize / 2 + mouthDepth / 2 - facePartDepthOffset;
    mouthMesh.position.set(0, mouthY, bodyMesh.position.z + mouthZOffset); // Relative to body's center + offset for face
    mouthMesh.castShadow = true;
    playerGroup.add(mouthMesh);

    // Assign to global player variable
    player = playerGroup;
    player.castShadow = true; // Group casts shadow
    player.position.y = 0; // Group's origin at feet level on the ground
    player.scale.set(playerScale, playerScale, playerScale); // Apply initial/current scale
    scene.add(player);
}

function createEnemy() {
    const enemyGroup = new THREE.Group();

    // --- Define Dimensions based on enemyBaseHeight (1.2) ---
    const legHeight = enemyBaseHeight * 0.3; // e.g., 0.36
    const legWidth = enemyBaseHeight * 0.15; // e.g., 0.18
    const eyeSize = enemyBaseHeight * 0.1;   // e.g., 0.12
    const mouthWidth = enemyBaseHeight * 0.4; // e.g., 0.48
    const mouthHeight = enemyBaseHeight * 0.08;// e.g., 0.096
    const mouthDepth = enemyBaseHeight * 0.05; // e.g., 0.06
    const facePartDepthOffset = 0.01; // How much eyes/mouth stick out or in

    // --- Materials ---
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x03A9F4 }); // Electric Blue
    const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 }); // Dark Grey

    // --- Body Mesh ---
    const bodyGeometry = new THREE.BoxGeometry(enemyBaseHeight, enemyBaseHeight, enemyBaseHeight);
    const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
    bodyMesh.name = 'body'; // Assign a name to easily access it later for color changes
    bodyMesh.castShadow = true;
    // Position body so its center is enemyBaseHeight/2 + legHeight above the group's origin (floor)
    bodyMesh.position.y = legHeight + (enemyBaseHeight / 2);
    enemyGroup.add(bodyMesh);

    // --- Leg Meshes (x4) ---
    const legGeometry = new THREE.BoxGeometry(legWidth, legHeight, legWidth);
    const legPositions = [
        { x: -enemyBaseHeight / 2 + legWidth / 2 + legWidth * 0.5, z: -enemyBaseHeight / 2 + legWidth / 2 + legWidth * 0.5 }, // Front-left
        { x: enemyBaseHeight / 2 - legWidth / 2 - legWidth * 0.5, z: -enemyBaseHeight / 2 + legWidth / 2 + legWidth * 0.5 },  // Front-right
        { x: -enemyBaseHeight / 2 + legWidth / 2 + legWidth * 0.5, z: enemyBaseHeight / 2 - legWidth / 2 - legWidth * 0.5 },  // Back-left
        { x: enemyBaseHeight / 2 - legWidth / 2 - legWidth * 0.5, z: enemyBaseHeight / 2 - legWidth / 2 - legWidth * 0.5 }   // Back-right
    ];

    legPositions.forEach(pos => {
        const leg = new THREE.Mesh(legGeometry, bodyMaterial); // Legs use body material
        leg.castShadow = true;
        leg.position.set(pos.x, legHeight / 2, pos.z); // Leg base at y=0 of leg, so center at legHeight/2
        enemyGroup.add(leg);
    });

    // --- Eye Meshes (x2) ---
    const eyeGeometry = new THREE.BoxGeometry(eyeSize, eyeSize, eyeSize);
    const eyeY = bodyMesh.position.y + enemyBaseHeight * 0.15; // Position eyes on upper part of body
    const eyeXSpacing = enemyBaseHeight * 0.2;
    const eyeZOffset = enemyBaseHeight / 2 + eyeSize / 2 - facePartDepthOffset; // Place on front face of body

    const leftEye = new THREE.Mesh(eyeGeometry, faceMaterial);
    leftEye.position.set(-eyeXSpacing, eyeY, eyeZOffset);
    leftEye.castShadow = true;
    enemyGroup.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeometry, faceMaterial);
    rightEye.position.set(eyeXSpacing, eyeY, eyeZOffset);
    rightEye.castShadow = true;
    enemyGroup.add(rightEye);

    // --- Mouth Mesh ---
    const mouthGeometry = new THREE.BoxGeometry(mouthWidth, mouthHeight, mouthDepth);
    const mouthMesh = new THREE.Mesh(mouthGeometry, faceMaterial);
    const mouthY = bodyMesh.position.y - enemyBaseHeight * 0.2;
    const mouthZOffset = enemyBaseHeight / 2 + mouthDepth / 2 - facePartDepthOffset; // Place on front face
    mouthMesh.position.set(0, mouthY, mouthZOffset);
    mouthMesh.castShadow = true;
    enemyGroup.add(mouthMesh);

    // --- Enemy Group Properties ---
    enemyGroup.castShadow = true; // Though individual parts cast, good to set for group if needed

    enemyGroup.randomVelocity = new THREE.Vector3(0, 0, 0);
    enemyGroup.timeToChangeRandomVelocity = Math.random() * 2 + 1;
    enemyGroup.orbitDirection = Math.random() < 0.5 ? 1 : -1;

    scene.add(enemyGroup);
    enemies.push(enemyGroup);
    return enemyGroup;
}

function spawnNewCollectible() {
    if (!player) return; // Can't spawn relative to non-existent player

    const collectibleGeometry = new THREE.BoxGeometry(0.7, 0.7, 0.7); // Smaller cube
    const collectibleMaterial = new THREE.MeshStandardMaterial({ color: 0x76FF03 }); // Lime Green for collectibles (food)
    const collectible = new THREE.Mesh(collectibleGeometry, collectibleMaterial);

    let spawnX, spawnZ;
    let distanceToPlayer;
    // Keep trying to find a spawn position until it's not too close to the player
    do {
        // Random position within a square area around the player
        spawnX = player.position.x + (Math.random() * collectibleSpawnRadius * 2) - collectibleSpawnRadius;
        spawnZ = player.position.z + (Math.random() * collectibleSpawnRadius * 2) - collectibleSpawnRadius;
        distanceToPlayer = Math.sqrt(Math.pow(spawnX - player.position.x, 2) + Math.pow(spawnZ - player.position.z, 2));
    } while (distanceToPlayer < minSpawnDistanceFromPlayer);

    collectible.position.set(spawnX, 0.35, spawnZ); // Position on the ground
    collectible.castShadow = true;
    collectible.receiveShadow = true; // Though small, good practice
    collectibles.push(collectible);
    scene.add(collectible);
}

// NEW FUNCTION to spawn a collectible anywhere in the world
function spawnCollectibleAnywhere() {
    const collectibleGeometry = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    const collectibleMaterial = new THREE.MeshStandardMaterial({ color: 0x76FF03 }); // Lime Green
    const collectible = new THREE.Mesh(collectibleGeometry, collectibleMaterial);

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

    collectible.position.set(spawnX, 0.35, spawnZ); // Position on the ground
    collectible.castShadow = true;
    collectible.receiveShadow = true;
    collectibles.push(collectible);
    scene.add(collectible);
}

// NEW FUNCTION to spawn a collectible at a specific position (e.g., enemy death)
function spawnCollectibleAtPosition(position) {
    const collectibleGeometry = new THREE.BoxGeometry(0.7, 0.7, 0.7); // Standard collectible size
    const collectibleMaterial = new THREE.MeshStandardMaterial({ color: 0x76FF03 }); // Lime Green (current food color)
    const collectible = new THREE.Mesh(collectibleGeometry, collectibleMaterial);

    // Scatter the particle slightly around the given position
    const scatterRange = 1.5; // How far the particles can scatter
    collectible.position.set(
        position.x + (Math.random() - 0.5) * scatterRange * 2,
        0.35, // On the ground
        position.z + (Math.random() - 0.5) * scatterRange * 2
    );

    collectible.castShadow = true;
    collectible.receiveShadow = true;
    collectibles.push(collectible);
    scene.add(collectible);
}

// --- Collect Timer Functions ---
function startCollectTimer() {
    collectTimerValue = initialCollectTime;
    document.getElementById('collect-time').textContent = collectTimerValue;

    if (collectTimerInterval) { // Clear any existing interval
        clearInterval(collectTimerInterval);
    }

    collectTimerInterval = setInterval(() => {
        if (!gameActive) { // If game ends for another reason, stop this timer
            clearInterval(collectTimerInterval);
            return;
        }
        collectTimerValue--;
        document.getElementById('collect-time').textContent = collectTimerValue;

        if (collectTimerValue <= 0) { // Time ran out to collect a block
            clearInterval(collectTimerInterval);
            gameActive = false;
            showMessage(`GAME OVER! Failed to collect a block in time. Final Score: ${score}`);
        }
    }, 1000); // Update every second
}

function resetCollectTimer() {
    collectTimerValue = initialCollectTime;
    document.getElementById('collect-time').textContent = collectTimerValue;
    // The interval continues running, just the countdown value is reset.
}


// --- Event Handlers ---
// Handles key press down events.
function onKeyDown(event) {
    if (!gameActive) return; // Ignore input if game is over

    const key = event.key.toLowerCase();

    // Handle space bar for pause
    if (key === ' ' || key === 'space') {
        event.preventDefault(); // Prevent page scroll
        togglePause();
        return;
    }

    keys[key] = true; // Record that the key is pressed
    // Prevent default browser action for arrow keys (scrolling)
    if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        event.preventDefault();
    }
}

// Handles key release events.
function onKeyUp(event) {
    const key = event.key.toLowerCase();
    if (key !== ' ' && key !== 'space') { // Don't set space to false
        keys[key] = false; // Record that the key is released
    }
}

// Handles window resize events to keep the game looking correct.
function onWindowResize() {
    if (!gameContainer || !renderer || !camera) return; // Ensure elements are initialized

    const newWidth = gameContainer.clientWidth;
    const newHeight = gameContainer.clientHeight;

    camera.aspect = newWidth / newHeight; // Update camera aspect ratio
    camera.updateProjectionMatrix(); // Apply changes to camera
    renderer.setSize(newWidth, newHeight); // Resize renderer
}

// --- Game Logic Update Function ---
// This function is called every frame by animate() to update game state.
function update() {
    if (!player || isPaused) return;

    // Update kill indicator and enemy colors (visuals first)
    const anyEnemyKillable = enemies.some(enemy => canKillSpecificEnemy(enemy));
    const killIndicator = document.getElementById('kill-indicator');
    if (killIndicator) {
        if (anyEnemyKillable) {
            killIndicator.style.display = 'block';
            killIndicatorVisible = !killIndicatorVisible;
            killIndicator.style.opacity = killIndicatorVisible ? '1' : '0.3';
        } else {
            killIndicator.style.display = 'none';
        }
    }

    enemies.forEach((enemyGroup, index) => {
        const bodyMesh = enemyGroup.getObjectByName('body'); // Get the body mesh

        if (canKillSpecificEnemy(enemyGroup)) {
            if (bodyMesh) bodyMesh.material.color.setHex(0xFFEB3B); // Bright Yellow if killable
        } else {
            if (bodyMesh) bodyMesh.material.color.setHex(0x03A9F4); // Electric Blue otherwise
        }

        // --- Enemy AI: Movement Logic ---
        const distanceToPlayer = player.position.distanceTo(enemyGroup.position);

        // --- Random Movement Component ---
        enemyGroup.timeToChangeRandomVelocity -= (1 / 60); // Approximate delta time for 60FPS
        if (enemyGroup.timeToChangeRandomVelocity <= 0) {
            const randomStrength = actualEnemySpeed * enemyRandomDriftFactor; // USE actualEnemySpeed
            enemyGroup.randomVelocity.set(
                (Math.random() - 0.5) * 2 * randomStrength,
                0,
                (Math.random() - 0.5) * 2 * randomStrength
            );
            enemyGroup.timeToChangeRandomVelocity = Math.random() * 2 + 1;
        }

        // --- Chase and Orbit Logic ---
        const chaseDirection = new THREE.Vector3().subVectors(player.position, enemyGroup.position).normalize();
        let combinedMovement = new THREE.Vector3();

        if (distanceToPlayer < engagementRadius) {
            // --- Orbiting Behavior ---
            const orbitVector = new THREE.Vector3(-chaseDirection.z * enemyGroup.orbitDirection, 0, chaseDirection.x * enemyGroup.orbitDirection);
            const chaseComponent = chaseDirection.clone().multiplyScalar(1.0 - orbitStrengthFactor);
            const orbitComponent = orbitVector.normalize().multiplyScalar(orbitStrengthFactor);

            combinedMovement.add(chaseComponent).add(orbitComponent).normalize().multiplyScalar(actualEnemySpeed); // USE actualEnemySpeed
        } else {
            // --- Pure Chase Behavior (outside engagement radius) ---
            combinedMovement.copy(chaseDirection).multiplyScalar(actualEnemySpeed); // USE actualEnemySpeed
        }

        // Add random drift to the calculated movement
        combinedMovement.add(enemyGroup.randomVelocity);

        enemyGroup.position.add(combinedMovement);

        // Apply avoidance after all other movement calculations for this frame
        avoidOtherEnemies(enemyGroup, index);

        // Enemy Wrapping Logic
        if (enemyGroup.position.x > worldBoundary) enemyGroup.position.x = -worldBoundary + 0.1; // Add small offset to prevent immediate re-wrap issues
        if (enemyGroup.position.x < -worldBoundary) enemyGroup.position.x = worldBoundary - 0.1;
        if (enemyGroup.position.z > worldBoundary) enemyGroup.position.z = -worldBoundary + 0.1;
        if (enemyGroup.position.z < -worldBoundary) enemyGroup.position.z = worldBoundary - 0.1;

        // --- Collision Detection (with player) ---
        const playerBox = new THREE.Box3().setFromObject(player);
        const enemyBox = new THREE.Box3().setFromObject(enemyGroup); // enemyGroup is now the object
        if (playerBox.intersectsBox(enemyBox)) {
            if (canKillSpecificEnemy(enemyGroup)) {
                const enemyDeathPosition = enemyGroup.position.clone(); // Get position before removing

                scene.remove(enemyGroup);
                enemies.splice(index, 1);

                // Spawn 4 food particles
                for (let i = 0; i < 4; i++) {
                    spawnCollectibleAtPosition(enemyDeathPosition);
                }

                targetCollectiblesOnScreen++; // Increase the total food supply target

                spawnNewEnemies();
            } else {
                gameActive = false;
                clearInterval(collectTimerInterval);
                showMessage(`GAME OVER! The enemy caught you. Final Score: ${score}`);
                return; // Exit forEach loop and update function if game over
            }
        }
    });

    // Player movement and other game updates (ground, light, camera, collectibles)
    if (gameActive) {
        // Keyboard movement (can coexist or be removed)
        if (keys['arrowup']) player.position.z -= actualPlayerSpeed; // USE actualPlayerSpeed
        if (keys['arrowdown']) player.position.z += actualPlayerSpeed; // USE actualPlayerSpeed
        if (keys['arrowleft']) player.position.x -= actualPlayerSpeed; // USE actualPlayerSpeed
        if (keys['arrowright']) player.position.x += actualPlayerSpeed; // USE actualPlayerSpeed

        // Joystick movement - now touch-anywhere movement
        if (touchActive) {
            player.position.x += movementVector.x * actualPlayerSpeed; // USE actualPlayerSpeed
            player.position.z += movementVector.y * actualPlayerSpeed; // USE actualPlayerSpeed
        }

        // Player Wrapping Logic
        if (player.position.x > worldBoundary) player.position.x = -worldBoundary + 0.1; // Add small offset
        if (player.position.x < -worldBoundary) player.position.x = worldBoundary - 0.1;
        if (player.position.z > worldBoundary) player.position.z = -worldBoundary + 0.1;
        if (player.position.z < -worldBoundary) player.position.z = worldBoundary - 0.1;

        if (ground) {
            ground.position.x = player.position.x;
            ground.position.z = player.position.z;
        }
        const dirLight = scene.children.find(child => child instanceof THREE.DirectionalLight);
        if (dirLight) {
            dirLight.position.set(player.position.x + 10, player.position.y + 20, player.position.z + 5);
            dirLight.target.position.copy(player.position);
            dirLight.target.updateMatrixWorld();
        }

        // const cameraOffset = new THREE.Vector3(0, 15, 12); // Old fixed offset
        const cameraOffset = new THREE.Vector3(0, activeCameraYOffset, activeCameraZOffset); // USE DYNAMIC OFFSETS
        camera.position.copy(player.position).add(cameraOffset);
        camera.lookAt(player.position);

        const playerBoxForCollectibles = new THREE.Box3().setFromObject(player);
        for (let i = collectibles.length - 1; i >= 0; i--) {
            const collectible = collectibles[i];
            const collectibleBox = new THREE.Box3().setFromObject(collectible);
            if (playerBoxForCollectibles.intersectsBox(collectibleBox)) {
                scene.remove(collectible);
                collectibles.splice(i, 1);
                score++;
                document.getElementById('score').textContent = score;
                playerScale += growthFactor;
                player.scale.set(playerScale, playerScale, playerScale);
                player.position.y = 0; // MODIFIED: Group origin at feet, scaling handles height
                spawnNewCollectible();
                resetCollectTimer();
            }
        }
    }
}

// --- Animation Loop ---
// This function is called by the browser typically 60 times per second.
function animate() {
    animationFrameId = requestAnimationFrame(animate);
    if (!isPaused) {
        update();
    }
    renderer.render(scene, camera);
}

// --- UI and Message Functions ---
// Displays a message (usually game over) in the message box.
function showMessage(message) {
    const messageBox = document.getElementById('message-box');
    const messageText = document.getElementById('message-text');
    messageText.textContent = message;
    messageBox.style.display = 'block'; // Make the message box visible
}

// Hides the message box.
function hideMessage() {
    const messageBox = document.getElementById('message-box');
    messageBox.style.display = 'none'; // Make the message box invisible
}

// --- Game Reset Function ---
// Called when the "Play Again" button is clicked.
function resetGame() {
    // Clear existing collect timer interval before setting up new game to avoid multiple timers
    if (collectTimerInterval) {
        clearInterval(collectTimerInterval);
    }
    setupNewGame(); // Re-initialize game state
}

// Add new pause toggle function
function togglePause() {
    isPaused = !isPaused;
    const pauseButton = document.getElementById('pause-button');

    if (isPaused) {
        pauseButton.textContent = 'Resume';
        pauseButton.classList.add('paused');
        // Pause the collect timer
        if (collectTimerInterval) {
            clearInterval(collectTimerInterval);
        }
    } else {
        pauseButton.textContent = 'Pause';
        pauseButton.classList.remove('paused');
        // Resume/Start the collect timer if the game is active
        if (gameActive) { // Only start if game is actually active (not game over)
            startCollectTimer();
        }
    }
}

// Player can kill if player is TALLER than the enemy
function canKillSpecificEnemy(enemyGroup) {
    const playerActualHeight = playerScale * 1.0; // Player geometry base height is 1
    // enemyGroup.scale.y refers to the scale of the whole group.
    // The previous logic was: playerActualHeight > enemy.scale.y * enemyBaseHeight.
    // This refers to the enemy's main cube height. Let's stick to that for now for consistency in gameplay feel,
    // comparing player height against the scaled height of the enemy's main body part.
    const enemyScaledBodyHeight = enemyBaseHeight * enemyGroup.scale.y;
    return playerActualHeight > enemyScaledBodyHeight;
}

function spawnNewEnemies() {
    const currentPlayerActualHeight = playerScale * 1.0;
    const newEnemyTargetHeight = currentPlayerActualHeight * 1.5; // New enemies 50% taller than current player
    const newEnemyScaleFactor = newEnemyTargetHeight / enemyBaseHeight;
    const spawnDistance = 35; // INCREASED from 30 to 35

    // Spawn first enemy at a random angle
    const enemy1 = createEnemy();
    enemy1.scale.set(newEnemyScaleFactor, newEnemyScaleFactor, newEnemyScaleFactor);
    enemy1.position.y = 0;
    const angle1 = Math.random() * Math.PI * 2; // Random angle (0 to 360 degrees)
    enemy1.position.x = player.position.x + Math.cos(angle1) * spawnDistance;
    enemy1.position.z = player.position.z + Math.sin(angle1) * spawnDistance;

    // Spawn second enemy on the opposite side with some deviation
    const enemy2 = createEnemy();
    enemy2.scale.set(newEnemyScaleFactor, newEnemyScaleFactor, newEnemyScaleFactor);
    enemy2.position.y = 0;
    // Opposite side (angle1 + PI) with a random deviation of +/- 45 degrees (PI/4 radians)
    const angle2 = angle1 + Math.PI + (Math.random() - 0.5) * (Math.PI / 2);
    enemy2.position.x = player.position.x + Math.cos(angle2) * spawnDistance;
    enemy2.position.z = player.position.z + Math.sin(angle2) * spawnDistance;
}

function avoidOtherEnemies(enemyGroup, index) {
    const avoidRadius = 7; // INCREASED from 5 to 7
    const avoidForce = 0.35; // INCREASED from 0.25 to 0.35

    enemies.forEach((otherEnemyGroup, otherIndex) => {
        if (index !== otherIndex) {
            const distance = enemyGroup.position.distanceTo(otherEnemyGroup.position);
            if (distance < avoidRadius) {
                // Calculate direction away from other enemy
                const avoidDirection = new THREE.Vector3()
                    .subVectors(enemyGroup.position, otherEnemyGroup.position)
                    .normalize();

                // Apply avoidance force
                enemyGroup.position.addScaledVector(avoidDirection, avoidForce);
            }
        }
    });
}

// NEW Function: updateMovementVector
function updateMovementVector() {
    let deltaX = currentTouchPoint.x - touchStartPoint.x;
    let deltaY = currentTouchPoint.y - touchStartPoint.y;

    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (distance < DEAD_ZONE_RADIUS) {
        movementVector.x = 0;
        movementVector.y = 0;
        return;
    }

    let normX = deltaX / MAX_DRAG_DISTANCE;
    let normY = deltaY / MAX_DRAG_DISTANCE;

    const magnitude = Math.sqrt(normX * normX + normY * normY);
    if (magnitude > 1.0) {
        normX /= magnitude;
        normY /= magnitude;
    }

    movementVector.x = normX;
    movementVector.y = normY;
}

// NEW function to apply speed multiplier and update speeds
function applySpeedMultiplier() {
    const baseSpeedForDevice = isMobile ? BASE_PLAYER_SPEED * MOBILE_SPEED_MULTIPLIER : BASE_PLAYER_SPEED;
    actualPlayerSpeed = baseSpeedForDevice * speedMultipliers[currentSpeedMultiplierIndex];
    actualEnemySpeed = (baseSpeedForDevice * 0.5) * speedMultipliers[currentSpeedMultiplierIndex]; // Enemy is 50% of player's base, then multiplied

    const speedButton = document.getElementById('speed-cycle-button');
    if (speedButton) {
        speedButton.textContent = `Speed: ${speedMultipliers[currentSpeedMultiplierIndex]}x`;
    }
    console.log(`Current Speed Multiplier: ${speedMultipliers[currentSpeedMultiplierIndex]}x`);
    console.log(`Actual Player Speed: ${actualPlayerSpeed}, Actual Enemy Speed: ${actualEnemySpeed}`);
}

// NEW function to handle speed cycle button click
function cycleSpeed() {
    currentSpeedMultiplierIndex = (currentSpeedMultiplierIndex + 1) % speedMultipliers.length;
    applySpeedMultiplier();
}

// NEW function to toggle zoom level
function toggleZoom() {
    currentZoomLevel = (currentZoomLevel === 1.0) ? 1.5 : 1.0;
    applyZoomLevel();
}

// NEW function to apply zoom level and update camera offsets
function applyZoomLevel() {
    const zoomButton = document.getElementById('zoom-toggle-button');
    if (currentZoomLevel === 1.0) {
        activeCameraYOffset = NORMAL_CAMERA_Y_OFFSET;
        activeCameraZOffset = NORMAL_CAMERA_Z_OFFSET;
        if (zoomButton) zoomButton.textContent = "Zoom: 1x";
    } else {
        activeCameraYOffset = ZOOMED_OUT_CAMERA_Y_OFFSET;
        activeCameraZOffset = ZOOMED_OUT_CAMERA_Z_OFFSET;
        if (zoomButton) zoomButton.textContent = "Zoom: 1.5x";
    }
    console.log(`Zoom level set to: ${currentZoomLevel}x, YOffset: ${activeCameraYOffset}, ZOffset: ${activeCameraZOffset}`);
}

// --- Start the game ---
// This ensures the init function is called only after the entire HTML document is loaded.
// window.onload = function () {  // REMOVE THIS BLOCK
//     init();
// };
