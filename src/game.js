import * as THREE from 'three';
import {
    growthFactor, enemyBaseHeight, speedMultipliers,
    BASE_PLAYER_SPEED, MOBILE_SPEED_MULTIPLIER,
    worldSize, worldBoundary, initialFoodDensityArea,
    enemyStartOffset
} from './constants.js';
import { state } from './state.js';
import { createPlayer } from './characters.js';
import { createEnemy, updateEnemies } from './enemies.js';
import { spawnNearPlayer, spawnAnywhere } from './collectibles.js';
import { createWorld, onWindowResize, updateCameraPosition, resetCameraZoom, zoomIn, zoomOut } from './world.js';
import { keys, onKeyDown, onKeyUp, setupTouchControls } from './input.js';
import { hideMessage, updateScoreDisplay, createEnemyIndicators, updateKillIndicator, updateOffscreenIndicators } from './ui.js';
import { resetCollectClock, tickCollectClock } from './timers.js';

// --- Simulation Clock ---
// dt (seconds) drives all movement and timers; MAX_DELTA clamps tab-switch
// gaps and GC hitches so the world never teleports.
let lastFrameTime = null;
const MAX_DELTA = 0.05; // seconds; clamps tab-switch gaps and GC hitches


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
    document.getElementById('zoom-in-button').addEventListener('click', zoomIn);
    document.getElementById('zoom-out-button').addEventListener('click', zoomOut);

    // NEW Touch Anywhere Event Listeners
    setupTouchControls();

    // Auto-pause when the tab is hidden (the dt clamp already prevents
    // catch-up jumps; this puts the player in a fair, deliberate resume state).
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && !state.isPaused && state.gameActive) togglePause();
    });

    // 8. Initial Game Setup
    setupNewGame();

    // 9. Start the Animation Loop
    // This function will be called repeatedly to update and render the game.
    state.animationFrameId = requestAnimationFrame(animate);

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
    resetCameraZoom(); // New runs always start at the default framing
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

    // Initialize the collect countdown; it only ticks while the game is
    // unpaused (driven by dt in update()).
    resetCollectClock();
}

// --- Game Logic Update Function ---
// This function is called every frame by animate() to update game state.
// dt is the frame delta in seconds; all speeds are units/second.
function update(dt) {
    if (!state.player || state.isPaused || !state.gameActive) return;

    // Advance the collect countdown on the game clock (before the enemy loop)
    tickCollectClock(dt);

    // Update kill indicator and enemy colors (visuals first)
    updateKillIndicator(dt);

    // --- Off-Screen Enemy Indicator Logic ---
    updateOffscreenIndicators();

    // Enemy AI, movement, and player-collision handling
    updateEnemies(dt);

    // Player movement and other game updates (ground, light, camera, collectibles)
    if (state.gameActive) {
        // Keyboard movement (can coexist or be removed)
        if (keys['arrowup']) state.player.position.z -= state.actualPlayerSpeed * dt; // USE actualPlayerSpeed
        if (keys['arrowdown']) state.player.position.z += state.actualPlayerSpeed * dt; // USE actualPlayerSpeed
        if (keys['arrowleft']) state.player.position.x -= state.actualPlayerSpeed * dt; // USE actualPlayerSpeed
        if (keys['arrowright']) state.player.position.x += state.actualPlayerSpeed * dt; // USE actualPlayerSpeed

        // Joystick movement - now touch-anywhere movement
        if (state.touchActive) {
            state.player.position.x += state.movementVector.x * state.actualPlayerSpeed * dt; // USE actualPlayerSpeed
            state.player.position.z += state.movementVector.y * state.actualPlayerSpeed * dt; // USE actualPlayerSpeed
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
                resetCollectClock();
            }
        }
    }
}

// --- Animation Loop ---
// Called by the browser each display frame; `now` is the RAF timestamp (ms).
function animate(now) {
    state.animationFrameId = requestAnimationFrame(animate);
    if (lastFrameTime === null) lastFrameTime = now;
    const dt = Math.min((now - lastFrameTime) / 1000, MAX_DELTA);
    lastFrameTime = now;
    if (!state.isPaused) {
        update(dt);
    }
    // Camera follow and rendering run every frame regardless of pause or
    // game over — the frozen scene must stay visible behind the message box.
    updateCameraPosition(dt);
    state.renderer.render(state.scene, state.camera);
}

// --- Game Reset Function ---
// Called when the "Play Again" button is clicked.
function resetGame() {
    setupNewGame(); // Re-initialize game state
}

// Add new pause toggle function
export function togglePause() {
    state.isPaused = !state.isPaused;
    const pauseButton = document.getElementById('pause-button');

    if (state.isPaused) {
        pauseButton.textContent = 'Resume';
        pauseButton.classList.add('paused');
    } else {
        pauseButton.textContent = 'Pause';
        pauseButton.classList.remove('paused');
        // Don't integrate the paused gap into the next frame's dt
        lastFrameTime = null;
    }
    // The collect countdown runs on the game clock, so pausing inherently
    // freezes it and resuming does NOT reset it.
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
