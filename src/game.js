import * as THREE from 'three';
import {
    growthFactor, enemyBaseHeight, speedMultipliers,
    BASE_PLAYER_SPEED, MOBILE_SPEED_MULTIPLIER,
    worldSize, worldBoundary, initialFoodDensityArea,
    enemyStartOffset, initialCollectTime
} from './constants.js';
import { state } from './state.js';
import { createPlayer } from './characters.js';
import { createEnemy, updateEnemies } from './enemies.js';
import { spawnNearPlayer, spawnAnywhere } from './collectibles.js';
import { createWorld, onWindowResize, updateCameraPosition, zoomOutCamera } from './world.js';
import { keys, onKeyDown, onKeyUp, setupTouchControls } from './input.js';
import { hideMessage, updateScoreDisplay, updateCollectTimeDisplay, createEnemyIndicators, updateKillIndicator, updateOffscreenIndicators } from './ui.js';
import { startCollectTimer, resetCollectTimer } from './timers.js';


// --- Initialization Function ---
// This function sets up the entire game scene, objects, and event listeners.
function init() {
    state.gameContainer = document.getElementById('game-container');
    if (!state.gameContainer) {
        console.error('Game container not found!');
        return;
    }

    // Mobile detection and speed adjustment
    state.isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || /Mobi|Android/i.test(navigator.userAgent);
    if (state.isMobile) {
        state.playerSpeed = BASE_PLAYER_SPEED * MOBILE_SPEED_MULTIPLIER;
        console.log("Mobile device detected. Player speed adjusted to:", state.playerSpeed);
    } else {
        state.playerSpeed = BASE_PLAYER_SPEED;
        console.log("Desktop device detected. Player speed base:", state.playerSpeed);
    }

    applySpeedMultiplier(); // Apply initial speed multiplier

    const directionalLight = createWorld();

    // 6. Player and Enemy Objects
    createPlayer();
    createEnemy();
    directionalLight.target = state.player; // Make the directional light follow the player for consistent shadows

    // 7. Event Listeners for user input and window resizing.
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onWindowResize);
    document.getElementById('restart-button').addEventListener('click', resetGame);
    document.getElementById('restart-game-button').addEventListener('click', resetGame);

    // Add event listeners for pause and restart buttons
    document.getElementById('pause-button').addEventListener('click', togglePause);
    document.getElementById('speed-cycle-button').addEventListener('click', cycleSpeed);
    document.getElementById('zoom-toggle-button').addEventListener('click', zoomOutCamera);

    // NEW Touch Anywhere Event Listeners
    setupTouchControls();

    // 8. Initial Game Setup
    setupNewGame();

    // 9. Start the Animation Loop
    // This function will be called repeatedly to update and render the game.
    animate();

    console.log('Game initialized successfully');

    createEnemyIndicators();
}

// --- Setup New Game ---
// Resets game state for a new session (called by init and when restarting).
function setupNewGame() {
    state.gameActive = true;
    state.isPaused = true; // Start the game in a paused state
    state.score = 0;
    state.playerScale = 1.0; // Player's initial scale (acts as height for 1x1x1 geometry)
    updateScoreDisplay();

    // Set initial state for the pause button
    const pauseButton = document.getElementById('pause-button');
    if (pauseButton) {
        pauseButton.textContent = 'Resume';
        pauseButton.classList.add('paused');
    }

    state.collectibles.forEach(c => state.scene.remove(c));
    state.collectibles = [];
    state.enemies.forEach(e => state.scene.remove(e));
    state.enemies = [];

    if (state.player) {
        state.player.position.set(0, 0, 0); // MODIFIED: Group origin at feet
        state.player.scale.set(state.playerScale, state.playerScale, state.playerScale);
    } else {
        createPlayer(); // createPlayer sets scale to playerScale by default
    }

    // Create initial enemy, 50% taller than player
    const firstEnemy = createEnemy();
    const initialPlayerActualHeight = state.playerScale * 1.0; // Player's geometry height is 1
    const firstEnemyTargetHeight = initialPlayerActualHeight * 1.5;
    // enemyBaseHeight is the enemy's unscaled geometry height (1.2)
    const firstEnemyScaleFactor = firstEnemyTargetHeight / enemyBaseHeight;
    firstEnemy.scale.set(firstEnemyScaleFactor, firstEnemyScaleFactor, firstEnemyScaleFactor);
    firstEnemy.position.y = 0; // MODIFIED: Group origin is at feet level

    if (state.enemies.length > 0) {
        state.enemies[0].position.x = state.player.position.x + enemyStartOffset;
        state.enemies[0].position.z = state.player.position.z + enemyStartOffset;
    }

    // Calculate initial food count based on density
    const initialFoodCount = Math.floor((worldSize * worldSize) / initialFoodDensityArea);

    for (let i = 0; i < initialFoodCount; i++) {
        spawnAnywhere(); // Use new function for initial even distribution
    }

    for (const key in keys) {
        keys[key] = false;
    }
    hideMessage();

    // Initialize the collect timer display, but don't start the interval yet.
    // The timer will start when the player first unpauses.
    state.collectTimerValue = initialCollectTime;
    updateCollectTimeDisplay();
}

// --- Game Logic Update Function ---
// This function is called every frame by animate() to update game state.
function update() {
    if (!state.player || state.isPaused) return;

    // Update kill indicator and enemy colors (visuals first)
    updateKillIndicator();

    // --- Off-Screen Enemy Indicator Logic ---
    updateOffscreenIndicators();

    // Enemy AI, movement, and player-collision handling
    updateEnemies();

    // Player movement and other game updates (ground, light, camera, collectibles)
    if (state.gameActive) {
        // Keyboard movement (can coexist or be removed)
        if (keys['arrowup']) state.player.position.z -= state.actualPlayerSpeed; // USE actualPlayerSpeed
        if (keys['arrowdown']) state.player.position.z += state.actualPlayerSpeed; // USE actualPlayerSpeed
        if (keys['arrowleft']) state.player.position.x -= state.actualPlayerSpeed; // USE actualPlayerSpeed
        if (keys['arrowright']) state.player.position.x += state.actualPlayerSpeed; // USE actualPlayerSpeed

        // Joystick movement - now touch-anywhere movement
        if (state.touchActive) {
            state.player.position.x += state.movementVector.x * state.actualPlayerSpeed; // USE actualPlayerSpeed
            state.player.position.z += state.movementVector.y * state.actualPlayerSpeed; // USE actualPlayerSpeed
        }

        // Player Wrapping Logic
        if (state.player.position.x > worldBoundary) state.player.position.x = -worldBoundary + 0.1; // Add small offset
        if (state.player.position.x < -worldBoundary) state.player.position.x = worldBoundary - 0.1;
        if (state.player.position.z > worldBoundary) state.player.position.z = -worldBoundary + 0.1;
        if (state.player.position.z < -worldBoundary) state.player.position.z = worldBoundary - 0.1;

        if (state.ground) {
            state.ground.position.x = state.player.position.x;
            state.ground.position.z = state.player.position.z;
        }

        // Update directional light to follow player
        const dirLight = state.scene.children.find(child => child instanceof THREE.DirectionalLight);
        if (dirLight) {
            dirLight.position.set(state.player.position.x + 10, state.player.position.y + 20, state.player.position.z + 5);
            dirLight.target.position.copy(state.player.position);
            dirLight.target.updateMatrixWorld();
        }

        // Collectibles collision
        const playerBoxForCollectibles = new THREE.Box3().setFromObject(state.player);
        for (let i = state.collectibles.length - 1; i >= 0; i--) {
            const collectible = state.collectibles[i];
            const collectibleBox = new THREE.Box3().setFromObject(collectible);
            if (playerBoxForCollectibles.intersectsBox(collectibleBox)) {
                state.scene.remove(collectible);
                state.collectibles.splice(i, 1);
                state.score++;
                updateScoreDisplay();
                state.playerScale += growthFactor;
                state.player.scale.set(state.playerScale, state.playerScale, state.playerScale);
                state.player.position.y = 0; // MODIFIED: Group origin at feet, scaling handles height
                spawnNearPlayer();
                resetCollectTimer();
            }
        }
    }

    // Update camera position consistently every frame game is active & not paused
    updateCameraPosition();
}

// --- Animation Loop ---
// This function is called by the browser typically 60 times per second.
function animate() {
    requestAnimationFrame(animate);
    if (!state.isPaused) {
        update();
    }
    state.renderer.render(state.scene, state.camera);
}

// --- Game Reset Function ---
// Called when the "Play Again" button is clicked.
function resetGame() {
    // Clear existing collect timer interval before setting up new game to avoid multiple timers
    if (state.collectTimerInterval) {
        clearInterval(state.collectTimerInterval);
    }
    setupNewGame(); // Re-initialize game state
}

// Add new pause toggle function
export function togglePause() {
    state.isPaused = !state.isPaused;
    const pauseButton = document.getElementById('pause-button');

    if (state.isPaused) {
        pauseButton.textContent = 'Resume';
        pauseButton.classList.add('paused');
        // Pause the collect timer
        if (state.collectTimerInterval) {
            clearInterval(state.collectTimerInterval);
        }
    } else {
        pauseButton.textContent = 'Pause';
        pauseButton.classList.remove('paused');
        // Resume/Start the collect timer if the game is active
        if (state.gameActive) { // Only start if game is actually active (not game over)
            startCollectTimer();
        }
    }
}

// NEW function to apply speed multiplier and update speeds
function applySpeedMultiplier() {
    const baseSpeedForDevice = state.isMobile ? BASE_PLAYER_SPEED * MOBILE_SPEED_MULTIPLIER : BASE_PLAYER_SPEED;
    state.actualPlayerSpeed = baseSpeedForDevice * speedMultipliers[state.currentSpeedMultiplierIndex];
    state.actualEnemySpeed = (baseSpeedForDevice * 0.5) * speedMultipliers[state.currentSpeedMultiplierIndex]; // Enemy is 50% of player's base, then multiplied

    const speedButton = document.getElementById('speed-cycle-button');
    if (speedButton) {
        speedButton.textContent = `Speed: ${speedMultipliers[state.currentSpeedMultiplierIndex]}x`;
    }
    console.log(`Current Speed Multiplier: ${speedMultipliers[state.currentSpeedMultiplierIndex]}x`);
    console.log(`Actual Player Speed: ${state.actualPlayerSpeed}, Actual Enemy Speed: ${state.actualEnemySpeed}`);
}

// NEW function to handle speed cycle button click
function cycleSpeed() {
    state.currentSpeedMultiplierIndex = (state.currentSpeedMultiplierIndex + 1) % speedMultipliers.length;
    applySpeedMultiplier();
}

// --- Start the game ---
// Startup call (moved here from the old inline script in index.html).
if (document.readyState === 'complete') {
    init();
} else {
    window.addEventListener('load', init);
}
