import * as THREE from 'three';
import {
    growthFactor, enemyBaseHeight, speedMultipliers,
    FOOD_POINTS, ENEMY_HEIGHT_FACTOR,
    BASE_PLAYER_SPEED, MOBILE_SPEED_MULTIPLIER,
    worldSize, initialFoodDensityArea,
    enemyStartOffset, MOVEMENT_MODE
} from './constants.js';
import { initContinuousMovement, resetContinuousMovement, updateContinuousMovement } from './movement-continuous.js';
import { wrapPosition } from './worldmath.js';
import { state } from './state.js';
import { createPlayer, disposeCharacter } from './characters.js';
import { createEnemy, updateEnemies, playerBox, scratchBox } from './enemies.js';
import { spawnNearPlayer, spawnAnywhere } from './collectibles.js';
import { createWorld, onWindowResize, updateCameraPosition, resetCameraZoom, zoomIn, zoomOut, updateGroundScroll } from './world.js';
import { initEffects, updateEffects, resetEffects, onCollect } from './effects.js';
import { keys, onKeyDown, onKeyUp, setupTouchControls } from './input.js';
import { el, initUI, hideMessage, showStartOverlay, hideStartOverlay, updateScoreDisplay, createEnemyIndicators, updateKillIndicator, updateOffscreenIndicators } from './ui.js';
import { resetCollectClock, tickCollectClock } from './timers.js';
import { unlockAudio, sfx, music } from './audio.js';

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

    initUI(); // Resolve all UI DOM refs once — everything after this uses el.*

    // Mobile detection and speed adjustment (plan 012): capability +
    // form-factor, not UA sniffing. A touch-laptop with a mouse reports
    // `pointer: fine` and correctly gets desktop speed; the boost is only
    // for touch-primary (coarse-pointer) devices.
    state.isMobile = window.matchMedia('(pointer: coarse)').matches;
    if (state.isMobile) {
        state.playerSpeed = BASE_PLAYER_SPEED * MOBILE_SPEED_MULTIPLIER;
        console.log("Mobile device detected. Player speed adjusted to:", state.playerSpeed);
    } else {
        state.playerSpeed = BASE_PLAYER_SPEED;
        console.log("Desktop device detected. Player speed base:", state.playerSpeed);
    }

    applySpeedMultiplier(); // Apply initial speed multiplier

    const directionalLight = createWorld();
    initEffects(); // Particle pool + food glow (plan 015) — needs the scene

    // 6. Player and Enemy Objects
    createPlayer();
    createEnemy();
    directionalLight.target = state.player; // Make the directional light follow the player for consistent shadows

    // 7. Event Listeners for user input and window resizing.
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onWindowResize);
    document.getElementById('restart-button').addEventListener('click', () => { sfx.click(); resetGame(); });
    document.getElementById('restart-game-button').addEventListener('click', () => { sfx.click(); resetGame(); });

    // Add event listeners for pause and restart buttons
    document.getElementById('pause-button').addEventListener('click', () => { sfx.click(); togglePause(); });
    // Start overlay: button, or any pointer press on the overlay itself.
    // (Any key while the overlay is up also starts — see onKeyDown.)
    el.startButton.addEventListener('click', startRun);
    el.startOverlay.addEventListener('pointerdown', startRun);
    document.getElementById('speed-cycle-button').addEventListener('click', () => { sfx.click(); cycleSpeed(); });
    document.getElementById('zoom-in-button').addEventListener('click', () => { sfx.click(); zoomIn(); });
    document.getElementById('zoom-out-button').addEventListener('click', () => { sfx.click(); zoomOut(); });

    // NEW Touch Anywhere Event Listeners
    setupTouchControls();

    // Plan 014 spike: `?move=continuous` swaps in the prototype movement
    // scheme (cursor-steer + boost). Classic mode never reaches this module.
    if (MOVEMENT_MODE === 'continuous') initContinuousMovement();

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

    // The start overlay owns the boot UX (isPaused stays true until
    // startRun), so the pause button reads "Pause" — ready for the run
    // that begins when the overlay is dismissed. togglePause() manages
    // the text from then on.
    if (el.pauseButton) {
        el.pauseButton.textContent = 'Pause';
        el.pauseButton.classList.remove('paused');
    }

    // Collectibles use shared resources — scene.remove is the whole cleanup.
    state.collectibles.forEach(c => state.scene.remove(c));
    state.collectibles = [];
    // Enemies own a cloned body material each — dispose it with the enemy.
    state.enemies.forEach(e => {
        state.scene.remove(e);
        disposeCharacter(e);
    });
    state.enemies = [];

    if (state.player) {
        state.player.position.set(0, 0, 0); // MODIFIED: Group origin at feet
        state.player.scale.set(state.playerScale, state.playerScale, state.playerScale);
    } else {
        createPlayer(); // createPlayer sets scale to playerScale by default
    }

    // Create initial enemy, taller than the player by the same factor as
    // kill-spawned foes (ENEMY_HEIGHT_FACTOR)
    const firstEnemy = createEnemy();
    const initialPlayerActualHeight = state.playerScale * 1.0; // Player's geometry height is 1
    const firstEnemyTargetHeight = initialPlayerActualHeight * ENEMY_HEIGHT_FACTOR;
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
    resetEffects(); // Park all particles; reset squash/walk transients (plan 015)
    if (MOVEMENT_MODE === 'continuous') resetContinuousMovement(); // Full energy, default heading (plan 014 spike)

    // Every new session — fresh boot or post-death restart — returns to the
    // start overlay; startRun() is the single "a run begins" entry point.
    showStartOverlay();

    // Initialize the collect countdown; it only ticks while the game is
    // unpaused (driven by dt in update()).
    resetCollectClock();
}

// --- Start Run ---
// THE single entry point for "a run begins" (start button, any key, or a
// pointer press on the overlay — plan 010 hooks its AudioContext resume
// here). Idempotent: the onStartScreen guard makes the overlay's
// pointerdown + the button's click (both fire on one press) start exactly
// one run — and exactly one start jingle.
export function startRun() {
    if (!state.onStartScreen) return;
    unlockAudio(); // Browser autoplay policy: resume must ride a real gesture
    sfx.start();
    music.start();
    hideStartOverlay();
    if (state.isPaused) togglePause(); // Starts the clock and sets button text
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
        if (MOVEMENT_MODE === 'continuous') {
            // Plan 014 spike: cursor-steered constant motion + boost.
            updateContinuousMovement(dt);
        } else {
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
        }

        // Player Wrapping Logic (preserves overshoot across the seam)
        wrapPosition(state.player.position);

        if (state.ground) {
            state.ground.position.x = state.player.position.x;
            state.ground.position.z = state.player.position.z;
            // The plane moved with the player — slide the grid texture the
            // other way so the pattern stays fixed in the world (plan 015).
            updateGroundScroll();
        }

        // Update directional light to follow player
        const dirLight = state.scene.children.find(child => child instanceof THREE.DirectionalLight);
        if (dirLight) {
            dirLight.position.set(state.player.position.x + 10, state.player.position.y + 20, state.player.position.z + 5);
            dirLight.target.position.copy(state.player.position);
            dirLight.target.updateMatrixWorld();
        }

        // Collectibles collision — refresh the shared playerBox once (the
        // player moved since the enemy pass), then reuse scratchBox per item.
        playerBox.setFromObject(state.player);
        for (let i = state.collectibles.length - 1; i >= 0; i--) {
            const collectible = state.collectibles[i];
            scratchBox.setFromObject(collectible);
            if (playerBox.intersectsBox(scratchBox)) {
                onCollect(collectible.position); // Lime burst + squash-stretch (plan 015)
                state.scene.remove(collectible);
                state.collectibles.splice(i, 1);
                state.score += FOOD_POINTS;
                updateScoreDisplay();
                state.playerScale += growthFactor;
                state.player.scale.set(state.playerScale, state.playerScale, state.playerScale);
                state.player.position.y = 0; // MODIFIED: Group origin at feet, scaling handles height
                spawnNearPlayer();
                resetCollectClock();
                sfx.collect();
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
        // Visual effects run on the same clock but OUTSIDE the gameActive
        // gate: a death explosion must finish behind the death screen.
        updateEffects(dt);
    }
    // Camera follow and rendering run every frame regardless of pause or
    // game over — the frozen scene must stay visible behind the message box.
    updateCameraPosition(dt);
    state.renderer.render(state.scene, state.camera);
}

// --- Game Reset Function ---
// Called by the "Play Again" / "Restart" buttons and by Space/Enter on the
// death screen (input.js). Returns to the start overlay via setupNewGame.
export function resetGame() {
    music.stop(); // A mid-run restart must not leave the loop playing over the start overlay
    setupNewGame(); // Re-initialize game state
}

// Add new pause toggle function
export function togglePause() {
    state.isPaused = !state.isPaused;

    if (state.isPaused) {
        el.pauseButton.textContent = 'Resume';
        el.pauseButton.classList.add('paused');
        // Music follows the pause state — also prevents throttled background
        // tabs (auto-pause) from playing a stuttering scheduler.
        music.stop();
    } else {
        el.pauseButton.textContent = 'Pause';
        el.pauseButton.classList.remove('paused');
        // Don't integrate the paused gap into the next frame's dt
        lastFrameTime = null;
        if (state.gameActive && !state.onStartScreen) music.start();
    }
    // The collect countdown runs on the game clock, so pausing inherently
    // freezes it and resuming does NOT reset it.
}

// NEW function to apply speed multiplier and update speeds
function applySpeedMultiplier() {
    const baseSpeedForDevice = state.isMobile ? BASE_PLAYER_SPEED * MOBILE_SPEED_MULTIPLIER : BASE_PLAYER_SPEED;
    state.actualPlayerSpeed = baseSpeedForDevice * speedMultipliers[state.currentSpeedMultiplierIndex];
    state.actualEnemySpeed = (baseSpeedForDevice * 0.5) * speedMultipliers[state.currentSpeedMultiplierIndex]; // Enemy is 50% of player's base, then multiplied

    if (el.speedButton) {
        el.speedButton.textContent = `Speed: ${speedMultipliers[state.currentSpeedMultiplierIndex]}x`;
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
