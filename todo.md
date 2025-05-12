# Blocky Collector 3D - Todo & Future Ideas

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
- [ ] **Enhanced Player Movement (Consider Little Big Snake Style - Major Refactor):**
    - [ ] **Desktop:** Option for continuous movement towards mouse cursor.
    - [ ] **Desktop:** Option for smooth player rotation to face cursor.
    - [ ] **Mobile:** Option for virtual joystick with continuous movement / persistent direction.
    - [ ] General: Aim for smoother, more fluid gameplay feel ("Little Big Snake feel").
- [ ] **Boost Mechanic with Energy System (Inspired by LBS):**
    - [ ] Activation: Hold Left-click/Space (desktop), or a dedicated touch button (mobile).
    - [ ] Speed Increase: e.g., 1.5x base speed.
    - [ ] Energy Meter: Max capacity, drains during boost, regenerates when not boosting.
    - [ ] UI: Visual energy bar.
    - [ ] Visuals: Particle trail effect during boost.
- [ ] **Trailing Body Segments (Visual Growth & Gameplay Impact - LBS Style):**
    - [ ] Each food block collected adds a segment up to a max.
    - [ ] Segments follow player's path history.
    - [ ] Collision Risk: Game over if a non-killable enemy collides with a player's body segment.
- [ ] **Dynamic Food Spawns:**
    - [ ] Current: Enemy defeat spawns 4 food particles at death location.
    - [ ] LBS Style: When a yellow (killable) enemy is defeated, spawn 4–6 food blocks in a wider random spread/burst around the enemy's last position.
    - [ ] Adjust spawning/size of initial "Noob" (food) blocks if they feel "too close and too big".
- [ ] **More Varied Enemy Types:**
    - [ ] Existing ideas: Different movement patterns, ranged attacks, boss enemies.
    - [ ] **"Juja-like" Enemies (Low-Risk, Resource Drop - LBS Beetles Style):**
        - [ ] Appearance: Smaller, faster, distinct (e.g., different shape/color).
        - [ ] Spawning: Periodically.
        - [ ] Behavior: Simpler movement, less aggressive.
        - [ ] Reward: Drop extra food when defeated.
        - [ ] Consequence: No game over on player contact (or minor penalty).
- [ ] **Power-ups (Spawned Randomly as Collectible Orbs - LBS Style):**
    - [ ] **Magnet:** Pulls nearby food.
    - [ ] **Speed Burst:** Temporary base speed increase (no energy cost).
    - [ ] **Shield:** Temporary invulnerability to non-killable enemies.
    - [ ] General: Distinct orb appearance, timed duration, UI icon for active power-up.
    - [ ] _Existing ideas: Score multipliers, "Clear screen" power-up._
- [ ] **Environmental Obstacles:**
    *   [ ] Static blocks that impede movement.
    *   [ ] Moving obstacles.
    *   [ ] "Slow zones" or "hazard zones" on the ground.
- [ ] **Difficulty Scaling:**
    *   [ ] Increase enemy speed or spawn rate over time or based on score.
    *   [ ] Introduce tougher enemy variants as the game progresses.

## Monetization & Platform Specifics (Roblox Focus - From Gemini Summary)
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
    *   [ ] Food collection (consider "oof" sound if food becomes "Noobs").
    *   [ ] Player growth / segment addition.
    *   [ ] Enemy movement/spawn (Corgi sounds if skinned?).
    *   [ ] Enemy defeat (explosion/food burst).
    *   [ ] Player-enemy collision (game over).
    *   [ ] Player segment collision (game over).
    *   [ ] Timer running out (game over).
    *   [ ] Power-up spawn/collection/activation/deactivation.
    *   [ ] Button clicks in UI.
    *   [ ] Game start.
- [ ] **Music:**
    *   [ ] Background music loop for gameplay.
    *   [ ] Short jingle for game over.
    *   [ ] Music for title/menu screen (if one is added).

## Visual & UI Enhancements
- [ ] **Visual Effects (Particles, etc.):**
    *   [ ] Particle effect when player collects food.
    *   [ ] More elaborate particle effect for enemy "explosion" on defeat (linked to dynamic food spawn).
    *   [ ] Trail effect for player movement (especially during boost - e.g., lime green sparks).
    *   [ ] Visual feedback for player growth (beyond just scaling/segments).
    *   [ ] Visual effect for power-up orbs (e.g., glowing).
    *   [ ] Visual indication for Shield power-up active on player.
- [ ] **Character Animation (More Advanced):**
    *   [ ] "Walking" / "Slithering" animation for player & segments.
    *   [ ] Enemy leg animations.
    *   [ ] Simple idle animations.
- [ ] **Textures:**
    *   [ ] Apply textures to player, enemies, ground, or collectibles.
- [ ] **UI Polish:**
    *   [ ] More distinct styling for active/hover states on UI buttons.
    *   [ ] Potentially a start screen/main menu.
    *   [ ] On-screen indication of current speed multiplier (if button text isn't enough).
    *   [ ] Energy Bar for Boost Mechanic.
    *   [ ] Icon display for active Power-Up.
    *   [ ] Skin selector UI (post-game or in menu for Roblox skins).
    *   [ ] Improve "New Game" start flow/button for user-friendliness.
- [ ] **Improved Off-Screen Indicators:**
    *   [ ] Make indicators fade based on distance.
    *   [ ] Ensure indicators don't overlap UI elements too much (z-index management).
- [ ] **Dynamic Camera Zoom:** (Already implemented - verify if any further tweaks needed).

## Features & Long-Term
- [ ] **High Score System:**
    *   [ ] Track and display personal high scores (local storage).
    *   [ ] Track and display a global high score (requires backend).
    *   [ ] Track and display a daily high score (requires backend).
    *   [ ] Display leaderboard on game-over screen.
- [ ] **Unlockable Skins & Progression (LBS Style & Roblox):**
    *   [ ] Unlock cosmetic skins (e.g., different player colors, face designs, Roblox avatar items if applicable) by reaching score milestones or using "Wins".
- [ ] **Save Game State (More Advanced):**
    *   [ ] Allow pausing and resuming session later (e.g., via `localStorage`).
- [ ] **More Levels or Game Modes (Advanced):**
    *   [ ] Different arenas or layouts.
    *   [ ] Challenge modes (e.g., time attack, survival against waves).
- [ ] **Settings Menu:**
    *   [ ] Toggle sound/music on/off.
    *   [ ] Adjust control sensitivity (if applicable for new movement styles).

## Bug Fixes & Known Issues (From Gemini Summary)
- [ ] **Shaking/Immobile Bug:** Investigate and fix issue where characters might shake or player becomes unable to move.
- [ ] **Teleporting Enemy Glitch:** Fix instances where enemies might appear to teleport unfairly (distinct from world wrapping).
- [ ] **General Glitch Prioritization:** Ongoing effort to identify and fix gameplay bugs.

## Code & Technical Refinements
- [ ] **Performance Optimization:**
    *   [ ] Review object pooling (collectibles, indicators, trail segments).
    *   [ ] Optimize rendering if many objects are on screen.
- [ ] **Code Refactoring:**
    *   [ ] Further componentize JavaScript if game grows much larger.
    *   [ ] Add more detailed comments for complex sections.
    *   [ ] Ensure frame-rate independence for movement and timers (`deltaTime` implementation).
- [ ] **Enhanced Mobile UI/UX:**
    *   [ ] Consider dedicated pause button for touch interface that's larger/better placed than top-corner controls.
    *   [ ] Test on various device sizes and adjust UI breakpoints.
    *   [ ] Design/Implement dedicated touch button for Boost if LBS movement and boost are adopted.

---
*This todo list has been updated with suggestions inspired by Little Big Snake (from Grok via User) and a summary from Gemini (via User).* 