// --- Tuning Constants ---
export const growthFactor = 0.1; // How much to grow by each block
export const enemyBaseHeight = 1.2; // Base height of enemy

// --- GAME BALANCE (tune here, nowhere else) ---
export const FOOD_POINTS = 1; // per block (today's behavior)
export const KILL_POINTS = 25; // flat bounty per defeated enemy
export const MAX_ENEMIES = 8; // hard population cap
export const ENEMIES_PER_KILL = 2; // spawned per kill, subject to the cap
export const ENEMY_HEIGHT_FACTOR = 1.5; // new-enemy height vs player (existing value, now named)
export const SPEED_GROWTH_FACTOR = 0.18; // extra speed per point of playerScale above 1 (big = faster)
export const SPEED_GROWTH_CAP = 2.2; // max multiple of base speed the size bonus can ever reach
export const SIZE_BOUNTY_PER_UNIT = 5; // extra kill points per whole unit of the enemy's scaled body height
export const COMBO_WINDOW = 4; // seconds after a kill in which the next kill escalates the combo
export const COMBO_MAX = 5; // combo multiplier cap (x1..x5)
export const MILESTONE_STEP = 1.0; // playerScale interval that fires a growth-milestone celebration

// Tension systems (awesome pass): make danger and urgency legible.
export const PANIC_TIME = 5; // Collect-countdown seconds at/below which panic engages (red pulse, tick sfx, food arrow)
export const DANGER_RADIUS = 9; // A non-killable enemy within this distance = danger (vignette + heartbeat)
export const DANGER_VIGNETTE_MAX = 0.22; // Peak opacity of the red danger vignette — subtle, must never obscure play
export const HEARTBEAT_BPM = 72; // Danger heartbeat tempo (one low lub-dub per beat, very quiet)
export const SPAWN_MATERIALIZE_TIME = 0.5; // Seconds a newly spawned enemy takes to scale in (no move/collide while forming)
export const SPAWN_MATERIALIZE_START_SCALE = 0.05; // Fraction of full size a materializing enemy starts at

// Spectacle systems (awesome pass): title, death, and finish.
export const DEATH_SQUASH_TIME = 0.32; // Seconds the player takes to squash flat before bursting (skipped under reduced motion)
export const DEATH_SCREEN_DELAY = 0.9; // Seconds between the death and the death screen — the cinematic beat
export const ATTRACT_ORBIT_PERIOD = 12; // Seconds per full attract-mode camera revolution on the start overlay
export const ATTRACT_EASE_TIME = 0.6; // Seconds the camera takes to swing between attract orbit and gameplay framing

// Speed Multiplier Variables
export const speedMultipliers = [1.0, 1.5, 2.0, 3.0, 5.0, 0.5]; // ADDED 5.0x, re-ordered

// Camera zoom model (bounded two-way zoom; see plan 006)
export const ZOOM_STEP = 1.25; // Multiplier applied per zoom button click
export const ZOOM_MIN = 0.6; // Slightly closer than default
export const ZOOM_MAX = 3.0; // ~2.9x default distance, still inside a scaled fog
export const GROWTH_FRAME_FACTOR = 0.35; // How much camera pulls back per unit of playerScale growth
export const INITIAL_CAMERA_Y_OFFSET = 15; // Base Y offset
export const INITIAL_CAMERA_Z_OFFSET = 12; // Base Z offset

// Movement and speed constants (units are per SECOND — applied × dt each frame)
export const BASE_PLAYER_SPEED = 3.0; // units/s (was 0.05/frame at 60fps)
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
export const AVOID_SPEED_FACTOR = 1.2; // Enemy-separation steering strength, as a multiple of enemy speed (pre-cap; see plan 005)
export const BASE_ENEMY_SPAWN_DISTANCE = 30; // Base spawn distance for new enemies
export const SPAWN_DISTANCE_SCALE_FACTOR = 10; // Scaling of spawn distance with player size

// Collect Timer
export const initialCollectTime = 15; // MODIFIED from 10 to 15 seconds

// Off-Screen Enemy Indicator
export const MAX_ENEMY_INDICATORS = 10; // Max number of indicators to show

// Footstep dust (game-feel pass) — soft pooled puffs on each stride plant.
// Deliberately tiny numbers: it must read as dust kicked up by feet, not smoke.
export const DUST_PARTICLES_PER_STEP = 5; // Pooled particles per foot plant
export const DUST_LIFE = 0.5; // Seconds a puff lives (long enough to clear the heel)
export const DUST_SPEED = 1.0; // Outward drift, units/s (low = soft)
export const DUST_COLOR_FROM = 0xB2DFDB; // Pale teal-white puff...
export const DUST_COLOR_TO = 0x6B9E97; // ...settling toward the ground teal

// Score juice (score-juice pass) — floating "+N" popups and the kill
// micro-shake. Sizes are world units; times are seconds.
export const POPUP_RISE = 1.5; // How far a score popup floats up over its life
export const POPUP_LIFE = 0.8; // Seconds a score popup lives
export const SHAKE_DURATION = 0.12; // Kill micro-shake length
export const SHAKE_AMPLITUDE = 0.15; // Max camera offset at shake start (decays to 0)

// --- ENDLESS WORLD (terrain engine) ---
// Streaming, noise, water, and the curved horizon. Every value here is
// endless-mode only: classic mode never reads them.
export const CHUNK_SIZE = 32; // World units per terrain chunk (also the floating-origin rebase grain)
export const CHUNK_SEGMENTS = 24; // PlaneGeometry segments per chunk side (625 verts)
export const CHUNK_WINDOW_RADIUS = 3; // Chunks streamed around the player: (2r+1)^2 = 7x7 window
export const CHUNK_RELEASE_RADIUS = 4; // Chunks released to the pool beyond this ring (hysteresis margin)
export const CHUNK_BUILDS_PER_FRAME = 2; // Build-queue budget — nearest chunks first
export const TERRAIN_AMPLITUDE = 3.75; // Height scale: typical rolling hills ~±2.5, rare tail extremes ~±3.4
export const TERRAIN_WAVELENGTH = 24; // Feature wavelength of the hill octave (continents run 4x longer)
export const TERRAIN_SEED = 20260726; // World seed — deterministic terrain, rocks, and food scatter
export const WATER_LEVEL = -0.9; // Terrain below this is lake (~25% of the world at this amplitude)
export const CURVE_STRENGTH = 0.0012; // Curved-horizon bend: y -= dist^2 * this (≈4.3u drop at 60u)
export const REBASE_DISTANCE = 2048; // |player x/z| beyond this triggers a floating-origin rebase
export const SPAWN_MESA_RADIUS = 48; // Terrain within this radius of the run start is lifted to dry land
export const ROCKS_PER_CHUNK_MAX = 3; // Seeded voxel boulders per chunk (1..this), never in water
export const ROCK_SPAWN_CLEARANCE = 8; // No rocks within this distance of the run-start point

// --- ENDLESS WORLD (gameplay streaming — stage 2) ---
// Collision, food/monster streaming, and the distance difficulty ramp.
// Endless-mode only; classic never reads these.
export const WATER_WALK_MARGIN = 0.05; // Terrain must clear WATER_LEVEL by this much to be walkable
export const COLLIDER_RADIUS_FACTOR = 0.45; // Entity collision radius as a fraction of its body height
export const ROCK_COLLIDER_FACTOR = 0.7; // Rock collision-circle radius as a fraction of the boulder's base size
export const ENEMY_WEDGE_TIME = 2; // Seconds a chasing enemy may be fully blocked before detouring
export const ENEMY_DETOUR_TIME = 1; // Seconds the 45-degree detour heading is held
// Playtest-tuned (stage 3): the run BUILDS pressure instead of opening at
// max. At the old target 7 + 0.45s refill, all three scripted playtest
// styles died inside 70 game-seconds (hunter 14s, sprinter 9s) with the
// distance ramp never engaging — seven hunters converge on a scale-1 player
// before the second collect. Target 4 (+1 per ramp level) passes through
// the design's 6-9 band at 300-750u and hits the cap 12 at 1200u.
export const ENDLESS_ENEMY_TARGET = 4; // Enemies maintained in the bubble at ramp level 0 (+1 per level)
export const ENDLESS_ENEMY_CAP = 12; // Hard endless population cap (ramp target never exceeds it)
export const ENEMY_DESPAWN_RADIUS = 80; // Enemies beyond this distance are removed AND disposed
export const ENDLESS_SPAWN_MIN = 35; // Bubble spawns land between MIN and MAX units from the player...
export const ENDLESS_SPAWN_MAX = 50; // ...far enough to materialize unseen, near enough to matter
export const ENDLESS_SPAWN_INTERVAL = 1.25; // Seconds between bubble top-up spawns (was 0.45 — a cleared pocket stays clear for a breath; kill-spawns still land instantly)
export const RAMP_DISTANCE = 150; // Every this many units of furthest distance = +1 difficulty level
export const RAMP_HEIGHT_STEP = 0.2; // Extra enemy target-height factor per ramp level (+20%)
export const RAMP_SPEED_STEP = 0.05; // Extra enemy speed factor per ramp level (+5%)
export const RAMP_SPEED_MAX = 1.6; // Speed ramp cap: 0.5x base * 1.6 = 0.8x — always outrunnable
export const FOOD_PER_CHUNK_MIN = 3; // Seeded food per streamed chunk (land only)...
export const FOOD_PER_CHUNK_MAX = 5; // ...plentiful on purpose: the pressure is routing, not scarcity
export const FOOD_WATER_CLEARANCE = 0.2; // Food needs terrain this far above WATER_LEVEL (not at the brink)

// --- ENDLESS WORLD (spectacle + tuning — stage 3) ---
// Biome tint, shoreline band, water depth shading, distance milestones, and
// the attract-camera terrain clearance. Endless-mode only.
export const BIOME_WAVELENGTH = 300; // Ultra-low-frequency tint regions (~10 chunks across) — areas feel discovered
export const BIOME_TINT_STRENGTH = 0.12; // Peak per-channel g/b shift of the biome tint (subtle, teal family only)
export const SHORE_BAND_HEIGHT = 0.30; // Terrain within this height above WATER_LEVEL wears the waterline band
export const SHORE_BAND_BOOST = 0.5; // Peak extra brightness of the waterline band (feathers to 0 at the band edge)
export const WATER_DEPTH_RANGE = 2.4; // Lakebed depth below WATER_LEVEL over which the water darkens fully
export const WATER_DEEP_TINT = 0.38; // Vertex tint at full depth (1.0 at the shore) — deeper reads darker
export const WATER_SNAP = 12; // The water plane follows the player in steps of this (recolors per step, not per frame)
export const DISTANCE_MILESTONE_STEP = 250; // Every this many units of furthest distance: chime + DISTANCE popup
export const CAMERA_TERRAIN_CLEARANCE = 2.5; // The camera never dips closer than this to the terrain under it (endless)

// --- Movement mode flag (plan 014 design spike) ---
// `?move=continuous` opts into the Little Big Snake-style prototype
// (src/movement-continuous.js). Any other value — including no param at all —
// selects 'classic', whose behavior is untouched by the spike.
export const MOVEMENT_MODE =
    new URLSearchParams(location.search).get('move') === 'continuous' ? 'continuous' : 'classic';
