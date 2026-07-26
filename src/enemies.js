import * as THREE from 'three';
import {
    enemyBaseHeight, worldBoundary, engagementRadius, orbitStrengthFactor,
    enemyRandomDriftFactor, AVOID_SPEED_FACTOR, BASE_ENEMY_SPAWN_DISTANCE, SPAWN_DISTANCE_SCALE_FACTOR,
    KILL_POINTS, MAX_ENEMIES, ENEMIES_PER_KILL, ENEMY_HEIGHT_FACTOR,
    SIZE_BOUNTY_PER_UNIT, COMBO_WINDOW, COMBO_MAX,
    SPAWN_MATERIALIZE_TIME, SPAWN_MATERIALIZE_START_SCALE,
    ENEMY_COLLIDER_HALF_WIDTH, ENEMY_WEDGE_TIME, ENEMY_DETOUR_TIME,
    ENDLESS_ENEMY_TARGET, ENDLESS_ENEMY_CAP, ENEMY_DESPAWN_RADIUS,
    ENDLESS_SPAWN_MIN, ENDLESS_SPAWN_MAX, ENDLESS_SPAWN_INTERVAL, RAMP_HEIGHT_STEP
} from './constants.js';
import { state } from './state.js';
import { createCharacter, disposeCharacter, shadeColor, CAP_LIGHTEN } from './characters.js';
import { groundHeightAt, isWalkable, slideMove } from './terrain.js';
import { spawnAtPosition } from './collectibles.js';
import { endGame, updateScoreDisplay, showComboChip } from './ui.js';
import { wrapPosition, torusDelta, torusDistance } from './worldmath.js';
import { sfx } from './audio.js';
import { onEnemyKilled, spawnScorePopup, spawnBurst } from './effects.js';
import { triggerKillShake } from './world.js';

// Module-level scratch vectors — reused every frame to avoid per-frame allocation.
const tmpVec = new THREE.Vector3();
const avoidVec = new THREE.Vector3();
const awayVec = new THREE.Vector3();

// Module-level scratch AABBs — the ONLY Box3 instances in the codebase
// (plan 007). playerBox is refreshed once per collision section; scratchBox
// is reused for every enemy/collectible test. game.js imports both.
export const playerBox = new THREE.Box3();
export const scratchBox = new THREE.Box3();

// The cap (top-face highlight) flips shade-for-shade with the body color —
// computed once here from the same shade factor characters.js builds with.
const KILLABLE_CAP_COLOR = shadeColor(0xFFEB3B, CAP_LIGHTEN);
const NORMAL_CAP_COLOR = shadeColor(0x03A9F4, CAP_LIGHTEN);

export function createEnemy() {
    // perInstanceBodyMaterial: each enemy's body color flips independently
    // between killable-yellow and blue, so the material cannot be shared.
    // menacing: pointed ears, tail, back spikes, underbite jaw (characters.js).
    const enemyGroup = createCharacter({ baseSize: enemyBaseHeight, bodyColor: 0x03A9F4, faceColor: 0x222222, perInstanceBodyMaterial: true, menacing: true }); // Electric Blue body, dark grey face

    // --- Enemy AI Properties ---
    enemyGroup.randomVelocity = new THREE.Vector3(0, 0, 0);
    enemyGroup.timeToChangeRandomVelocity = Math.random() * 2 + 1;
    enemyGroup.orbitDirection = Math.random() < 0.5 ? 1 : -1;

    state.scene.add(enemyGroup);
    state.enemies.push(enemyGroup);
    return enemyGroup;
}

// Player can kill if player is TALLER than the enemy
export function canKillSpecificEnemy(enemyGroup) {
    const playerActualHeight = state.playerScale * 1.0; // Player geometry base height is 1
    // enemyGroup.scale.y refers to the scale of the whole group.
    // The previous logic was: playerActualHeight > enemy.scale.y * enemyBaseHeight.
    // This refers to the enemy's main cube height. Let's stick to that for now for consistency in gameplay feel,
    // comparing player height against the scaled height of the enemy's main body part.
    // A MATERIALIZING enemy is judged by its FULL height (materializeTarget):
    // the scale-in is a spawn telegraph, not a real size — without this the
    // shrunken spawn would flash "KILL!" and paint yellow indicators for a
    // foe that towers over the player half a second later.
    const scaleY = enemyGroup.userData.materializeTarget ?? enemyGroup.scale.y;
    const enemyScaledBodyHeight = enemyBaseHeight * scaleY;
    return playerActualHeight > enemyScaledBodyHeight;
}

// --- Spawn telegraph (tension pass) ---
// Call AFTER the spawner has set the enemy's final scale and position: the
// enemy scales in from SPAWN_MATERIALIZE_START_SCALE to full size over
// SPAWN_MATERIALIZE_TIME (ease-out), with a burst of its body color on its
// first live frame (fired from updateEnemies so it survives resetEffects
// and lands after the seamless-torus re-image). While materializing the
// enemy neither moves nor collides.
export function beginMaterialize(enemyGroup) {
    const ud = enemyGroup.userData;
    ud.materializeTarget = enemyGroup.scale.x;
    ud.materializing = SPAWN_MATERIALIZE_TIME;
    ud.materializeBurstPending = true;
    enemyGroup.scale.setScalar(ud.materializeTarget * SPAWN_MATERIALIZE_START_SCALE);
}

// Scratch origin for the materialize burst — never allocated per spawn.
const materializeOrigin = { x: 0, y: 0, z: 0 };

// --- Enemy Update (called every frame from update()) ---
// Handles enemy coloring, AI movement (flee/chase/orbit + random drift),
// avoidance, world wrapping, and collision with the player.
// All distances/directions between world entities are torus-aware
// (src/worldmath.js) so AI takes the short way across the wrap seam.
// dt is the frame delta in seconds; all speeds are units/second.
// Iterates backwards so killEnemy's splice never skips the next enemy;
// enemies appended mid-frame by spawnNewEnemies() get indexes above the
// cursor and intentionally act on the NEXT frame (same as the old forEach).
export function updateEnemies(dt) {
    // Refresh the player's AABB ONCE for this whole collision pass —
    // setFromObject traverses all child meshes and is too heavy per enemy.
    playerBox.setFromObject(state.player);
    // Jump (endless): flatten the collision test to XZ while airborne by
    // stretching the box back down to the ground it left — hopping is for
    // rocks, never an accidental enemy dodge (owner queue item 5).
    if (state.jumpOffset > 0) playerBox.min.y -= state.jumpOffset;
    for (let i = state.enemies.length - 1; i >= 0; i--) {
        const enemyGroup = state.enemies[i];
        const bodyMesh = enemyGroup.getObjectByName('body'); // Get the body mesh

        // The body material INSTANCE is shared by legs, ears, and tail, so
        // one setHex flips them all; the cap has its own instance (lighter
        // shade) and flips alongside. Feet keep the shared dark-blue material.
        const capMaterial = enemyGroup.userData.capMaterial;
        if (canKillSpecificEnemy(enemyGroup)) {
            if (bodyMesh) bodyMesh.material.color.setHex(0xFFEB3B); // Bright Yellow if killable
            if (capMaterial) capMaterial.color.setHex(KILLABLE_CAP_COLOR);
            enemyGroup.userData.killable = true; // effects.js drives the aura/wobble off this
        } else {
            if (bodyMesh) bodyMesh.material.color.setHex(0x03A9F4); // Electric Blue otherwise
            if (capMaterial) capMaterial.color.setHex(NORMAL_CAP_COLOR);
            enemyGroup.userData.killable = false;
        }

        // --- Spawn telegraph: materialize before acting (tension pass) ---
        // Colors above already ran (canKillSpecificEnemy judges by the FULL
        // size), so the forming enemy wears its true colors; everything
        // below — AI, movement, and the player-collision AABB test — is
        // skipped until it finishes scaling in.
        const ud = enemyGroup.userData;
        if (ud.materializing !== undefined) {
            if (ud.materializeBurstPending) {
                // First live frame: puff of the body color at the spawn spot
                // (post-re-image, so it is visible even across the seam).
                ud.materializeBurstPending = false;
                materializeOrigin.x = enemyGroup.position.x;
                // Endless: the burst rides the terrain-grounded enemy (y = 0 classic)
                materializeOrigin.y = (ud.bodyBaseY ?? 0.9) * ud.materializeTarget +
                    (state.worldMode === 'endless' ? enemyGroup.position.y : 0);
                materializeOrigin.z = enemyGroup.position.z;
                spawnBurst(materializeOrigin, {
                    count: 18,
                    colorFrom: bodyMesh ? bodyMesh.material.color.getHex() : 0x03A9F4,
                    speed: 3.5,
                    upBias: 2,
                    life: 0.5,
                    gravity: 5
                });
            }
            ud.materializing -= dt;
            const t = Math.min(1, 1 - ud.materializing / SPAWN_MATERIALIZE_TIME);
            const eased = 1 - (1 - t) * (1 - t); // Ease-out: fast arrival, soft landing
            enemyGroup.scale.setScalar(
                ud.materializeTarget * (SPAWN_MATERIALIZE_START_SCALE + (1 - SPAWN_MATERIALIZE_START_SCALE) * eased)
            );
            if (ud.materializing <= 0) {
                enemyGroup.scale.setScalar(ud.materializeTarget);
                delete ud.materializing;
                delete ud.materializeTarget;
            }
            continue; // No movement, no collision until fully formed
        }

        // --- Enemy AI: Movement Logic ---
        const distanceToPlayer = torusDistance(enemyGroup.position, state.player.position);
        let combinedMovement = new THREE.Vector3();

        // --- Random Movement Component (calculated for all states) ---
        enemyGroup.timeToChangeRandomVelocity -= dt;
        if (enemyGroup.timeToChangeRandomVelocity <= 0) {
            const randomStrength = state.actualEnemySpeed * enemyRandomDriftFactor;
            enemyGroup.randomVelocity.set(
                (Math.random() - 0.5) * 2 * randomStrength,
                0,
                (Math.random() - 0.5) * 2 * randomStrength
            );
            enemyGroup.timeToChangeRandomVelocity = Math.random() * 2 + 1;
        }

        if (canKillSpecificEnemy(enemyGroup)) {
            // --- Fleeing Behavior ---
            if (distanceToPlayer > 0) { // Avoid issues if somehow at the exact same spot
                // Flee = the shortest-path direction to the player, negated
                const fleeDirection = torusDelta(enemyGroup.position, state.player.position, tmpVec).normalize().negate();
                combinedMovement.copy(fleeDirection).multiplyScalar(state.actualEnemySpeed);
            }
        } else {
            // --- Normal Chase and Orbit Logic ---
            const chaseDirection = torusDelta(enemyGroup.position, state.player.position, tmpVec).normalize();
            if (distanceToPlayer < engagementRadius) {
                // --- Orbiting Behavior ---
                const orbitVector = new THREE.Vector3(-chaseDirection.z * enemyGroup.orbitDirection, 0, chaseDirection.x * enemyGroup.orbitDirection);
                const chaseComponent = chaseDirection.clone().multiplyScalar(1.0 - orbitStrengthFactor);
                const orbitComponent = orbitVector.normalize().multiplyScalar(orbitStrengthFactor);
                combinedMovement.add(chaseComponent).add(orbitComponent).normalize().multiplyScalar(state.actualEnemySpeed);
            } else {
                // --- Pure Chase Behavior (outside engagement radius) ---
                combinedMovement.copy(chaseDirection).multiplyScalar(state.actualEnemySpeed);
            }
        }

        // Add random drift to the calculated movement (applies to both flee and chase/orbit)
        combinedMovement.add(enemyGroup.randomVelocity);

        // Separation is a pre-cap steering component (NOT a post-movement
        // position shove — that caused the two-enemy jitter, plan 005).
        computeAvoidance(enemyGroup, avoidVec);
        if (avoidVec.lengthSq() > 0) {
            combinedMovement.addScaledVector(avoidVec.normalize(), state.actualEnemySpeed * AVOID_SPEED_FACTOR);
        }

        // Cap total speed; the 1.25 headroom lets separation win slightly
        // over chase without runaway speed.
        const maxSpeed = state.actualEnemySpeed * 1.25;
        if (combinedMovement.length() > maxSpeed) {
            combinedMovement.normalize().multiplyScalar(maxSpeed);
        }

        if (state.worldMode === 'endless') {
            // Endless: water and boulders are impassable — resolve by
            // axis-separated slide (with the anti-wedge detour), then walk
            // the terrain — grounded BEFORE the collision test so the AABB
            // height matches the player's grounded one on slopes.
            moveEnemyWithCollision(enemyGroup, combinedMovement, dt);
            enemyGroup.position.y = groundHeightAt(enemyGroup.position.x, enemyGroup.position.z);
        } else {
            enemyGroup.position.addScaledVector(combinedMovement, dt);
        }

        // NO canonical wrap here (seamless torus rendering): after the player
        // moves, game.js re-images every entity to its player-nearest torus
        // image, so an enemy may legitimately sit outside ±worldBoundary.
        // All gameplay math above is torus-aware, so this is invisible to AI.

        // --- Collision Detection (with player) ---
        scratchBox.setFromObject(enemyGroup); // enemyGroup is now the object
        if (playerBox.intersectsBox(scratchBox)) {
            if (canKillSpecificEnemy(enemyGroup)) {
                killEnemy(enemyGroup, i); // splice(i, 1) — safe going backwards
                continue;
            } else {
                endGame('The enemy caught you.');
                return; // NOW actually exits the enemy update
            }
        }
    }
}

// Removes a killed enemy and pays out its rewards: the size-scaled kill
// bounty times the combo multiplier, a "+N" popup, 4 food particles at the
// death position, plus (up to) two new, larger enemies. The single kill
// path — future kill causes must call this too.
export function killEnemy(enemyGroup, index) {
    const enemyDeathPosition = enemyGroup.position.clone(); // Get position before removing

    // Size bounty (score-juice pass): bigger enemies pay more — the risk of
    // hunting up the food chain is now worth points, not just pride.
    const bounty = KILL_POINTS + SIZE_BOUNTY_PER_UNIT * Math.floor(enemyBaseHeight * enemyGroup.scale.y);
    // Combo multiplier: kills chained within COMBO_WINDOW escalate x1, x2...
    // up to COMBO_MAX. The window refreshes on every kill; timers.js expires
    // it on the game clock, and ui.js resets it on death / new game.
    state.comboCount = state.comboTimeLeft > 0 ? Math.min(state.comboCount + 1, COMBO_MAX) : 1;
    state.comboTimeLeft = COMBO_WINDOW;
    const payout = bounty * state.comboCount;

    // Death explosion (plan 015): burst in the enemy's CURRENT body color
    // (yellow, since it was killable) transitioning to food-lime — the
    // visual sentence "enemy becomes food". Origin at the body's center.
    const bodyMesh = enemyGroup.getObjectByName('body');
    const burstColor = bodyMesh ? bodyMesh.material.color.getHex() : 0xFFEB3B;
    // Body center — plus the terrain under the enemy in endless (y = 0 classic)
    enemyDeathPosition.y = (enemyGroup.userData.bodyBaseY ?? 0.9) * enemyGroup.scale.y +
        (state.worldMode === 'endless' ? enemyGroup.position.y : 0);
    onEnemyKilled(enemyDeathPosition, burstColor, enemyGroup.scale.y);
    spawnScorePopup(enemyDeathPosition, payout); // "+N" rises from the body center
    triggerKillShake(); // 0.12s camera thump (no-op under reduced motion)
    enemyDeathPosition.y = 0; // Food still spawns at ground level below

    state.scene.remove(enemyGroup);
    disposeCharacter(enemyGroup); // Release the per-instance body material
    state.enemies.splice(index, 1);
    sfx.kill(state.comboCount - 1); // Pitch climbs with the combo

    // Kill bounty (plan 011): hunting must beat pacifism — the README's
    // "strategically defeating enemies" promise, now actually paid.
    state.score += payout;
    updateScoreDisplay();
    if (state.comboCount > 1) showComboChip(state.comboCount);

    // Spawn 4 food particles
    for (let i = 0; i < 4; i++) {
        spawnAtPosition(enemyDeathPosition);
    }

    spawnNewEnemies();
}

// The ramped enemy scale factor: the classic height rule, times the endless
// distance ramp (+RAMP_HEIGHT_STEP per level — foes visibly tower the
// further out you push). Classic reads the ramp as level 0, factor 1.
function currentEnemyScaleFactor() {
    let targetHeight = state.playerScale * 1.0 * ENEMY_HEIGHT_FACTOR;
    if (state.worldMode === 'endless') {
        targetHeight *= 1 + state.endlessRampLevel * RAMP_HEIGHT_STEP;
    }
    return targetHeight / enemyBaseHeight;
}

export function spawnNewEnemies() {
    // Population cap (plan 011): only spawn into free slots under the cap
    // (endless runs a higher one — its bubble target ramps up). Zero is
    // valid — a full horde means the kill still paid points and food,
    // which is the difficulty curve's relief valve.
    const endless = state.worldMode === 'endless';
    const cap = endless ? ENDLESS_ENEMY_CAP : MAX_ENEMIES;
    const slots = Math.max(0, cap - state.enemies.length);
    const count = Math.min(ENEMIES_PER_KILL, slots);
    if (count === 0) return;

    const newEnemyScaleFactor = currentEnemyScaleFactor();

    // Calculate dynamic spawn distance based on playerScale, capped so spawns
    // always land inside the world even for a huge player (plan 005). In
    // endless the cap is the bubble's far edge instead — kill-spawned foes
    // must land inside the streaming bubble, never beyond the despawn ring.
    const spawnDistance = Math.min(
        BASE_ENEMY_SPAWN_DISTANCE + (state.playerScale * SPAWN_DISTANCE_SCALE_FACTOR),
        endless ? ENDLESS_SPAWN_MAX : worldBoundary * 0.8
    );

    // First enemy at a random angle; second on the opposite side (angle1 + PI)
    // with a random deviation of +/- 45 degrees (PI/4 radians).
    const angle1 = Math.random() * Math.PI * 2;
    for (let n = 0; n < count; n++) {
        let angle = n === 0
            ? angle1
            : angle1 + Math.PI + (Math.random() - 0.5) * (Math.PI / 2);
        let spawnX = state.player.position.x + Math.cos(angle) * spawnDistance;
        let spawnZ = state.player.position.z + Math.sin(angle) * spawnDistance;
        if (endless) {
            // Land placement: keep the angle intent for the first try, then
            // re-roll around the circle. All-water rings are practically
            // impossible at this world's lake coverage; if it happens the
            // bubble spawner (updateEnemyStreaming) tops the count back up.
            const radius = newEnemyScaleFactor * ENEMY_COLLIDER_HALF_WIDTH;
            let placed = isWalkable(spawnX, spawnZ, radius);
            for (let attempt = 0; !placed && attempt < 8; attempt++) {
                angle = Math.random() * Math.PI * 2;
                spawnX = state.player.position.x + Math.cos(angle) * spawnDistance;
                spawnZ = state.player.position.z + Math.sin(angle) * spawnDistance;
                placed = isWalkable(spawnX, spawnZ, radius);
            }
            if (!placed) continue;
        }
        const enemy = createEnemy();
        enemy.scale.set(newEnemyScaleFactor, newEnemyScaleFactor, newEnemyScaleFactor);
        enemy.position.y = 0;
        enemy.position.x = spawnX;
        enemy.position.z = spawnZ;
        wrapPosition(enemy.position); // A capped distance can still cross the seam near an edge
        if (endless) {
            // Grounded from frame one: the materialize telegraph must grow
            // out of the hillside, not hover at y=0 inside it.
            enemy.position.y = groundHeightAt(enemy.position.x, enemy.position.z);
        }
        beginMaterialize(enemy); // Scale-in telegraph: no pop-in, no instant threat
    }
}

// --- Endless collision movement (axis-separated slide + anti-wedge) ---
// Blocked axes are zeroed independently, so a chase line that hits water
// naturally becomes a slide along the shore. A CHASING enemy that stays
// fully blocked accumulates wedge time and earns a 45-degree detour heading
// for a moment — it feels like the monster looking for a way around. A
// FLEEING (killable) enemy never detours: cornering prey against a lake is
// the hunt's intended reward.
function moveEnemyWithCollision(enemyGroup, movement, dt) {
    const ud = enemyGroup.userData;
    if (ud.detourTime > 0) {
        ud.detourTime -= dt;
        const a = (Math.PI / 4) * ud.detourSign;
        const cos = Math.cos(a), sin = Math.sin(a);
        const mx0 = movement.x, mz0 = movement.z;
        movement.x = mx0 * cos - mz0 * sin;
        movement.z = mx0 * sin + mz0 * cos;
    }
    const mx = movement.x * dt;
    const mz = movement.z * dt;
    // Honest collider: the enemy body cube's true visual half-width,
    // resolved by the same shared slide as the player (terrain.js).
    const radius = enemyGroup.scale.y * ENEMY_COLLIDER_HALF_WIDTH;
    const p = enemyGroup.position;
    const step = slideMove(p.x, p.z, mx, mz, radius);
    p.x += step.x;
    p.z += step.z;
    const appliedX = step.x, appliedZ = step.z;

    const desired = Math.hypot(mx, mz);
    const applied = Math.hypot(appliedX, appliedZ);
    if (!ud.killable && desired > 1e-6 && applied < desired * 0.25) {
        // Damp the shore jitter: a blocked enemy drops its random drift so
        // it stands (or slides) cleanly instead of vibrating at the edge.
        enemyGroup.randomVelocity.set(0, 0, 0);
        ud.wedgeTime = (ud.wedgeTime || 0) + dt;
        if (ud.wedgeTime >= ENEMY_WEDGE_TIME) {
            ud.wedgeTime = 0;
            ud.detourTime = ENEMY_DETOUR_TIME;
            ud.detourSign = Math.random() < 0.5 ? -1 : 1;
        }
    } else if (ud.wedgeTime) {
        ud.wedgeTime = 0;
    }
}

// --- Endless monster bubble (streaming) ---
// Maintains the ramped population target inside the bubble around the
// player: despawn AND DISPOSE beyond ENEMY_DESPAWN_RADIUS (walking away
// must release resources, not leak a trail of frozen hunters), top up one
// throttled materialize at a time on land, ENDLESS_SPAWN_MIN..MAX out.
let bubbleSpawnCooldown = 0;

export function resetEnemyStreaming() {
    bubbleSpawnCooldown = 0;
}

export function updateEnemyStreaming(dt) {
    for (let i = state.enemies.length - 1; i >= 0; i--) {
        const enemy = state.enemies[i];
        if (torusDistance(enemy.position, state.player.position) > ENEMY_DESPAWN_RADIUS) {
            state.scene.remove(enemy);
            disposeCharacter(enemy); // Per-instance body/cap materials released
            state.enemies.splice(i, 1);
        }
    }

    const target = Math.min(ENDLESS_ENEMY_TARGET + state.endlessRampLevel, ENDLESS_ENEMY_CAP);
    bubbleSpawnCooldown -= dt;
    if (bubbleSpawnCooldown > 0 || state.enemies.length >= target) return;
    bubbleSpawnCooldown = ENDLESS_SPAWN_INTERVAL;

    const scaleFactor = currentEnemyScaleFactor();
    const radius = scaleFactor * ENEMY_COLLIDER_HALF_WIDTH;
    for (let attempt = 0; attempt < 10; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = ENDLESS_SPAWN_MIN + Math.random() * (ENDLESS_SPAWN_MAX - ENDLESS_SPAWN_MIN);
        const spawnX = state.player.position.x + Math.cos(angle) * dist;
        const spawnZ = state.player.position.z + Math.sin(angle) * dist;
        if (!isWalkable(spawnX, spawnZ, radius)) continue;
        const enemy = createEnemy();
        enemy.scale.setScalar(scaleFactor);
        enemy.position.set(spawnX, groundHeightAt(spawnX, spawnZ), spawnZ);
        beginMaterialize(enemy); // Same telegraph as every other spawn
        return;
    }
}

// Sums the normalized (torus-aware) away-directions from every neighbor
// within the avoid radius into `out`. The caller scales the result into a
// steering component before the speed cap.
function computeAvoidance(enemyGroup, out) {
    const avoidRadius = 7;
    out.set(0, 0, 0);
    state.enemies.forEach((otherEnemyGroup) => {
        if (otherEnemyGroup !== enemyGroup) {
            const distance = torusDistance(enemyGroup.position, otherEnemyGroup.position);
            if (distance > 0 && distance < avoidRadius) {
                // Direction away from the other enemy, across the seam if shorter
                torusDelta(otherEnemyGroup.position, enemyGroup.position, awayVec).normalize();
                out.add(awayVec);
            }
        }
    });
    return out;
}
