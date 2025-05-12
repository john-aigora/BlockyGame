# Blocky Collector 3D - Todo & Future Ideas

This file tracks potential future enhancements and features for the game.

## Gameplay Enhancements
- [ ] **Enhanced Player Movement (Little Big Snake Style - Major Refactor):**
    - [ ] **Desktop:** Continuous movement at constant speed (e.g., 5 units/second) towards mouse cursor (projected on XZ plane).
    - [ ] **Desktop:** Smooth player rotation to face cursor (e.g., lerp, 0.1 factor).
    - [ ] **Mobile:** Virtual joystick for direction, continuous movement at constant speed.
    - [ ] **Mobile:** Movement continues in last direction if joystick input stops (persistent movement, like LBS).
    - [ ] Player stops movement only on pause or game over.
- [ ] **Boost Mechanic with Energy System (Inspired by LBS):**
    - [ ] Activation: Hold Left-click/Space (desktop), or a dedicated touch button (mobile).
    - [ ] Speed Increase: e.g., 1.5x base speed (e.g., 7.5 units/sec if base is 5).
    - [ ] Energy Meter: Max capacity (e.g., 100), drains during boost (e.g., -10/sec), regenerates when not boosting (e.g., +5/sec).
    - [ ] UI: Visual energy bar.
    - [ ] Visuals: Particle trail effect (e.g., lime green sparks) during boost.
- [ ] **Trailing Body Segments (Visual Growth & Gameplay Impact - LBS Style):**
    - [ ] Each food block collected adds a segment (e.g., smaller cubes, different color/texture) up to a max (e.g., 10 segments).
    - [ ] Segments follow player's path history smoothly (e.g., spaced 10 units apart).
    - [ ] Collision Risk: Game over if a non-killable (blue) enemy collides with one of the player's body segments (not just the head).
- [ ] **Dynamic Food Spawns (Post-Enemy Defeat - LBS Nectar Burst Style):**
    - [ ] When a yellow (killable) enemy is defeated, spawn 4–6 food blocks in a random spread/burst around the enemy's last position (e.g., within a 20-unit radius).
- [ ] **More Varied Enemy Types:**
    - [ ] Existing: Enemies with different movement patterns (e.g., zig-zag, patrol).
    - [ ] Existing: Enemies with ranged attacks (if a player attack is added).
    - [ ] Existing: "Boss" enemies with unique mechanics.
    - [ ] **"Juja-like" Enemies (Low-Risk, Resource Drop - LBS Beetles Style):**
        - [ ] Appearance: Smaller, faster, distinct-looking (e.g., different shape or green color).
        - [ ] Spawning: Periodically (e.g., every 30 seconds).
        - [ ] Behavior: May have simpler movement, less aggressive.
        - [ ] Reward: Drop extra food when defeated (e.g., 2 blocks).
        - [ ] Consequence: Do *not* cause game over on player contact (or perhaps only a minor penalty like a brief stun or losing one segment).
- [ ] **Power-ups (Spawned Randomly as Collectible Orbs - LBS Style):**
    - [ ] **Magnet:** Pulls nearby food blocks toward the player (e.g., 10-unit radius, active for 10s).
    - [ ] **Speed Burst:** Temporarily increases player's base speed (e.g., to 7 units/sec for 10s) *without* energy cost.
    - [ ] **Shield:** Prevents game-over from non-killable enemy collisions for a short duration (e.g., 5s).
    - [ ] General: Power-ups appear as distinct glowing orbs, last ~10 seconds when collected.
    - [ ] UI: Icon for active power-up.
    - [ ] _Existing ideas: Score multipliers, "Clear screen" power-up._
- [ ] **Environmental Obstacles:**
    *   [ ] Static blocks that impede movement.
    *   [ ] Moving obstacles.
    *   [ ] "Slow zones" or "hazard zones" on the ground.
- [ ] **Difficulty Scaling:**
    *   [ ] Increase enemy speed or spawn rate over time or based on score.
    *   [ ] Introduce tougher enemy variants as the game progresses.

## Audio
- [ ] **Sound Effects:**
    *   [ ] Player movement (continuous engine/hum if LBS style, or steps if current).
    *   [ ] Boost activation/deactivation/loop.
    *   [ ] Energy depletion/recharge sounds.
    *   [ ] Food collection.
    *   [ ] Player growth / segment addition.
    *   [ ] Enemy movement/spawn.
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
    *   [ ] Energy Bar for Boost Mechanic (visual display).
    *   [ ] Icon display for active Power-Up.
    *   [ ] Skin selector UI (post-game or in menu).
- [ ] **Improved Off-Screen Indicators:**
    *   [ ] Make indicators fade based on distance.
    *   [ ] Ensure indicators don't overlap UI elements too much (z-index management).

## Features & Long-Term
- [ ] **Leaderboard / High Score System (LBS Style):**
    *   [ ] Local high score saving (using `localStorage`) - Track top 5 scores.
    *   [ ] Display leaderboard on game-over screen.
    *   [ ] Online leaderboard (would require backend).
- [ ] **Unlockable Skins & Progression (LBS Style):**
    *   [ ] Unlock skins (e.g., different player colors, face designs like purple cube, smiley face) by reaching score milestones (e.g., 100, 500 points).
- [ ] **Save Game State (More Advanced):**
    *   [ ] Allow pausing and resuming session later (e.g., via `localStorage`).
- [ ] **More Levels or Game Modes (Advanced):**
    *   [ ] Different arenas or layouts.
    *   [ ] Challenge modes (e.g., time attack, survival against waves).
- [ ] **Settings Menu:**
    *   [ ] Toggle sound/music on/off.
    *   [ ] Adjust control sensitivity (if applicable for new movement styles).

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
    *   [ ] Design/Implement dedicated touch button for Boost if LBS movement is adopted.

---
*This todo list has been updated with suggestions inspired by Little Big Snake, based on feedback from Grok (via User).* 