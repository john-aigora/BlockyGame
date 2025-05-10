# Blocky Collector 3D - Game Project

## Overview

Blocky Collector 3D is a fast-paced 3D browser game built with HTML, CSS, and JavaScript, utilizing the Three.js library. Players control a character with a distinct face and legs, navigating a wrap-around world to collect "food" particles (lime green blocks). The game features enemies, also with faces and legs, that dynamically change color based on killability and employ orbiting and enhanced separation behaviors. The objective is to achieve the highest score by collecting food and strategically defeating enemies, which then spawn more challenging foes (at a greater distance) and additional food.

## Project Structure

*   **`index.html`**: Main HTML file (structure, UI elements, game canvas).
*   **`style.css`**: CSS for styling, including the "Deep Dive Arcade" color scheme and responsive UI components.
*   **`game.js`**: Core game logic, including Three.js setup, game object management, player/enemy mechanics, collision, controls (keyboard and touch), and game state.

## Key Technologies

*   HTML5, CSS3, JavaScript (ES6+)
*   Three.js (r128 via CDN)

## How to Run the Game

1.  **Prerequisites**: Modern web browser with WebGL support.
2.  **Local Server (Recommended)**: Use a local web server (e.g., VS Code "Live Server" extension). Right-click `index.html` and "Open with Live Server".
3.  **Direct File Opening (Less Recommended)**: Open `index.html` directly in a browser (may have limitations).

## Current Game Mechanics

### Player
*   **Appearance**: Orange-Red character with legs and a face.
*   **Control**: Arrow Keys (desktop) or Touch-and-Drag (mobile - touch anywhere on the game screen relative to the player's visual center to move).
*   **Growth**: Collecting lime green food blocks increases the player's size (`playerScale`).
*   **Objective**: Survive, collect food, and defeat enemies for a high score.

### Enemies
*   **Appearance**: Electric Blue characters with legs and faces. They turn **Bright Yellow** when the player is taller and can defeat them.
*   **AI Behavior**:
    *   Chase the player.
    *   Implement orbiting behavior when within an `engagementRadius` of the player.
    *   Employ a random drift component to their movement.
    *   Actively avoid other enemies with improved force and radius to prevent clumping.
*   **Spawning**: One enemy (50% taller than player) spawns initially. When an enemy is defeated, two new enemies spawn (each 50% taller than the player) at an increased distance.
*   **Interaction**: If a non-killable enemy touches the player, game over. If a killable (yellow) enemy is touched by the player, the enemy is defeated.

### World & Food
*   **Wrapping World**: The game world (defined by `worldSize`) wraps around on the X and Z axes for both player and enemies.
*   **Food (Collectibles)**: Lime green blocks.
    *   Initially, a large number of food items are distributed evenly across the world based on `initialFoodDensityArea`.
    *   When an enemy is defeated, it explodes into 4 new food particles around its death location.
    *   The game attempts to maintain a target number of food items on screen (`targetCollectiblesOnScreen`), which increases as enemies are defeated.

### Gameplay & UI
*   **"Collect Block" Timer**: A 10-second timer, resets on food collection. Game over if it reaches zero.
*   **Kill Indicator**: A flashing "KILL!" sign appears in the top-left when at least one enemy is killable by the player.
*   **Pause/Resume**: Game can be paused/resumed using the Spacebar or on-screen buttons.
*   **Speed Control**: An on-screen button cycles through game speeds (0.5x, 1x, 1.5x, 2x, 3x) affecting player and enemies.
*   **Restart**: Game can be restarted via on-screen buttons (in-game or on game over screen).
*   **Color Scheme**: "Deep Dive Arcade" theme with dark teal background and contrasting vibrant colors for characters and UI elements.
*   **Mobile Support**: Touch-and-drag controls for movement. UI buttons are touch-responsive. Player speed is increased on mobile.
*   **Game Over**: Occurs if caught by a non-killable enemy or if the collect timer runs out.

## Potential Future Development (Ideas for Cursor AI)

*   Adding sound effects and music.
*   More varied enemy types with unique behaviors or attacks.
*   Implementing power-ups (e.g., temporary speed boost, invincibility, score multipliers).
*   Adding more complex environmental obstacles or interactive elements.
*   Visual enhancements (e.g., particle effects for movement/collection, textures, animated characters).
*   Leaderboard / high score saving.
