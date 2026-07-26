// --- Tuning Constants ---
export const growthFactor = 0.1; // How much to grow by each block
export const enemyBaseHeight = 1.2; // Base height of enemy

// Speed Multiplier Variables
export const speedMultipliers = [1.0, 1.5, 2.0, 3.0, 5.0, 0.5]; // ADDED 5.0x, re-ordered

// Zoom Variables - REVISED
export const ZOOM_OUT_FACTOR = 1.5;
export const INITIAL_CAMERA_Y_OFFSET = 15; // Base Y offset
export const INITIAL_CAMERA_Z_OFFSET = 12; // Base Z offset

// Movement and speed constants
export const BASE_PLAYER_SPEED = 0.05; // Player speed reduced to 1/4 of previous base
export const MOBILE_SPEED_MULTIPLIER = 1.75; // Player is 75% faster on mobile than desktop base
export const MAX_DRAG_DISTANCE = 75;
export const DEAD_ZONE_RADIUS = 10;

// World and spawning parameters
export const worldSize = 200; // Defines the size of the ground plane (illusion of infinite space)
export const worldBoundary = worldSize / 2; // Define world boundary for wrapping
export const initialFoodDensityArea = 1000; // Target one food item per this many square units for initial spawn
export const collectibleSpawnRadius = 30; // How far from the player new collectibles can appear
export const minSpawnDistanceFromPlayer = 5; // Minimum distance a new collectible spawns from player
export const enemyStartOffset = 10; // Initial distance of enemy from player
export const engagementRadius = 15; // Enemies within this radius will try to orbit
export const orbitStrengthFactor = 0.4; // How strongly enemies try to orbit (0 to 1)
export const enemyRandomDriftFactor = 0.3; // How strong the random drift is, relative to enemy speed
export const BASE_ENEMY_SPAWN_DISTANCE = 30; // Base spawn distance for new enemies
export const SPAWN_DISTANCE_SCALE_FACTOR = 10; // Scaling of spawn distance with player size

// Collect Timer
export const initialCollectTime = 15; // MODIFIED from 10 to 15 seconds

// Off-Screen Enemy Indicator
export const MAX_ENEMY_INDICATORS = 10; // Max number of indicators to show
