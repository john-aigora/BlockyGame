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
// Enemy pace is DECOUPLED from the player base (owner: doubling the player
// must NOT speed enemies up). 1.5 is the exact pre-rebase effective enemy
// base (old 3.0 player base × the old 0.5 enemy factor) — enemies unchanged.
export const BASE_ENEMY_SPEED = 1.5; // units/s at 1x, before the multiplier button / endless ramp
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
// Red ground warn BEFORE the monster appears — notice time for the player.
export const SPAWN_WARN_TIME = 0.95; // Seconds the red pulse sits on the ground before materialize
export const SPAWN_WARN_RADIUS = 1.35; // Base ring radius (scaled up a bit with the enemy)

// Spectacle systems (awesome pass): title, death, and finish.
export const DEATH_SQUASH_TIME = 0.32; // Seconds the player takes to squash flat before bursting (skipped under reduced motion)
export const DEATH_SCREEN_DELAY = 0.9; // Seconds between the death and the death screen — the cinematic beat
export const ATTRACT_ORBIT_PERIOD = 12; // Seconds per full attract-mode camera revolution on the start overlay
export const ATTRACT_EASE_TIME = 0.6; // Seconds the camera takes to swing between attract orbit and gameplay framing

// Speed Multiplier Variables
export const speedMultipliers = [1.0, 1.5, 2.0, 3.0, 5.0, 0.5]; // ADDED 5.0x, re-ordered
// ONE ladder (audit D-12): the sorted view used by the dedicated
// faster/slower controls (pad Y/X, keyboard R) is DERIVED from the cycle
// array above — never hand-write a second copy (game.js carried one and
// the two orders drifted apart).
export const SPEED_LADDER = [...speedMultipliers].sort((a, b) => a - b);

// Camera zoom model (bounded two-way zoom; see plan 006)
export const ZOOM_STEP = 1.25; // Multiplier applied per zoom button click
export const ZOOM_MIN = 0.6; // Slightly closer than default
export const ZOOM_MAX = 3.0; // ~2.9x default distance, still inside a scaled fog
export const GROWTH_FRAME_FACTOR = 0.35; // How much camera pulls back per unit of playerScale growth
export const INITIAL_CAMERA_Y_OFFSET = 15; // Base Y offset
export const INITIAL_CAMERA_Z_OFFSET = 12; // Base Z offset

// Movement and speed constants (units are per SECOND — applied × dt each frame)
export const BASE_PLAYER_SPEED = 6.0; // units/s — owner playtest: "1x should be twice as fast" (was 3.0)
export const MOBILE_SPEED_MULTIPLIER = 1.75; // Player is 75% faster on mobile than desktop base
export const MAX_DRAG_DISTANCE = 75;
export const DEAD_ZONE_RADIUS = 10;
// Physical gamepads: axes below this magnitude read as zero (noise floor +
// stick rest drift). 0.2 is standard for the HTML Gamepad API "standard" mapping.
export const GAMEPAD_DEADZONE = 0.2;
// Ease-in after deadzone: 1 = linear, >1 softens small tilts (arcade analog walk).
export const GAMEPAD_STICK_CURVE = 1.35;

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
// HONEST COLLISION (owner, twice-reported: "stuck where it looks like we
// should be able to get through"). The rules are now visual: colliders are
// the TRUE half-width of the body block, the walkable boundary is the
// VISIBLE shoreline, and rock circles match the boulder's visible base.
// If it looks like it fits, it fits; a genuinely-too-big block honestly
// fails to fit — that's fair.
export const WATER_WALK_MARGIN = 0.02; // Walkable = terrain clears WATER_LEVEL by this hair (was 0.05 —
// that margin, over shore slopes, blocked up to ~1.5u bands of VISUALLY DRY
// beach; reproduced at seed spot (224, -134): h=-0.854, dry above WL=-0.9,
// old rule said water). Feet may now touch the waterline — honestly.
export const PLAYER_COLLIDER_HALF_WIDTH = 0.54; // The hero body is 1.08 wide → true visual half-width × playerScale
export const ENEMY_COLLIDER_HALF_WIDTH = 0.6; // The enemy body cube is 1.2 wide → true visual half-width × scale.y
// (Both replace COLLIDER_RADIUS_FACTOR 0.45 × body HEIGHT — a height-based
// radius was a lie about width in both directions.)
export const ROCK_COLLIDER_FACTOR = 0.55; // Rock collision-circle radius as a fraction of the boulder's base size.
// Audit vs the mesh: the base block's half-extent is 0.425-0.575 × size
// (scale roll 0.85-1.15) plus a ±0.15 × size center offset, at random yaw.
// The old 0.7 circle overhung the visible faces by up to ~0.28 × size —
// invisible walls. 0.55 matches the typical visible footprint; a worst-roll
// corner may clip slightly, which is the fair direction (never block what
// looks open).
export const ENEMY_WEDGE_TIME = 2; // Seconds a chasing enemy may be fully blocked before detouring
export const ENEMY_DETOUR_TIME = 1; // Seconds the 45-degree detour heading is held
// Playtest-tuned (stage 3): the run BUILDS pressure instead of opening at
// max. At the old target 7 + 0.45s refill, all three scripted playtest
// styles died inside 70 game-seconds (hunter 14s, sprinter 9s) with the
// distance ramp never engaging — seven hunters converge on a scale-1 player
// before the second collect. Target 4 (+1 per ramp level) passes through
// the design's 6-9 band at 300-750u and hits the cap 12 at 1200u.
export const ENDLESS_ENEMY_TARGET = 4; // Enemies maintained in the bubble at ramp level 0 (+1 per level)
// Bubble-spawn size bands (owner: "enemies bigger than me keep appearing, I
// never get to eat anybody"). The classic 1.5x-your-height rule regenerated
// the whole population pre-grown; this rotating pattern guarantees prey keeps
// appearing: 1 in 4 spawns is edible now, 1 in 4 soon, half stay giants.
export const SPAWN_SIZE_PATTERN = ['prey', 'giant', 'peer', 'giant']; // deterministic rotation per bubble spawn
export const PREY_HEIGHT_RANGE = [0.55, 0.85]; // prey band: x player height (edible immediately)
export const PEER_HEIGHT_RANGE = [0.95, 1.25]; // peer band: x player height (edible after a snack or two)
export const ENDLESS_ENEMY_CAP = 12; // Hard endless population cap (ramp target never exceeds it)
export const ENEMY_DESPAWN_RADIUS = 80; // Enemies beyond this distance are removed AND disposed
export const ENDLESS_SPAWN_MIN = 35; // Bubble spawns land between MIN and MAX units from the player...
export const ENDLESS_SPAWN_MAX = 50; // ...far enough to materialize unseen, near enough to matter
export const ENDLESS_SPAWN_INTERVAL = 1.25; // Seconds between bubble top-up spawns (was 0.45 — a cleared pocket stays clear for a breath; kill-spawns still land instantly)
export const RAMP_DISTANCE = 150; // Every this many units of furthest distance = +1 difficulty level
export const RAMP_HEIGHT_STEP = 0.2; // Extra enemy target-height factor per ramp level (+20%)
export const RAMP_SPEED_STEP = 0.05; // Extra enemy speed factor per ramp level (+5%)
export const RAMP_SPEED_MAX = 1.6; // Speed ramp cap: 1.5 base * 1.6 = 2.4 u/s vs the player's 6 — always outrunnable
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

// --- TOYS (owner queue items 4-5): fluffy clouds + the jump ---
// Clouds are pure scenery in BOTH modes; the jump is ENDLESS-ONLY (Space —
// classic keeps Space = pause). All tunables live here per the balance law.
export const CLOUD_ALTITUDE_MIN = 12; // Clouds float between these heights —
export const CLOUD_ALTITUDE_MAX = 18; // high above every hill crest (~3.4 max)
export const CLOUD_WIND_X = 0.32; // Shared wind drift, units/s — every cloud
export const CLOUD_WIND_Z = 0.14; // rides the same slow breeze
export const CLOUD_BOB_AMPLITUDE = 0.35; // Gentle per-cloud vertical bob...
export const CLOUD_BOB_SPEED = 0.45; // ...at ~0.07Hz (nowhere near a strobe)
export const CLOUD_OPACITY = 0.85; // Soft translucency on the ONE shared material
export const CLASSIC_CLOUD_COUNT = 8; // Fixed pool drifting over the arena
export const CLOUD_CHUNK_CHANCE = 0.4; // Seeded per endless chunk ≈ 1 cloud per 2.5 chunks
export const CLOUD_APPEAR_TIME = 2.5; // Seconds a fresh endless cloud scales in
// (streamed clouds are born at the fog-swallowed window edge; the slow
// grow-in makes the residual pop invisible even at max zoom-out)
export const CLOUD_CLEAR_NEAR = 6; // A cloud nearly OVERHEAD (this XZ distance of the player) shrinks away...
export const CLOUD_CLEAR_FAR = 16; // ...easing back to full size out here. Screenshot-tuned: the top-down-ish
// camera only ever frames NEAR clouds (far ones sit above the frame top), so
// off-center neighbors must render — only the one that would park over the
// player's own head fades out.

// Jump (endless only): ballistic arc on the game clock. Apex and airtime
// grow with playerScale so bigger heroes clear taller rocks / wider gaps
// that blocked them when small. Gravity/velocity derived per jump
// (h = g·T²/8, v0 = g·T/2). Scale-1 values keep the rock-hop toys green.
export const JUMP_APEX_HEIGHT = 1.55; // Apex at playerScale 1
export const JUMP_APEX_GROWTH = 0.75; // Extra apex per unit of scale above 1
export const JUMP_AIRTIME = 0.52; // Airtime at playerScale 1
export const JUMP_AIRTIME_GROWTH = 0.07; // Extra airtime per unit scale above 1 (more horizontal range)
// Legacy derived constants (scale-1) — still used by any reader that imports them.
export const JUMP_GRAVITY = (8 * JUMP_APEX_HEIGHT) / (JUMP_AIRTIME * JUMP_AIRTIME);
export const JUMP_VELOCITY = (JUMP_GRAVITY * JUMP_AIRTIME) / 2;

// --- Continuous-movement flag (plan 014 design spike) ---
// `?move=continuous` opts into the Little Big Snake-style prototype
// (src/movement-continuous.js). Any other value — including no param at all —
// keeps the standard direct-control scheme, untouched by the spike.
// Named CONTINUOUS_MOVEMENT (audit D-3): the old movement-mode string enum's
// 'classic' value collided with the retired classic WORLD mode
// (state.worldMode) — a completely different axis — exactly where future
// work reads both.
// The typeof guard keeps this module importable from Node-side Playwright
// specs (no `location` there; the flag simply reads false).
export const CONTINUOUS_MOVEMENT = typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('move') === 'continuous';
