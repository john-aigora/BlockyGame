import * as THREE from 'three';
import {
    growthFactor, enemyBaseHeight, speedMultipliers, SPEED_LADDER,
    FOOD_POINTS, ENEMY_HEIGHT_FACTOR, MILESTONE_STEP,
    SPEED_GROWTH_FACTOR, SPEED_GROWTH_CAP,
    BASE_PLAYER_SPEED, BASE_ENEMY_SPEED, MOBILE_SPEED_MULTIPLIER,
    worldSize, initialFoodDensityArea,
    enemyStartOffset, CONTINUOUS_MOVEMENT,
    CHUNK_SIZE, REBASE_DISTANCE,
    PLAYER_COLLIDER_HALF_WIDTH, RAMP_DISTANCE, RAMP_SPEED_STEP, RAMP_SPEED_MAX,
    DISTANCE_MILESTONE_STEP,
    JUMP_APEX_HEIGHT, JUMP_APEX_GROWTH, JUMP_AIRTIME, JUMP_AIRTIME_GROWTH
} from './constants.js';
import { initContinuousMovement, resetContinuousMovement, updateContinuousMovement } from './movement-continuous.js';
import { wrapPosition, torusDeltaComponent } from './worldmath.js';
import { state } from './state.js';
import { createPlayer, disposeCharacter } from './characters.js';
import { createEnemy, updateEnemies, updateEnemyStreaming, resetEnemyStreaming, playerBox, scratchBox, beginMaterialize, updateSpawnWarnings, clearPendingSpawns, shiftPendingSpawns, reimagePendingSpawns } from './enemies.js';
import { spawnNearPlayer, spawnAnywhere } from './collectibles.js';
import { createWorld, onWindowResize, updateCameraPosition, resetCameraZoom, zoomIn, zoomOut, updateGroundScroll } from './world.js';
import { initTerrain, setTerrainActive, resetTerrainForNewRun, updateTerrain, shiftTerrain, groundHeightAt, slideMove, isRockWedged } from './terrain.js';
import { initClouds, setCloudMode, updateClouds, shiftClouds } from './clouds.js';
import { initEffects, updateEffects, resetEffects, onCollect, onGrowthMilestone, shiftActiveParticles, spawnTextPopup, onJumpTakeoff, onJumpLand } from './effects.js';
import { keys, moveVector, clearTransientInput, onKeyDown, onKeyUp, setupTouchControls, setupGamepad, pollGamepad } from './input.js';
import { rumble } from './rumble.js';
import { el, initUI, hideMessage, showStartOverlay, hideStartOverlay, updateScoreDisplay, createEnemyIndicators, updateKillIndicator, updateOffscreenIndicators, resetCombo, updateDangerPulse, resetTension, resetIndicators, showGoFlourish, updateModeHud, updateDistanceDisplay, resetDistanceDisplay } from './ui.js';
import { resetCollectClock, tickCollectClock, tickComboClock } from './timers.js';
import { loadWorldMode } from './hiscores.js';
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

    // Product is endless-only. Mode must be set BEFORE world math / spawning
    // (worldmath.js dispatches on it). Classic exists only via forceWorldMode
    // for the torus regression suite.
    state.worldMode = loadWorldMode();
    updateModeHud(); // Endless-only HUD bits (jump hint, distance readout)

    // Mobile detection and speed adjustment (plan 012): capability +
    // form-factor, not UA sniffing. A touch-laptop with a mouse reports
    // `pointer: fine` and correctly gets desktop speed; the boost is only
    // for touch-primary (coarse-pointer) devices.
    // ORDERING CONTRACT (plan 020 P-10): resolved BEFORE createWorld below —
    // the renderer's antialias/DPR/shadow tier reads state.isMobile.
    state.isMobile = window.matchMedia('(pointer: coarse)').matches;

    applySpeedMultiplier(); // Apply initial speed multiplier

    const directionalLight = createWorld();
    initClouds(); // Voxel sky (shared geometry/material) — needs the scene
    applyWorldEnvironment(); // Terrain root / classic ground per the saved mode
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
    // On-screen JUMP button (endless runs on coarse pointers only — ui.js
    // owns its visibility). pointerdown, like the continuous BOOST button,
    // so the hop lands on the press, not the release; input.js already
    // excludes <button> touches from the movement drag.
    document.getElementById('jump-button').addEventListener('pointerdown', (e) => {
        e.preventDefault();
        tryJump();
    });

    // NEW Touch Anywhere Event Listeners
    setupTouchControls();
    // Physical gamepad: connect listeners + per-frame poll in animate().
    setupGamepad();

    // Plan 014 spike: `?move=continuous` swaps in the prototype movement
    // scheme (cursor-steer + boost). The standard movement scheme never
    // loads this module. (This is a MOVEMENT scheme flag — not the world
    // mode; the retired classic arena is state.worldMode.)
    if (CONTINUOUS_MOVEMENT) initContinuousMovement();

    // Auto-pause when the tab is hidden (the dt clamp already prevents
    // catch-up jumps; this puts the player in a fair, deliberate resume state).
    // Both blur and hidden also CLEAR transient inputs (audit C-4): the
    // matching keyup goes to the other window/app, and a latched key would
    // otherwise keep driving the player on resume.
    window.addEventListener('blur', clearTransientInput);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearTransientInput();
            if (!state.isPaused && state.gameActive) togglePause();
        }
    });

    // 8. Initial Game Setup
    setupNewGame();

    // 9. Start the Animation Loop
    // This function will be called repeatedly to update and render the game.
    state.animationFrameId = requestAnimationFrame(animate);

    createEnemyIndicators();
}

// --- Setup New Game ---
// Resets game state for a new session (called by init and when restarting).
function setupNewGame() {
    state.gameActive = true;
    state.isPaused = true; // Start the game in a paused state
    state.score = 0;
    state.runTime = 0; // Fresh run clock (see state.js — the tests' timing base)
    state.playerScale = 1.0; // Player's initial scale (acts as height for 1x1x1 geometry)
    state.furthestDistance = 0; // Endless progress + difficulty ramp reset BEFORE the
    state.endlessRampLevel = 0; // speed recompute below (ramp feeds enemy speed)
    state.jumpOffset = 0; // A restart mid-arc lands instantly:
    state.jumpVelocity = 0; // fresh runs always start grounded
    state.jumpGravity = 0;
    clearPendingSpawns(); // Drop any red warn discs from the last run
    state.jumpAirborne = false;
    resetEnemyStreaming(); // A fresh run's first bubble top-up owes no cooldown
    resetDistanceDisplay(); // Zero the HUD and show/hide it per the current mode
    applySpeedMultiplier(); // playerScale reset → drop any size speed bonus from the last run
    resetCombo(); // A mid-run restart must not carry a live combo into the new run
    resetTension(); // Nor a pulsing panic timer, red vignette, or racing heartbeat
    resetIndicators(); // Nor last run's enemy arrows / KILL! flash over the overlay
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

    // Endless world: fresh floating origin, fresh terrain window around the
    // spawn, and the player/boot enemy grounded on it (the spawn mesa in
    // terrain.js guarantees dry land at true (0,0)).
    state.worldOrigin.x = 0;
    state.worldOrigin.z = 0;
    if (state.worldMode === 'endless') {
        resetTerrainForNewRun();
        state.player.position.y = groundHeightAt(0, 0);
        if (state.enemies.length > 0) {
            const firstFoe = state.enemies[0];
            firstFoe.position.y = groundHeightAt(firstFoe.position.x, firstFoe.position.z);
        }
    }
    // Spawn telegraph (tension pass): the boot enemy materializes too — it
    // starts scaling in on the first unpaused frame, right as the run begins.
    beginMaterialize(firstEnemy);

    // Initial food: classic scatters evenly across the arena; endless food
    // is chunk-seeded — resetTerrainForNewRun above already grew the spawn
    // neighborhood's food, and streaming grows the rest.
    if (state.worldMode !== 'endless') {
        const initialFoodCount = Math.floor((worldSize * worldSize) / initialFoodDensityArea);
        for (let i = 0; i < initialFoodCount; i++) {
            spawnAnywhere(); // Use new function for initial even distribution
        }
    }

    for (const key in keys) {
        keys[key] = false;
    }
    hideMessage();
    resetEffects(); // Park all particles; reset squash/walk transients (plan 015)
    if (CONTINUOUS_MOVEMENT) resetContinuousMovement(); // Full energy, default heading (plan 014 spike)

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
    showGoFlourish(); // Big lime "GO!" — one 0.6s flash as the run begins
    if (state.isPaused) togglePause(); // Starts the clock and sets button text
}

// --- Game Logic Update Function ---
// This function is called every frame by animate() to update game state.
// dt is the frame delta in seconds; all speeds are units/second.
function update(dt) {
    if (!state.player || state.isPaused || !state.gameActive) return;

    // Advance the run clock first: every game-clock consumer (and the test
    // suite) sees a runTime that already includes this frame's dt.
    state.runTime += dt;

    // Advance the collect countdown on the game clock (before the enemy loop)
    tickCollectClock(dt);
    // Dead-run guard (audit C-1): tickCollectClock may call endGame. The
    // frame must stop WITH the run — otherwise updateEnemies still executes,
    // killEnemy pays score and schedules spawns on a dead run, and the HUD
    // ends up showing more than the board recorded at endGame time.
    if (!state.gameActive) return;

    // Combo window runs on the same clock (kills in enemies.js refresh it)
    tickComboClock(dt);

    // Update kill indicator and enemy colors (visuals first)
    updateKillIndicator(dt);

    // --- Off-Screen Enemy Indicator Logic ---
    updateOffscreenIndicators();

    // Danger vignette + heartbeat (tension pass). Runs BEFORE updateEnemies:
    // it reads last frame's positions (one frame of latency is invisible at
    // these speeds), and a death inside the enemy pass can then zero the
    // vignette without this frame re-raising it afterwards.
    updateDangerPulse(dt);

    // Enemy AI, movement, and player-collision handling
    updateEnemies(dt);
    // Dead-run guard (audit C-1), same rule as after tickCollectClock: a
    // death inside the enemy pass must not keep ticking warn discs into
    // fresh materializing monsters over the death screen.
    if (!state.gameActive) return;
    // Red pre-spawn warns → materialize (after AI so a just-spawned foe
    // waits one frame, same as kill-spawn appends).
    updateSpawnWarnings(dt);

    // Player movement and other game updates (ground, light, camera, collectibles)
    if (state.gameActive) {
        if (CONTINUOUS_MOVEMENT) {
            // Plan 014 spike: cursor-steered constant motion + boost.
            updateContinuousMovement(dt);
        } else if (state.worldMode === 'endless') {
        // Endless movement: same keyboard+touch input, but water and rocks
        // are impassable — resolved honestly by the shared slide (terrain.js
        // slideMove: the collider is the body's true visual half-width,
        // sampled at the leading edge + lateral extremes of travel; a
        // blocked diagonal creeps along the shoreline instead of freezing).
        updateJumpPhysics(dt); // Advance the arc BEFORE the slide reads jumpAirborne
        // ONE movement vector for every input source (audit C-5): moveVector
        // sums keyboard+stick+touch and clamps once — stacking sources can
        // never exceed full speed.
        const mv = moveVector();
        const moveX = mv.x * state.actualPlayerSpeed * dt;
        const moveZ = mv.z * state.actualPlayerSpeed * dt;
        const p = state.player.position;
        const radius = state.playerScale * PLAYER_COLLIDER_HALF_WIDTH;
        // JUMP RULES (owner queue item 5): airborne ignores ROCK circles
        // only — WATER stays impassable even mid-air, so an arc aimed at a
        // lake stops at the shoreline exactly like a blocked step and the
        // landing is always dry. The second clause is the landing grace: an
        // arc may legally END inside a rock circle (rocks were ignored on
        // the way), so rocks stay ignored until the body walks clear.
        // PROBE PARITY (audit C-6): "wedged" is judged by the same radius-0
        // sample points the movement probes use — the old radius-inflated
        // center circle stayed true across a ~radius-wide ring where every
        // probe was already clear, silently turning rocks off there.
        const ignoreRocks = state.jumpAirborne || isRockWedged(p.x, p.z, radius);
        const applied = slideMove(p.x, p.z, moveX, moveZ, radius, ignoreRocks);
        p.x += applied.x;
        p.z += applied.z;
        } else {
        // Keyboard/stick/touch movement as ONE normalized vector (audit
        // C-5): a diagonal is exactly actualPlayerSpeed, opposite keys
        // cancel to a standstill, and stacked sources clamp to unit length
        // inside moveVector instead of adding a second speed on top.
        const mv = moveVector();
        state.player.position.x += mv.x * state.actualPlayerSpeed * dt;
        state.player.position.z += mv.z * state.actualPlayerSpeed * dt;
        }

        if (state.worldMode === 'endless') {
            // Endless: no wrap, no re-imaging — the world is truly flat and
            // infinite. Ground the player on the terrain under him (plus the
            // jump arc's height above it), stream the monster bubble, advance
            // the distance/difficulty ramp, and keep the floating origin
            // within float-precision range.
            state.player.position.y = groundHeightAt(state.player.position.x, state.player.position.z)
                + state.jumpOffset;
            updateEnemyStreaming(dt);
            updateEndlessProgress();
            rebaseWorldIfNeeded();
        } else {
        // Player Wrapping Logic (preserves overshoot across the seam)
        wrapPosition(state.player.position);

        // Seamless torus rendering: entities SIMULATE on the torus but RENDER
        // at their image nearest the player. Without this, an enemy 2 units
        // across the seam sits invisible ~198 units away until the player
        // wraps. Runs right after the player's canonical wrap so the frame the
        // player jumps ±worldSize, every entity re-images in the SAME frame —
        // visually nothing moves. Positions may now sit outside ±worldBoundary;
        // all gameplay math is torus-aware (worldmath.js), and AABB tests and
        // indicator projection become MORE correct across the seam.
        reimageEntities();

        if (state.ground) {
            state.ground.position.x = state.player.position.x;
            state.ground.position.z = state.player.position.z;
            // The plane moved with the player — slide the grid texture the
            // other way so the pattern stays fixed in the world (plan 015).
            updateGroundScroll();
        }
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
                const prevScale = state.playerScale;
                state.playerScale += growthFactor;
                state.player.scale.set(state.playerScale, state.playerScale, state.playerScale);
                // Group origin at feet, scaling handles height. Endless keeps
                // the terrain-grounded y set earlier this frame.
                if (state.worldMode !== 'endless') state.player.position.y = 0;
                applySpeedMultiplier(); // playerScale changed → refresh the size speed bonus
                // Growth milestone (score-juice pass): crossing a whole
                // MILESTONE_STEP of scale earns a shockwave ring, a rising
                // jingle, and a proud little swell. The epsilon absorbs the
                // float drift of repeated += growthFactor at the boundary.
                if (Math.floor((state.playerScale + 1e-9) / MILESTONE_STEP) >
                    Math.floor((prevScale + 1e-9) / MILESTONE_STEP)) {
                    onGrowthMilestone(state.player.position, state.playerScale);
                    sfx.milestone();
                }
                spawnNearPlayer();
                resetCollectClock();
                sfx.collect();
                rumble(35, 0.25); // Soft pad pulse (no-op if no actuator)
            }
        }
    }
}

// --- Jump (endless only; owner queue item 5) ---
// A fixed ballistic arc on the GAME clock: tryJump is the single entry
// point (Space in input.js + the touch JUMP button), updateJumpPhysics
// integrates it inside update()'s endless branch. No double-jump: airborne
// presses are ignored. XZ momentum carries because movement input keeps
// applying mid-air (the slide just ignores rocks — see the movement block).
// Apex/airtime grow with playerScale so bigger heroes clear more ground.
function jumpLaunchParams() {
    const s = Math.max(1, state.playerScale);
    const apex = JUMP_APEX_HEIGHT + JUMP_APEX_GROWTH * (s - 1);
    const air = JUMP_AIRTIME + JUMP_AIRTIME_GROWTH * (s - 1);
    const gravity = (8 * apex) / (air * air);
    const velocity = (gravity * air) / 2;
    return { gravity, velocity };
}

export function tryJump() {
    if (state.worldMode !== 'endless') return; // Classic Space = pause, untouched
    if (CONTINUOUS_MOVEMENT) return; // The spike owns Space (boost) — no jump there
    if (!state.gameActive || state.isPaused || state.onStartScreen) return;
    if (state.jumpAirborne) return; // No double-jump
    const { gravity, velocity } = jumpLaunchParams();
    state.jumpAirborne = true;
    state.jumpVelocity = velocity;
    state.jumpGravity = gravity; // Locked for this arc (scale mid-air would warp it)
    sfx.jump(); // Rising boing
    onJumpTakeoff(); // Dust kick + crouch squash (squash skipped under reduced motion)
}

function updateJumpPhysics(dt) {
    if (!state.jumpAirborne) return;
    // Prefer the locked per-jump gravity; recompute scale-1 if missing.
    const grav = state.jumpGravity > 0
        ? state.jumpGravity
        : (8 * JUMP_APEX_HEIGHT) / (JUMP_AIRTIME * JUMP_AIRTIME);
    state.jumpVelocity -= grav * dt;
    state.jumpOffset += state.jumpVelocity * dt;
    if (state.jumpOffset <= 0) {
        // Touchdown: the offset rides ON TOP of the terrain height, so the
        // landing spot is wherever the (water-legal) XZ slide ended up.
        state.jumpOffset = 0;
        state.jumpVelocity = 0;
        state.jumpGravity = 0;
        state.jumpAirborne = false;
        sfx.land(); // Soft thump
        onJumpLand(); // Landing dust burst
    }
}

// --- Endless progress: DISTANCE HUD + difficulty ramp ---
// furthestDistance is the run's high-water mark of TRUE distance from the
// start (origin-aware, so a rebase never dents it). It only grows — the
// ramp never relaxes on the walk home. Crossing a RAMP_DISTANCE boundary
// bumps the level, which feeds enemy target height and population
// (enemies.js) and enemy speed (applySpeedMultiplier below).
const milestoneOrigin = { x: 0, y: 0, z: 0 }; // Scratch — never allocated per milestone

function updateEndlessProgress() {
    const p = state.player.position;
    const dist = Math.hypot(p.x + state.worldOrigin.x, p.z + state.worldOrigin.z);
    if (dist <= state.furthestDistance) return;
    // Distance milestone (stage 3): crossing a DISTANCE_MILESTONE_STEP
    // boundary earns a waypoint chime and a lime "DISTANCE N!" popup over
    // the player's head — the exploration counterpart to the growth
    // milestone. Fires once per boundary (furthestDistance only grows).
    const milestone = Math.floor(dist / DISTANCE_MILESTONE_STEP);
    if (milestone > Math.floor(state.furthestDistance / DISTANCE_MILESTONE_STEP)) {
        milestoneOrigin.x = p.x;
        milestoneOrigin.y = p.y + state.playerScale + 0.6; // Above the head; popup pool adds its own rise
        milestoneOrigin.z = p.z;
        spawnTextPopup(milestoneOrigin, `DISTANCE ${milestone * DISTANCE_MILESTONE_STEP}!`, '#76FF03'); // Food lime — reward color
        sfx.distance();
    }
    state.furthestDistance = dist;
    updateDistanceDisplay();
    const level = Math.floor(dist / RAMP_DISTANCE);
    if (level !== state.endlessRampLevel) {
        state.endlessRampLevel = level;
        applySpeedMultiplier(); // Enemy speed carries the ramp factor
    }
}

// --- Floating-origin rebase (endless) ---
// Once |player x/z| passes REBASE_DISTANCE, shift the WHOLE local frame by
// the nearest CHUNK_SIZE multiple of the player's position in one frame:
// player, enemies, food, live particles/popups, terrain chunks, and water
// all move together, and worldOrigin absorbs the offset. Chunk keys derive
// from TRUE coordinates, so no chunk rebuilds — nothing visibly moves. The
// camera recomputes absolutely from the player every frame, so it needs no
// shift. CHUNK_SIZE granularity keeps chunk-local math exact.
function rebaseWorldIfNeeded() {
    const p = state.player.position;
    if (Math.abs(p.x) < REBASE_DISTANCE && Math.abs(p.z) < REBASE_DISTANCE) return;
    const dx = Math.round(p.x / CHUNK_SIZE) * CHUNK_SIZE;
    const dz = Math.round(p.z / CHUNK_SIZE) * CHUNK_SIZE;
    if (dx === 0 && dz === 0) return;
    state.worldOrigin.x += dx;
    state.worldOrigin.z += dz;
    shiftEntityForRebase(state.player, dx, dz);
    for (const enemy of state.enemies) shiftEntityForRebase(enemy, dx, dz);
    shiftPendingSpawns(dx, dz); // Red pre-spawn discs + scheduled coords
    for (const collectible of state.collectibles) {
        collectible.position.x -= dx;
        collectible.position.z -= dz;
    }
    shiftActiveParticles(-dx, -dz);
    shiftTerrain(dx, dz);
    shiftClouds(dx, dz); // Endless cloud anchors are local coords too
}

// Shifts a character group AND its walk-cycle anchors — without the anchor
// shift the stride phase would read the rebase as a 2000-unit sprint.
function shiftEntityForRebase(group, dx, dz) {
    group.position.x -= dx;
    group.position.z -= dz;
    const w = group.userData.walk;
    if (w) {
        w.lastX -= dx;
        w.lastZ -= dz;
    }
}

// --- World mode (product = endless only) ---
// Test/debug: force classic torus (or endless) even mid-session. Used by
// world.spec wrap tests after the product retired the arena UI. The old
// user-facing setWorldMode picker path is gone (audit D-4) — this is the
// ONE remaining mode switch.
export function forceWorldMode(mode) {
    if (mode !== 'classic' && mode !== 'endless') return;
    state.worldMode = mode;
    applyWorldEnvironment();
    updateModeHud();
    if (state.onStartScreen) setupNewGame();
}

// Shows exactly one world per mode: the classic flat plane, or the endless
// terrain root (lazily initialized — a classic-only player never pays for
// terrain resources).
function applyWorldEnvironment() {
    const endless = state.worldMode === 'endless';
    if (endless) initTerrain();
    setTerrainActive(endless);
    setCloudMode(endless); // Exactly one sky: classic pool or streamed clouds
    if (state.ground) state.ground.visible = !endless;
}

// Moves every enemy and collectible to its player-relative nearest torus
// image. torusDeltaComponent returns the shortest signed delta, so this is a
// no-op for entities already on the player's side of the world. Spawn and
// kill paths keep producing canonical positions — they re-image here on the
// next frame (or later this same frame for collectibles).
function reimageEntities() {
    const p = state.player.position;
    for (const enemy of state.enemies) {
        enemy.position.x = p.x + torusDeltaComponent(p.x, enemy.position.x);
        enemy.position.z = p.z + torusDeltaComponent(p.z, enemy.position.z);
    }
    for (const collectible of state.collectibles) {
        collectible.position.x = p.x + torusDeltaComponent(p.x, collectible.position.x);
        collectible.position.z = p.z + torusDeltaComponent(p.z, collectible.position.z);
    }
    // Pending warn discs cross the seam too (audit C-13): without this, a
    // disc scheduled just across the wrap pulses ~worldSize away while its
    // enemy still materializes at the un-imaged coordinate.
    reimagePendingSpawns(nearestImageToPlayer);
}

// Scratch mapper for reimagePendingSpawns — classic-only per-frame path,
// same no-alloc discipline as the rest of the hot loop.
const reimageScratch = { x: 0, z: 0 };
function nearestImageToPlayer(x, z) {
    const p = state.player.position;
    reimageScratch.x = p.x + torusDeltaComponent(p.x, x);
    reimageScratch.z = p.z + torusDeltaComponent(p.z, z);
    return reimageScratch;
}

// --- Perf measurement (plan 020 Step 1) ---
// Wall-clock cost of one full update+render pass, exponentially averaged
// (~20-frame window). DIAGNOSTICS ONLY: this never feeds the simulation —
// game logic keeps using the clamped game clock (dt above). Exposed on the
// debug handle as perfInfo() together with the renderer's draw counters.
let frameMsAvg = 0;

export function perfInfo() {
    const r = state.renderer;
    return {
        calls: r ? r.info.render.calls : 0,
        triangles: r ? r.info.render.triangles : 0,
        geometries: r ? r.info.memory.geometries : 0,
        textures: r ? r.info.memory.textures : 0,
        frameMsAvg
    };
}

// --- Animation Loop ---
// Called by the browser each display frame; `now` is the RAF timestamp (ms).
function animate(now) {
    state.animationFrameId = requestAnimationFrame(animate);
    if (lastFrameTime === null) lastFrameTime = now;
    const dt = Math.min((now - lastFrameTime) / 1000, MAX_DELTA);
    lastFrameTime = now;
    const frameStart = performance.now(); // perfInfo probe — see above
    // Gamepad runs every frame — start/death/pause need button edges even
    // when update() early-returns (paused or no active run).
    pollGamepad();
    if (!state.isPaused) {
        update(dt);
        // Visual effects run on the same clock but OUTSIDE the gameActive
        // gate: a death explosion must finish behind the death screen.
        updateEffects(dt);
    }
    // Endless terrain streams every frame — including on the paused title
    // screen, where the attract camera is watching the world build in.
    if (state.worldMode === 'endless') updateTerrain(dt);
    // Clouds are scenery on the same footing: they drift and bob through
    // pause and the title screen (a breathing sky sells the attract scene),
    // in both modes. Object motion — kept under reduced motion.
    updateClouds(dt);
    // Camera follow and rendering run every frame regardless of pause or
    // game over — the frozen scene must stay visible behind the message box.
    updateCameraPosition(dt);
    state.renderer.render(state.scene, state.camera);
    // Exponential average of the whole update+render body (perfInfo).
    frameMsAvg += (performance.now() - frameStart - frameMsAvg) * 0.05;
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

// Recomputes the actual speeds. The PLAYER's speed gains a size factor —
// a big block should feel powerful, not sluggish — capped so a huge player
// never outruns the fun. Enemies deliberately do NOT get the growth factor:
// hunting getting slightly easier as you grow is the intended relief valve.
// Called on init, on the speed button, and on every collect (playerScale
// changes there, so the size factor must be recomputed).
export function applySpeedMultiplier() {
    const baseSpeedForDevice = state.isMobile ? BASE_PLAYER_SPEED * MOBILE_SPEED_MULTIPLIER : BASE_PLAYER_SPEED;
    const sizeFactor = Math.min(1 + (state.playerScale - 1) * SPEED_GROWTH_FACTOR, SPEED_GROWTH_CAP);
    state.actualPlayerSpeed = baseSpeedForDevice * speedMultipliers[state.currentSpeedMultiplierIndex] * sizeFactor;
    // Enemy speed is DECOUPLED from the player base (owner: the 2x player
    // rebase must not touch enemies). BASE_ENEMY_SPEED is the pre-rebase
    // effective value; the mobile boost stays so enemies are byte-identical
    // to before on every device. Only the multiplier button (which scales
    // the whole world) and the endless ramp below still apply.
    state.actualEnemySpeed = BASE_ENEMY_SPEED
        * (state.isMobile ? MOBILE_SPEED_MULTIPLIER : 1)
        * speedMultipliers[state.currentSpeedMultiplierIndex];
    if (state.worldMode === 'endless') {
        // Distance difficulty ramp: +RAMP_SPEED_STEP per level, capped so a
        // ramped enemy (BASE_ENEMY_SPEED * RAMP_SPEED_MAX = 2.4 u/s) can
        // never outrun the player's base 6. Classic never reads the ramp.
        state.actualEnemySpeed *= Math.min(1 + state.endlessRampLevel * RAMP_SPEED_STEP, RAMP_SPEED_MAX);
    }

    if (el.speedButton) {
        el.speedButton.textContent = `Speed: ${speedMultipliers[state.currentSpeedMultiplierIndex]}x`;
    }
}

// Speed cycle: the button's click handler AND the F key (input.js) — the
// keyboard path must behave exactly like the mouse path.
export function cycleSpeed() {
    state.currentSpeedMultiplierIndex = (state.currentSpeedMultiplierIndex + 1) % speedMultipliers.length;
    applySpeedMultiplier();
}

// Ordered ladder for dedicated faster/slower controls (pad Y/X, keyboard R):
// SPEED_LADDER is DERIVED from speedMultipliers in constants.js (audit D-12
// — this file used to hand-maintain a second copy in a different order).
// The stored array keeps historical order (index 0 = 1.0x) so existing
// tests and the cycle button stay stable; up/down navigate the sorted view.
function indexForMultiplier(value) {
    const i = speedMultipliers.indexOf(value);
    if (i < 0) {
        // A ladder value missing from the cycle array means the derivation
        // above broke — make the miss loud instead of silently jumping to 1x.
        console.warn(`indexForMultiplier: ${value} not in speedMultipliers — falling back to index 0`);
        return 0;
    }
    return i;
}

export function speedUp() {
    const cur = speedMultipliers[state.currentSpeedMultiplierIndex];
    const next = SPEED_LADDER.find((v) => v > cur + 1e-9);
    if (next == null) return false;
    state.currentSpeedMultiplierIndex = indexForMultiplier(next);
    applySpeedMultiplier();
    return true;
}

export function speedDown() {
    const cur = speedMultipliers[state.currentSpeedMultiplierIndex];
    let prev = null;
    for (const v of SPEED_LADDER) {
        if (v < cur - 1e-9) prev = v;
    }
    if (prev == null) return false;
    state.currentSpeedMultiplierIndex = indexForMultiplier(prev);
    applySpeedMultiplier();
    return true;
}

// --- Start the game ---
// Startup call (moved here from the old inline script in index.html).
if (document.readyState === 'complete') {
    init();
} else {
    window.addEventListener('load', init);
}
