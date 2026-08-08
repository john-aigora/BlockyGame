import { INITIAL_CAMERA_Y_OFFSET, INITIAL_CAMERA_Z_OFFSET, initialCollectTime, SURVIVAL_BEAT_COOLDOWN } from './constants.js';

// Single mutable state object shared by all modules. This repo pattern is
// deliberate — plain shared-state arcade game, not a framework.
export const state = {
  // World mode: product is endless-only. 'classic' remains as a test/debug
  // path (torus arena) via __game.debug.forceWorldMode — not user-facing.
  worldMode: 'endless',
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
  // Named biome regions (plan 025): the CONFIRMED region key the player is
  // in (debounced in game.js — shorelines flicker) and every region key
  // visited this run (the death screen's REGIONS count). The spawn region
  // seeds both at setupNewGame, without a banner — you start somewhere,
  // you don't "discover" it.
  regionKey: null,
  regionsVisited: new Set(),
  // Jump (endless only; game.js owns the physics on the game clock).
  // jumpOffset is the height ABOVE the terrain — player y = ground + offset.
  // The retired classic test path never jumps (tryJump guards on the mode):
  // all four fields stay at rest there.
  jumpOffset: 0,
  jumpVelocity: 0,
  jumpGravity: 0, // Locked at takeoff so mid-air size changes do not warp the arc
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
  dangerPeak: 0, // Max dangerOpacity since it last drained to ~0 — a real scare's release earns a PHEW! (ui.js)
  lastSurvivalBeat: -SURVIVAL_BEAT_COOLDOWN, // runTime of the last survival popup; PHEW!/CLOSE ONE! share this rate limit (negative start = the first beat is free)
  heartbeatClock: 0, // Game-clock seconds until the next danger heartbeat (0 = fire on danger entry)
  animationFrameId: null, // requestAnimationFrame handle

  // Speed Multiplier Variables — applySpeedMultiplier (game.js) recomputes
  // both actual speeds from constants + device + ramp; they are the ONLY
  // speed fields (a third, write-only field was deleted — audit D-10).
  currentSpeedMultiplierIndex: 0,
  actualPlayerSpeed: undefined, // Will store the fully adjusted player speed
  actualEnemySpeed: undefined, // Will store the fully adjusted enemy speed

  // Camera zoom model (bounded two-way zoom; camY/camZ are the smoothed
  // actual offsets, driven toward the zoom/growth target each frame)
  zoomLevel: 1.0,
  camY: INITIAL_CAMERA_Y_OFFSET,
  camZ: INITIAL_CAMERA_Z_OFFSET,

  // Touch-anywhere control variables
  touchActive: false,
  touchStartPoint: { x: 0, y: 0 },
  currentTouchPoint: { x: 0, y: 0 },
  movementVector: { x: 0, y: 0 },

  // HTML Element references
  // The div that holds the Three.js canvas AND doubles as the touch-drag
  // control surface (the old duplicate screen-container ref is merged into
  // this one — audit D-10).
  gameContainer: null,

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
