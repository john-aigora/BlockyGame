import { INITIAL_CAMERA_Y_OFFSET, INITIAL_CAMERA_Z_OFFSET, initialCollectTime, SURVIVAL_BEAT_COOLDOWN } from './constants.js';

// --- Per-player state (plan 026) ---
// Everything that describes ONE hero lives here; the world (enemies, terrain,
// score-agnostic clocks, streaming) stays on `state`. THE single construction
// path — pets/ghosts/spectators must build on this too (maintenance note).
export function makePlayerState(seat = 0) {
    return {
        seat, // 0 = left half / P1, 1 = right half / P2
        alive: true, // false = spectator (their half shows the partner cam)
        // Ascension (plan 029): `ascension` is the transient ceremony state
        // machine (null = not ascending); `ascended` is the sticky won-flag
        // for the end screen and board rows. Both reset in setupNewGame.
        ascension: null,
        ascended: false,
        mesh: null, // THREE.Group built by createPlayer
        camera: null, // Per-player PerspectiveCamera (world.js owns follow/zoom)
        scale: 1, // Gameplay height (the render scale follows it on collect)
        score: 0,
        collectTimeLeft: initialCollectTime, // Per-player 15s clock (timers.js)
        lastShownCollectTime: initialCollectTime, // Last integer written to THEIR readout
        distanceBest: 0, // This player's furthest true distance (HUD + death column)
        // Speed toy index into speedMultipliers (independent per seat in 2P —
        // pad Y/X and F/R only touch that seat). actualSpeed is recomputed
        // from this + size bonus by applySpeedMultiplier.
        speedMultiplierIndex: 0,
        actualSpeed: undefined, // Fully adjusted move speed (size bonus is per player)
        // Jump arc (endless; game.js owns the physics on the game clock).
        // offset is height ABOVE the terrain — mesh y = ground + offset.
        jump: { offset: 0, velocity: 0, gravity: 0, airborne: false },
        comboCount: 0, // Kill-combo multiplier (0/1 = none; cap COMBO_MAX)
        comboTimeLeft: 0, // Game-clock seconds left in THEIR combo window
        killFlashClock: 0, // Seconds toward the next KILL! flash toggle (their half)
        killIndicatorVisible: true,
        dangerOpacity: 0, // Eased base opacity of THEIR danger vignette
        dangerPeak: 0, // Max dangerOpacity since last drain — a real scare's release earns THEIR PHEW!
        lastSurvivalBeat: -SURVIVAL_BEAT_COOLDOWN, // PHEW!/CLOSE ONE! rate limit, per player
        heartbeatClock: 0, // Game-clock seconds to THEIR next danger heartbeat
        // Camera zoom model: the smoothed actual offsets (zoom LEVEL is shared
        // world state — per-player zoom is out of v1 scope). camAnchorY is the
        // endless vertical-follow smoothing (world.js) — per camera.
        camY: INITIAL_CAMERA_Y_OFFSET,
        camZ: INITIAL_CAMERA_Z_OFFSET,
        camAnchorY: 0,
        // Region tracking (plan 025 → per player): the CONFIRMED region THIS
        // player is in + the debounce candidate. regionsVisited stays SHARED
        // on state — discovery is a world-level, either-player event.
        regionKey: null,
        regionCandidateKey: null,
        regionCandidateSince: 0,
        // Visual transients (effects.js): collect squash, milestone pulse,
        // and the cinematic death squash — per hero, so one player's beat
        // never deforms the other.
        squashTime: 0,
        pulseTime: 0,
        deathSquashTime: 0,
    };
}

// Single mutable state object shared by all modules. This repo pattern is
// deliberate — plain shared-state arcade game, not a framework.
//
// PLAYER FIELD COMPAT (plan 026): the accessor properties below delegate the
// classic singleton names (playerScale, score, collectTimeLeft, jump*, ...)
// to players[0]. They are the STABLE solo/test surface — the Playwright
// suites read and write these through window.__game.state — while all game
// code iterates state.players. `player` and `camera` are plain fields kept
// in sync by createPlayer/createCameraFor (their identities only change
// there), so no getter indirection hides the hot references.
export const state = {
    // World mode: product is endless-only. 'classic' remains as a test/debug
    // path (torus arena) via __game.debug.forceWorldMode — not user-facing.
    worldMode: 'endless',
    // Floating origin (endless): accumulated true-world offset of the local
    // coordinate frame. trueX = position.x + worldOrigin.x. Rebase shifts it
    // by CHUNK_SIZE multiples so chunk keys never change.
    worldOrigin: { x: 0, z: 0 },
    // Endless progress: the furthest TRUE distance any player reached this
    // run — max over players[].distanceBest (identical to the solo value
    // with one player) — and the difficulty ramp level it implies
    // (floor(furthest / RAMP_DISTANCE); drives enemy height/speed/population
    // — see enemies.js + applySpeedMultiplier).
    furthestDistance: 0,
    endlessRampLevel: 0,
    // Named biome regions (plan 025): every region key ANY player visited
    // this run (the death screen's REGIONS count) — discovery is shared;
    // per-player current-region tracking lives on each player state.
    regionsVisited: new Set(),
    // The 1000u titan (plan 025): true once this run's boss beat has fired —
    // one titan per run, reset by setupNewGame (which also disposes a live
    // boss with the rest of state.enemies and drops a pending boss warn via
    // clearPendingSpawns — the despawn exemption never outlives its run).
    bossSpawned: false,
    // Scene, camera, and renderer are fundamental to Three.js.
    // camera is ALWAYS players[0].camera (synced where it is created).
    scene: null,
    camera: null,
    renderer: null,
    // Game objects. player is ALWAYS players[0].mesh (synced in createPlayer).
    players: [makePlayerState(0)],
    player: null,
    ground: null,
    collectibles: [], // Array to store collectible items
    enemies: [], // Array to store multiple enemies
    // Game state
    gameActive: false,
    onStartScreen: true, // True while the start overlay is up (boot / post-death menu)
    isPaused: false, // Track if game is paused

    // --- players[0] delegation (the classic singleton names) ---
    get playerScale() { return this.players[0].scale; },
    set playerScale(v) { this.players[0].scale = v; },
    get score() { return this.players[0].score; },
    set score(v) { this.players[0].score = v; },
    get collectTimeLeft() { return this.players[0].collectTimeLeft; },
    set collectTimeLeft(v) { this.players[0].collectTimeLeft = v; },
    get lastShownCollectTime() { return this.players[0].lastShownCollectTime; },
    set lastShownCollectTime(v) { this.players[0].lastShownCollectTime = v; },
    get jumpOffset() { return this.players[0].jump.offset; },
    set jumpOffset(v) { this.players[0].jump.offset = v; },
    get jumpVelocity() { return this.players[0].jump.velocity; },
    set jumpVelocity(v) { this.players[0].jump.velocity = v; },
    get jumpGravity() { return this.players[0].jump.gravity; },
    set jumpGravity(v) { this.players[0].jump.gravity = v; },
    get jumpAirborne() { return this.players[0].jump.airborne; },
    set jumpAirborne(v) { this.players[0].jump.airborne = v; },
    get comboCount() { return this.players[0].comboCount; },
    set comboCount(v) { this.players[0].comboCount = v; },
    get comboTimeLeft() { return this.players[0].comboTimeLeft; },
    set comboTimeLeft(v) { this.players[0].comboTimeLeft = v; },
    get killIndicatorVisible() { return this.players[0].killIndicatorVisible; },
    set killIndicatorVisible(v) { this.players[0].killIndicatorVisible = v; },
    get killFlashClock() { return this.players[0].killFlashClock; },
    set killFlashClock(v) { this.players[0].killFlashClock = v; },
    get dangerOpacity() { return this.players[0].dangerOpacity; },
    set dangerOpacity(v) { this.players[0].dangerOpacity = v; },
    get dangerPeak() { return this.players[0].dangerPeak; },
    set dangerPeak(v) { this.players[0].dangerPeak = v; },
    get lastSurvivalBeat() { return this.players[0].lastSurvivalBeat; },
    set lastSurvivalBeat(v) { this.players[0].lastSurvivalBeat = v; },
    get heartbeatClock() { return this.players[0].heartbeatClock; },
    set heartbeatClock(v) { this.players[0].heartbeatClock = v; },
    get camY() { return this.players[0].camY; },
    set camY(v) { this.players[0].camY = v; },
    get camZ() { return this.players[0].camZ; },
    set camZ(v) { this.players[0].camZ = v; },
    get actualPlayerSpeed() { return this.players[0].actualSpeed; },
    set actualPlayerSpeed(v) { this.players[0].actualSpeed = v; },
    get regionKey() { return this.players[0].regionKey; },
    set regionKey(v) { this.players[0].regionKey = v; },

    animationFrameId: null, // requestAnimationFrame handle

    // Speed multiplier index: delegates to seat 0 so solo/tests that read or
    // write state.currentSpeedMultiplierIndex keep working. Each seat's own
    // index lives on players[i].speedMultiplierIndex (independent in 2P).
    get currentSpeedMultiplierIndex() { return this.players[0].speedMultiplierIndex; },
    set currentSpeedMultiplierIndex(v) { this.players[0].speedMultiplierIndex = v; },
    // applySpeedMultiplier (game.js) recomputes player actualSpeed (per seat)
    // and actualEnemySpeed (world: max living player mult + ramp).
    actualEnemySpeed: undefined, // Will store the fully adjusted enemy speed
    // Coop per-seat enemy pace (plan 031, audit C-15): a hunter runs at the
    // pace its TARGET's seat multiplier sets, so no seat's 5x toy can make
    // another seat's hunters unoutrunnable. Solo never reads this array
    // (enemies.js falls through to actualEnemySpeed — byte-stable).
    enemyPaceForSeat: [undefined, undefined],

    // Camera zoom model: the LEVEL is shared (per-player zoom is out of v1);
    // the smoothed camY/camZ offsets live per player.
    zoomLevel: 1.0,

    // Touch-anywhere control variables (touch always drives seat 0)
    touchActive: false,
    touchStartPoint: { x: 0, y: 0 },
    currentTouchPoint: { x: 0, y: 0 },
    movementVector: { x: 0, y: 0 },

    // HTML Element references
    // The div that holds the Three.js canvas AND doubles as the touch-drag
    // control surface (the old duplicate screen-container ref is merged into
    // this one — audit D-10).
    gameContainer: null,

    // Run clock: game-time seconds simulated in the current run (dt-accumulated
    // in update(); frozen by pause and death; reset by setupNewGame). The
    // Playwright suites time gameplay against THIS clock: under parallel-suite
    // load, headless frame rates fall low enough that the MAX_DELTA frame clamp
    // (game.js) dilates game time well below wall time, so wall-clock timing
    // of game-clock behavior would misread a perfectly healthy simulation.
    runTime: 0,

    isMobile: false, // For mobile-specific adjustments

    // Off-Screen Enemy Indicator Variables
    enemyIndicators: [],
    offscreenIndicatorContainer: null,

    // Game Area Screen Coords (for indicators)
    gameCanvasRect: { left: 0, top: 0, width: 0, height: 0 }, // Store game container dimensions
    gameCanvasCenterX: 0,
    gameCanvasCenterY: 0,
    // Render-buffer sizes (plan 031, audit P-13): clientWidth/Height as of
    // the last onWindowResize — what renderer.setSize used. DISTINCT from
    // gameCanvasRect (border-inclusive, for touch/indicator screen math).
    viewW: 0,
    viewH: 0,
};

// Living players, in seat order. Allocates — fine for per-event paths; the
// per-frame hot loops iterate state.players with an alive check instead.
export function alivePlayers() {
    return state.players.filter((p) => p.alive);
}
