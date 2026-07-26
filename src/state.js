import { INITIAL_CAMERA_Y_OFFSET, INITIAL_CAMERA_Z_OFFSET, initialCollectTime } from './constants.js';

// Single mutable state object shared by all modules. This repo pattern is
// deliberate — plain shared-state arcade game, not a framework.
export const state = {
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
  playerScale: 1, // Track player's current scale
  isPaused: false, // Track if game is paused
  killIndicatorVisible: false, // For flashing kill indicator

  // Speed Multiplier Variables
  currentSpeedMultiplierIndex: 0,
  actualPlayerSpeed: undefined, // Will store the fully adjusted player speed
  actualEnemySpeed: undefined, // Will store the fully adjusted enemy speed
  playerSpeed: undefined, // To be set in init

  // Zoom Variables - REVISED
  activeCameraYOffset: INITIAL_CAMERA_Y_OFFSET,
  activeCameraZOffset: INITIAL_CAMERA_Z_OFFSET,

  // Touch-anywhere control variables
  touchActive: false,
  gameScreenContainer: null,
  touchStartPoint: { x: 0, y: 0 },
  currentTouchPoint: { x: 0, y: 0 },
  movementVector: { x: 0, y: 0 },

  // HTML Element references
  gameContainer: null, // The div that will hold the Three.js canvas

  // Collect Timer variables
  collectTimerValue: initialCollectTime,
  collectTimerInterval: null, // Stores the interval ID for the collect timer

  isMobile: false, // For mobile-specific adjustments

  // Off-Screen Enemy Indicator Variables
  enemyIndicators: [],
  offscreenIndicatorContainer: null,

  // Game Area Screen Coords (for indicators)
  gameCanvasRect: { left: 0, top: 0, width: 0, height: 0 }, // Store game container dimensions
  gameCanvasCenterX: 0,
  gameCanvasCenterY: 0,
};
