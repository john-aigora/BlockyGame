import { INITIAL_CAMERA_Y_OFFSET, INITIAL_CAMERA_Z_OFFSET, initialCollectTime } from './constants.js';

// Single mutable state object shared by all modules. This repo pattern is
// deliberate — plain shared-state arcade game, not a framework.
export const state = {
  // World mode: 'classic' (the original 200x200 torus arena) or 'endless'
  // (streamed infinite terrain). Chosen on the start overlay, persisted by
  // hiscores.js (the storage owner). EVERY endless behavior branches on
  // this — classic stays byte-equivalent.
  worldMode: 'classic',
  // Floating origin (endless): accumulated true-world offset of the local
  // coordinate frame. trueX = position.x + worldOrigin.x. Rebase shifts it
  // by CHUNK_SIZE multiples so chunk keys never change.
  worldOrigin: { x: 0, z: 0 },
  // Endless progress: the furthest TRUE distance from the run start reached
  // this run (the DISTANCE HUD + death-screen stat), and the difficulty
  // ramp level it implies (floor(furthest / RAMP_DISTANCE); drives enemy
  // height/speed/population — see enemies.js + applySpeedMultiplier).
  furthestDistance: 0,
  endlessRampLevel: 0,
  // Jump (endless only; game.js owns the physics on the game clock).
  // jumpOffset is the height ABOVE the terrain — player y = ground + offset.
  // Classic never jumps: all three stay at rest there.
  jumpOffset: 0,
  jumpVelocity: 0,
  jumpAirborne: false,
  // Scene, camera, and renderer are fundamental to Three.js
  scene: null,
  camera: null,
  renderer: null,
  // Game objects
  player: null,
  ground: null,
  collectibles: [], // Array to store collectible items
  enemies: [], // Array to store multiple enemies
  // Game state
  score: 0,
  gameActive: false,
  onStartScreen: true, // True while the start overlay is up (boot / post-death menu)
  playerScale: 1, // Track player's current scale
  isPaused: false, // Track if game is paused
  killIndicatorVisible: true, // For flashing kill indicator (starts visible)
  killFlashClock: 0, // Seconds accumulated toward the next kill-indicator flash toggle
  comboCount: 0, // Current kill-combo multiplier (0/1 = no combo; capped at COMBO_MAX)
  comboTimeLeft: 0, // Game-clock seconds left in the combo window (ticked in timers.js)
  dangerOpacity: 0, // Eased base opacity of the danger vignette (ui.js drives it toward DANGER_VIGNETTE_MAX)
  heartbeatClock: 0, // Game-clock seconds until the next danger heartbeat (0 = fire on danger entry)
  animationFrameId: null, // requestAnimationFrame handle

  // Speed Multiplier Variables
  currentSpeedMultiplierIndex: 0,
  actualPlayerSpeed: undefined, // Will store the fully adjusted player speed
  actualEnemySpeed: undefined, // Will store the fully adjusted enemy speed
  playerSpeed: undefined, // To be set in init

  // Camera zoom model (bounded two-way zoom; camY/camZ are the smoothed
  // actual offsets, driven toward the zoom/growth target each frame)
  zoomLevel: 1.0,
  camY: INITIAL_CAMERA_Y_OFFSET,
  camZ: INITIAL_CAMERA_Z_OFFSET,

  // Touch-anywhere control variables
  touchActive: false,
  gameScreenContainer: null,
  touchStartPoint: { x: 0, y: 0 },
  currentTouchPoint: { x: 0, y: 0 },
  movementVector: { x: 0, y: 0 },

  // HTML Element references
  gameContainer: null, // The div that will hold the Three.js canvas

  // Collect Timer variables (runs on the game clock, in seconds)
  collectTimeLeft: initialCollectTime,
  lastShownCollectTime: initialCollectTime, // Last integer written to the DOM

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
};
