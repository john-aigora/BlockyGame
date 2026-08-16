# Blocky Collector 3D - Todo & Future Ideas

> Bug fixes and infra improvements from the 2026 overhaul are tracked as plans in `plans/` — this file is the feature wishlist. Items marked [x] shipped in that overhaul.
> **CLAUDE.md's "Closed decisions" overrides anything here** (e.g. the Roblox section below is rejected — kept for history only).

This file tracks potential future enhancements and features for the game.

## Core Gameplay & Feature Additions (New & From Grok/Gemini Summary)
- [ ] **Extra Life System:**
    - [ ] Allow players to watch an ad (if platform supports) to get an extra life upon game over.
- [ ] **Username System:**
    - [ ] Allow players to choose and display a username (for high scores, etc.).
- [ ] **"Wins" Currency System:**
    - [ ] Players earn 1 "Win" for every X points scored (e.g., 50 points).
    - [ ] Wins are awarded/tallied when the player dies.
    - [ ] Use "Wins" as a currency for in-game unlocks (e.g., Pets).
- [ ] **Pets System:**
    - [ ] Players can buy/unlock Pets using "Wins".
    - [ ] Pets provide passive bonuses, e.g., increase food value (player gains more size per food block).
    - [ ] Pets could visually follow the player.

## Gameplay Enhancements (Existing & From Grok/Gemini Summary)
- [x] **Enhanced Player Movement (Consider Little Big Snake Style - Major Refactor):** _(spike, behind `?move=continuous` — see plans/design/lbs-movement-notes.md; adopt-or-delete pending family playtest)_
    - [x] **Desktop:** Option for continuous movement towards mouse cursor. _(spike)_
    - [x] **Desktop:** Option for smooth player rotation to face cursor. _(spike: framerate-independent heading lerp)_
    - [x] **Mobile:** Option for virtual joystick with continuous movement / persistent direction. _(spike: drag steers, heading persists on finger lift)_
    - [x] General: Aim for smoother, more fluid gameplay feel ("Little Big Snake feel"). _(spike — the family playtest judges it)_
- [x] **Boost Mechanic with Energy System (Inspired by LBS):** _(spike, behind `?move=continuous` — see plans/design/lbs-movement-notes.md; adopt-or-delete pending family playtest)_
    - [x] Activation: Hold Left-click/Space (desktop), or a dedicated touch button (mobile). _(spike: hold Space, or the on-screen BOOST button)_
    - [x] Speed Increase: e.g., 1.5x base speed. _(spike: ×1.5)_
    - [x] Energy Meter: Max capacity, drains during boost, regenerates when not boosting. _(spike: 100 max, −10/s boosting, +5/s regen)_
    - [x] UI: Visual energy bar. _(spike)_
    - [x] Visuals: Particle trail effect during boost. _(spike)_
- [ ] **Trailing Body Segments (Visual Growth & Gameplay Impact - LBS Style):**
    - [ ] Each food block collected adds a segment up to a max.
    - [ ] Segments follow player's path history.
    - [ ] Collision Risk: Game over if a non-killable enemy collides with a player's body segment.
- [ ] **Dynamic Food Spawns:**
    - [ ] Current: Enemy defeat spawns 4 food particles at death location.
    - [ ] LBS Style: When a yellow (killable) enemy is defeated, spawn 4–6 food blocks in a wider random spread/burst around the enemy's last position.
    - [ ] Adjust spawning/size of initial "Noob" (food) blocks if they feel "too close and too big".
- [x] **More Varied Enemy Types:** _(shipped: species table, plan 024; the 1000u TITAN boss, plan 025)_
    - [x] Existing ideas: Different movement patterns, ranged attacks, boss enemies. _(sprinter 2.2x + juja 2.6x movement characters; the titan is the boss beat — ranged attacks still open)_
    - [x] **"Juja-like" Enemies (Low-Risk, Resource Drop - LBS Beetles Style):** _(shipped: `juja` in ENEMY_SPECIES, plan 024)_
        - [x] Appearance: Smaller, faster, distinct (e.g., different shape/color). _(0.35x height, green, 2.6x speed)_
        - [x] Spawning: Periodically. _(SPAWN_SIZE_PATTERN rotation slot)_
        - [x] Behavior: Simpler movement, less aggressive. _(flees unconditionally)_
        - [x] Reward: Drop extra food when defeated. _(foodDrop 2, bonus-snack economics)_
        - [x] Consequence: No game over on player contact (or minor penalty). _(harmless: true — excluded from every threat surface)_
- [ ] **Power-ups (Spawned Randomly as Collectible Orbs - LBS Style):**
    - [ ] **Magnet:** Pulls nearby food.
    - [ ] **Speed Burst:** Temporary base speed increase (no energy cost).
    - [ ] **Shield:** Temporary invulnerability to non-killable enemies.
    - [ ] General: Distinct orb appearance, timed duration, UI icon for active power-up.
    - [ ] _Existing ideas: Score multipliers, "Clear screen" power-up._
- [x] **Environmental Obstacles:** _(shipped in ENDLESS WORLD mode, 2026: impassable lakes and voxel boulders — movement slides along them)_
    *   [x] Static blocks that impede movement. _(boulders + water, endless mode)_
    *   [ ] Moving obstacles.
    *   [ ] "Slow zones" or "hazard zones" on the ground.
- [x] **Difficulty Scaling:** _(shipped in ENDLESS WORLD mode, 2026: the distance ramp)_
    *   [x] Increase enemy speed or spawn rate over time or based on score. _(endless: +speed, +population every 150u of distance)_
    *   [x] Introduce tougher enemy variants as the game progresses. _(endless: enemies grow +20% height per ramp level)_

## Monetization & Platform Specifics (Roblox Focus - From Gemini Summary) _(REJECTED — see CLAUDE.md Closed decisions: "No Roblox port"; kept for history)_
- [ ] **Roblox Platform Integration:** (General task for deployment)
- [ ] **Skin Packs / Visual Overhaul for Roblox:**
    - [ ] Enemies (currently blue blocks) become Corgis with red eyes.
    - [ ] Player character uses player's Roblox avatar with a large mouth.
    - [ ] Food items (lime green blocks) become "Noobs" (possibly with "oof" sound on collection).
- [ ] **Robux Purchases (In-Game Advantages):**
    - [ ] "+X speed" (e.g., +50 speed) permanent or temporary boost.
    - [ ] "+X size" (e.g., +1000 size) instant growth.
    - [ ] Purchase "Wins" currency with Robux.

## Audio
- [ ] **Sound Effects:**
    *   [ ] Player movement (continuous if LBS style, or steps).
    *   [ ] Boost activation/deactivation/loop.
    *   [ ] Energy depletion/recharge sounds.
    *   [x] Food collection (consider "oof" sound if food becomes "Noobs").
    *   [ ] Player growth / segment addition.
    *   [ ] Enemy movement/spawn (Corgi sounds if skinned?).
    *   [x] Enemy defeat (explosion/food burst).
    *   [x] Player-enemy collision (game over).
    *   [ ] Player segment collision (game over).
    *   [x] Timer running out (game over).
    *   [ ] Power-up spawn/collection/activation/deactivation.
    *   [x] Button clicks in UI.
    *   [x] Game start.
- [ ] **Music:**
    *   [x] Background music loop for gameplay.
    *   [x] Short jingle for game over.
    *   [ ] Music for title/menu screen (if one is added).

## Visual & UI Enhancements
- [ ] **Visual Effects (Particles, etc.):**
    *   [x] Particle effect when player collects food.
    *   [x] More elaborate particle effect for enemy "explosion" on defeat (linked to dynamic food spawn).
    *   [x] Trail effect for player movement (especially during boost - e.g., lime green sparks). _(spike, behind `?move=continuous` — see plans/design/lbs-movement-notes.md; adopt-or-delete pending family playtest)_
    *   [ ] Visual feedback for player growth (beyond just scaling/segments).
    *   [ ] Visual effect for power-up orbs (e.g., glowing).
    *   [ ] Visual indication for Shield power-up active on player.
- [ ] **Character Animation (More Advanced):**
    *   [x] "Walking" / "Slithering" animation for player & segments.
    *   [x] Enemy leg animations.
    *   [ ] Simple idle animations.
- [ ] **Textures:**
    *   [x] Apply textures to player, enemies, ground, or collectibles.
- [ ] **UI Polish:**
    *   [x] More distinct styling for active/hover states on UI buttons.
    *   [x] Potentially a start screen/main menu.
    *   [ ] On-screen indication of current speed multiplier (if button text isn't enough).
    *   [x] Energy Bar for Boost Mechanic. _(spike, behind `?move=continuous` — see plans/design/lbs-movement-notes.md; adopt-or-delete pending family playtest)_
    *   [ ] Icon display for active Power-Up.
    *   [ ] Skin selector UI (post-game or in menu for Roblox skins).
    *   [x] Improve "New Game" start flow/button for user-friendliness.
- [ ] **Improved Off-Screen Indicators:**
    *   [ ] Make indicators fade based on distance.
    *   [ ] Ensure indicators don't overlap UI elements too much (z-index management).
- [ ] **Dynamic Camera Zoom:** (Already implemented - verify if any further tweaks needed).

## Features & Long-Term
- [ ] **High Score System:**
    *   [x] Track and display personal high scores (local storage).
    *   [ ] Track and display a global high score (requires backend).
    *   [x] Track and display a daily high score. _(shipped LOCALLY: TODAY'S WORLD seeded board `blocky.hiscores.daily.v1`, plan 025 — a cross-device/backend variant is still open)_
    *   [x] Display leaderboard on game-over screen.
- [ ] **Unlockable Skins & Progression (LBS Style & Roblox):**
    *   [ ] Unlock cosmetic skins (e.g., different player colors, face designs, Roblox avatar items if applicable) by reaching score milestones or using "Wins".
- [ ] **Save Game State (More Advanced):**
    *   [ ] Allow pausing and resuming session later (e.g., via `localStorage`).
- [x] **More Levels or Game Modes (Advanced):** _(shipped 2026: the ENDLESS WORLD mode — an infinite streamed world with hills, lakes, boulders, a curved horizon, biome regions, distance milestones, and its own BEST RUNS board)_
    *   [x] Different arenas or layouts. _(the ENDLESS WORLD replaced the classic arena, which retired to a test-only path)_
    *   [ ] Challenge modes (e.g., time attack, survival against waves).
- [ ] **Settings Menu:**
    *   [x] Toggle sound/music on/off.
    *   [ ] Adjust control sensitivity (if applicable for new movement styles).

## Bug Fixes & Known Issues (From Gemini Summary)
- [x] **Shaking/Immobile Bug:** Investigate and fix issue where characters might shake or player becomes unable to move.
- [x] **Teleporting Enemy Glitch:** Fix instances where enemies might appear to teleport unfairly (distinct from world wrapping).
- [ ] **General Glitch Prioritization:** Ongoing effort to identify and fix gameplay bugs.
- [ ] (Minor, from 2026 final review) If the collect clock expires on the exact frame the player touches a killable enemy, the HUD can show +25 more than the recorded high score for that run. One-frame coincidence; fix = skip the enemy update once endGame fires within the same frame.

## Code & Technical Refinements
- [ ] **Performance Optimization:**
    *   [x] Review object pooling (collectibles, indicators, trail segments).
    *   [x] Optimize rendering if many objects are on screen.
- [ ] **Code Refactoring:**
    *   [x] Further componentize JavaScript if game grows much larger.
    *   [ ] Add more detailed comments for complex sections.
    *   [x] Ensure frame-rate independence for movement and timers (`deltaTime` implementation).
- [ ] **Enhanced Mobile UI/UX:**
    *   [ ] Consider dedicated pause button for touch interface that's larger/better placed than top-corner controls.
    *   [x] Test on various device sizes and adjust UI breakpoints.
    *   [x] Design/Implement dedicated touch button for Boost if LBS movement and boost are adopted. _(spike, behind `?move=continuous` — see plans/design/lbs-movement-notes.md; adopt-or-delete pending family playtest)_

---
*This todo list has been updated with suggestions inspired by Little Big Snake (from Grok via User — the full notes are preserved at [docs/history/grok_tips.md](docs/history/grok_tips.md)) and a summary from Gemini (via User).*
