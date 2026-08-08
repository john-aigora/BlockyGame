import * as THREE from 'three';
import {
    enemyBaseHeight, worldBoundary, engagementRadius, orbitStrengthFactor,
    enemyRandomDriftFactor, AVOID_SPEED_FACTOR, BASE_ENEMY_SPAWN_DISTANCE, SPAWN_DISTANCE_SCALE_FACTOR,
    KILL_POINTS, MAX_ENEMIES, ENEMIES_PER_KILL, ENEMY_HEIGHT_FACTOR,
    SPAWN_SIZE_PATTERN, PREY_HEIGHT_RANGE, PEER_HEIGHT_RANGE,
    SPRINTER_HEIGHT_RANGE, JUJA_HEIGHT_FACTOR,
    SIZE_BOUNTY_PER_UNIT, COMBO_WINDOW, COMBO_MAX,
    SPAWN_MATERIALIZE_TIME, SPAWN_MATERIALIZE_START_SCALE,
    SPAWN_WARN_TIME, SPAWN_WARN_RADIUS, SPAWN_WARN_SPEED_REF,
    ENEMY_COLLIDER_HALF_WIDTH, ENEMY_WEDGE_TIME, ENEMY_DETOUR_TIME,
    ENDLESS_ENEMY_TARGET, ENDLESS_ENEMY_CAP, ENEMY_DESPAWN_RADIUS,
    ENDLESS_SPAWN_MIN, ENDLESS_SPAWN_MAX, ENDLESS_SPAWN_INTERVAL, RAMP_HEIGHT_STEP,
    PLAYER_COLLIDER_HALF_WIDTH, ENEMY_SPECIES,
    KILL_SPAWN_PREY_MIN, KILL_SPAWN_PREY_MAX
} from './constants.js';
import { state } from './state.js';
import { createCharacter, disposeCharacter, shadeColor, CAP_LIGHTEN } from './characters.js';
import { groundHeightAt, isWalkable, slideMove, applyWorldBend } from './terrain.js';
import { spawnAtPosition } from './collectibles.js';
import { endGame, updateScoreDisplay, showComboChip } from './ui.js';
import { wrapPosition, torusDelta, torusDistance } from './worldmath.js';
import { sfx } from './audio.js';
import { onEnemyKilled, spawnScorePopup, spawnBurst } from './effects.js';
import { triggerKillShake } from './world.js';
import { rumble } from './rumble.js';

// Module-level scratch vectors — reused every frame to avoid per-frame allocation.
const tmpVec = new THREE.Vector3();
const avoidVec = new THREE.Vector3();
const awayVec = new THREE.Vector3();
// Hot-loop trio (plan 020 P-6): the combined steering vector and the
// orbit/chase components were fresh Vector3s per enemy per frame. NOTE:
// moveEnemyWithCollision MUTATES the movement vector (detour rotation), so
// moveScratch is re-zeroed at the top of every enemy iteration.
const moveScratch = new THREE.Vector3();
const orbitScratch = new THREE.Vector3();
const chaseScratch = new THREE.Vector3();

// Module-level scratch AABBs — the ONLY Box3 instances in the codebase
// (plan 007). playerBox is refreshed once per collision section; scratchBox
// is reused for every enemy/collectible test. game.js imports both.
export const playerBox = new THREE.Box3();
export const scratchBox = new THREE.Box3();

// Scratch for the explicit hitbox builders below — never allocated per frame.
const boxCenter = new THREE.Vector3();
const boxSize = new THREE.Vector3();

// --- Explicit gameplay hitboxes (audit C-2) ---
// Gameplay collides the BODY BLOCK, not the render tree (tails/scarves/
// outlines are decoration) — audit C-2. The old render-tree bbox unioned
// EVERY child mesh: the ×1.06 outline shell, the enemy tail (to −1.044 ×
// base height behind the center), the hero scarf (to z ≈ −0.91 × scale),
// and face parts riding in front — at giant scales, decorations were making
// contact 40+ units before the bodies did (B3 probe evidence). Deriving the
// player box from state.playerScale (not the render scale) also means the
// collect squash / milestone pulse no longer throbs the hitbox.
// Both builders stay EXPORTED: plan 026 reuses them for per-player collision.
export function setPlayerCollisionBox(box) {
    const s = state.playerScale;
    const half = PLAYER_COLLIDER_HALF_WIDTH * s; // True visual half-width × scale
    boxCenter.set(
        state.player.position.x,
        state.player.position.y + s * 0.5, // Body height base is 1.0 — center at half-height
        state.player.position.z
    );
    boxSize.set(half * 2, s * 1.0, half * 2);
    box.setFromCenterAndSize(boxCenter, boxSize);
    // Jump (endless): flatten the collision test to XZ while airborne by
    // stretching the box back down to the ground it left — hopping is for
    // rocks, never an accidental enemy dodge (owner queue item 5).
    if (state.jumpOffset > 0) box.min.y -= state.jumpOffset;
    return box;
}

export function setEnemyCollisionBox(box, enemyGroup) {
    // Gameplay collides the BODY BLOCK, not the render tree (tails/scarves/
    // outlines are decoration) — audit C-2.
    const sy = enemyGroup.scale.y;
    const half = ENEMY_COLLIDER_HALF_WIDTH * sy; // True visual half-width × scale
    boxCenter.set(
        enemyGroup.position.x,
        enemyGroup.position.y + enemyBaseHeight * sy * 0.5, // enemyBaseHeight = 1.2
        enemyGroup.position.z
    );
    boxSize.set(half * 2, enemyBaseHeight * sy, half * 2);
    box.setFromCenterAndSize(boxCenter, boxSize);
    return box;
}

// The cap (top-face highlight) flips shade-for-shade with the body color —
// computed once here from the same shade factor characters.js builds with.
// The un-flip side is per-enemy (ud.baseCapColor): species carry their own
// base colors now (plan 024).
const KILLABLE_CAP_COLOR = shadeColor(0xFFEB3B, CAP_LIGHTEN);

export function createEnemy(speciesKey = 'grunt') {
    // Species stats bag (plan 024): per-enemy speed factor, body color,
    // harmless flag, and food drop — all data from the GAME BALANCE table.
    const species = ENEMY_SPECIES[speciesKey] ?? ENEMY_SPECIES.grunt;
    const baseBodyColor = species.bodyColor ?? 0x03A9F4; // null = classic Electric Blue
    // perInstanceBodyMaterial: each enemy's body color flips independently
    // between killable-yellow and its species base, so the material cannot be
    // shared. menacing: pointed ears, tail, back spikes, underbite jaw
    // (characters.js).
    const enemyGroup = createCharacter({ baseSize: enemyBaseHeight, bodyColor: baseBodyColor, faceColor: 0x222222, perInstanceBodyMaterial: true, menacing: true });
    enemyGroup.userData.species = species;
    enemyGroup.userData.speciesKey = speciesKey;
    // The killable flip must RESTORE these on un-flip — stored per enemy, so
    // a sprinter goes back to orange, never to a hard-coded blue (plan 024
    // maintenance note).
    enemyGroup.userData.baseBodyColor = baseBodyColor;
    enemyGroup.userData.baseCapColor = shadeColor(baseBodyColor, CAP_LIGHTEN);

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

// --- Pre-spawn red warn (owner request: notice before monsters appear) ---
// A pulsing red disc on the ground for SPAWN_WARN_TIME, then the enemy
// materializes there. Disc is pooled; nothing is allocated after warm-up.
const pendingSpawns = []; // { x, z, scaleFactor, species, t, warnTime, mesh }
const warnDiscPool = [];
let warnMaterial = null;
const WARN_GEO = new THREE.RingGeometry(0.35, 1.0, 28);

function getWarnMaterial() {
    if (!warnMaterial) {
        warnMaterial = new THREE.MeshBasicMaterial({
            color: 0xFF1744,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        applyWorldBend(warnMaterial);
    }
    return warnMaterial;
}

function acquireWarnDisc() {
    let mesh = warnDiscPool.pop();
    if (!mesh) {
        mesh = new THREE.Mesh(WARN_GEO, getWarnMaterial());
        mesh.rotation.x = -Math.PI / 2; // Flat on XZ
        mesh.renderOrder = 2;
    }
    mesh.visible = true;
    return mesh;
}

function releaseWarnDisc(mesh) {
    if (!mesh) return;
    mesh.visible = false;
    if (mesh.parent) mesh.parent.remove(mesh);
    warnDiscPool.push(mesh);
}

// Queue a monster: red ground flash first, then materialize. speciesKey
// rides the pending entry so the warn's monster keeps its species (plan 024).
export function scheduleEnemySpawn(spawnX, spawnZ, scaleFactor, speciesKey = 'grunt') {
    if (!state.scene) return;
    const mesh = acquireWarnDisc();
    const y = state.worldMode === 'endless'
        ? groundHeightAt(spawnX, spawnZ) + 0.08
        : 0.08;
    mesh.position.set(spawnX, y, spawnZ);
    const r = SPAWN_WARN_RADIUS * Math.max(0.85, scaleFactor);
    mesh.scale.set(r, r, r);
    state.scene.add(mesh);
    // Speed-aware notice (plan 024, audit DT-9): warn duration scales with
    // the CURRENT player speed so notice is constant in player-travel, not
    // seconds. Clamped [1.0, 2.2] — never shorter than the classic 0.95s,
    // never a stale disc parade. Captured per entry at schedule time.
    const warnTime = SPAWN_WARN_TIME * Math.min(2.2, Math.max(1.0,
        (state.actualPlayerSpeed ?? SPAWN_WARN_SPEED_REF) / SPAWN_WARN_SPEED_REF));
    pendingSpawns.push({
        x: spawnX,
        z: spawnZ,
        scaleFactor,
        species: speciesKey,
        t: warnTime,
        warnTime,
        mesh
    });
}

export function clearPendingSpawns() {
    for (const p of pendingSpawns) releaseWarnDisc(p.mesh);
    pendingSpawns.length = 0;
}

// Read-only pending-warn introspection for specs (plan 024 steps 4-5):
// plain data copies of the queue — never the live entries or their meshes.
export function pendingSpawnInfo() {
    return pendingSpawns.map((p) => ({
        x: p.x,
        z: p.z,
        scaleFactor: p.scaleFactor,
        species: p.species,
        t: p.t,
        warnTime: p.warnTime
    }));
}

// Floating-origin: warn discs + scheduled coords are local-frame too.
export function shiftPendingSpawns(dx, dz) {
    for (const p of pendingSpawns) {
        p.x -= dx;
        p.z -= dz;
        if (p.mesh) {
            p.mesh.position.x -= dx;
            p.mesh.position.z -= dz;
        }
    }
}

// Classic seamless-torus support (audit C-13): pending warn discs cross the
// seam like every other entity. game.js reimageEntities passes fn(x, z) →
// nearest-image {x, z} (the same player-relative mapping live enemies get);
// both the visible disc AND the scheduled materialize coordinate move, so a
// monster never materializes ~worldSize away from its own warning. Endless
// never calls this — there is no seam.
export function reimagePendingSpawns(fn) {
    for (const p of pendingSpawns) {
        const img = fn(p.x, p.z);
        if (img.x === p.x && img.z === p.z) continue;
        p.x = img.x;
        p.z = img.z;
        if (p.mesh) {
            p.mesh.position.x = img.x;
            p.mesh.position.z = img.z;
        }
    }
}

// Advances warn discs; fires the real spawn when the timer ends.
export function updateSpawnWarnings(dt) {
    // Shared material: one global pulse for all discs (per-disc opacity
    // would fight each other when multiple warns overlap). Phase runs on
    // each entry's OWN elapsed time (warnTime - t): durations vary per
    // schedule-time player speed (plan 024 DT-9).
    if (pendingSpawns.length > 0 && warnMaterial) {
        const p0 = pendingSpawns[0];
        const pulse = 0.5 + 0.5 * Math.sin((p0.warnTime - p0.t) * 10);
        warnMaterial.opacity = 0.3 + 0.45 * pulse;
    }
    for (let i = pendingSpawns.length - 1; i >= 0; i--) {
        const p = pendingSpawns[i];
        p.t -= dt;
        // Per-mesh scale throb (opacity is global above).
        const pulse = 0.5 + 0.5 * Math.sin((p.warnTime - p.t) * 10);
        const r = SPAWN_WARN_RADIUS * Math.max(0.85, p.scaleFactor) * (0.92 + 0.12 * pulse);
        p.mesh.scale.set(r, r, r);
        // Keep grounded if the origin rebased under the disc.
        if (state.worldMode === 'endless') {
            p.mesh.position.y = groundHeightAt(p.x, p.z) + 0.08;
        }
        if (p.t > 0) continue;
        // Time's up: spawn the real monster and drop the warn disc.
        releaseWarnDisc(p.mesh);
        pendingSpawns.splice(i, 1);
        const enemy = createEnemy(p.species);
        enemy.scale.setScalar(p.scaleFactor);
        enemy.position.set(
            p.x,
            state.worldMode === 'endless' ? groundHeightAt(p.x, p.z) : 0,
            p.z
        );
        if (state.worldMode !== 'endless') wrapPosition(enemy.position);
        beginMaterialize(enemy);
    }
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
    // Refresh the player's AABB ONCE for this whole collision pass. The
    // explicit builder (audit C-2) covers the body block only and preserves
    // the airborne flatten rule internally.
    setPlayerCollisionBox(playerBox);
    for (let i = state.enemies.length - 1; i >= 0; i--) {
        const enemyGroup = state.enemies[i];
        const ud = enemyGroup.userData;
        const bodyMesh = ud.bodyMesh; // Tagged at build (plan 020 P-6 — no name lookup)

        // Killability is computed ONCE per enemy per frame and reused by the
        // AI and collision branches below (nothing it depends on changes
        // mid-iteration). The body material INSTANCE is shared by legs,
        // ears, and tail, so one setHex flips them all; the cap has its own
        // instance (lighter shade). Colors flip only on the killable-state
        // TRANSITION (plan 020 P-6 — same pattern as effects.js's scared
        // flip), not every frame. Un-flip restores the STORED species base
        // color, never a literal (plan 024). A harmless species (juja) skips
        // the color flip entirely — it is always edible, so the yellow "now
        // killable" repaint would be noise on its green identity; the aura/
        // scared face (effects.js, driven off ud.killable) still telegraph
        // edibility.
        const killableNow = canKillSpecificEnemy(enemyGroup);
        if (killableNow !== ud.killable) {
            ud.killable = killableNow; // effects.js drives the aura/wobble off this
            if (!ud.species.harmless) {
                const capMaterial = ud.capMaterial;
                if (bodyMesh) bodyMesh.material.color.setHex(killableNow ? 0xFFEB3B : ud.baseBodyColor); // Yellow = killable, species base = hunter
                if (capMaterial) capMaterial.color.setHex(killableNow ? KILLABLE_CAP_COLOR : ud.baseCapColor);
            }
        }

        // --- Spawn telegraph: materialize before acting (tension pass) ---
        // Colors above already ran (canKillSpecificEnemy judges by the FULL
        // size), so the forming enemy wears its true colors; everything
        // below — AI, movement, and the player-collision AABB test — is
        // skipped until it finishes scaling in.
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
        const combinedMovement = moveScratch.set(0, 0, 0); // Re-zeroed per enemy (mutated below)
        // Species speed (plan 024): this enemy's own pace — the four speed
        // sites (flee, orbit, chase, and the total cap) all read it, so a
        // species can't outrun its own separation steering. Random drift and
        // avoidance deliberately stay on the GLOBAL speed (plan 024: only
        // the four sites thread the factor).
        const speciesSpeed = state.actualEnemySpeed * ud.species.speedFactor;

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

        if (killableNow) {
            // --- Fleeing Behavior ---
            if (distanceToPlayer > 0) { // Avoid issues if somehow at the exact same spot
                // Flee = the shortest-path direction to the player, negated
                const fleeDirection = torusDelta(enemyGroup.position, state.player.position, tmpVec).normalize().negate();
                combinedMovement.copy(fleeDirection).multiplyScalar(speciesSpeed);
            }
        } else {
            // --- Normal Chase and Orbit Logic ---
            const chaseDirection = torusDelta(enemyGroup.position, state.player.position, tmpVec).normalize();
            if (distanceToPlayer < engagementRadius) {
                // --- Orbiting Behavior (scratch vectors — plan 020 P-6) ---
                const orbitVector = orbitScratch.set(-chaseDirection.z * enemyGroup.orbitDirection, 0, chaseDirection.x * enemyGroup.orbitDirection);
                const chaseComponent = chaseScratch.copy(chaseDirection).multiplyScalar(1.0 - orbitStrengthFactor);
                const orbitComponent = orbitVector.normalize().multiplyScalar(orbitStrengthFactor);
                combinedMovement.add(chaseComponent).add(orbitComponent).normalize().multiplyScalar(speciesSpeed);
            } else {
                // --- Pure Chase Behavior (outside engagement radius) ---
                combinedMovement.copy(chaseDirection).multiplyScalar(speciesSpeed);
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
        // over chase without runaway speed. The cap rides the SPECIES speed
        // (plan 024) so a sprinter keeps its separation headroom.
        const maxSpeed = speciesSpeed * 1.25;
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
        setEnemyCollisionBox(scratchBox, enemyGroup); // Body block only (audit C-2)
        if (playerBox.intersectsBox(scratchBox)) {
            if (killableNow) {
                killEnemy(enemyGroup, i); // splice(i, 1) — safe going backwards
                continue;
            } else if (!ud.species.harmless) {
                endGame('The enemy caught you.');
                return; // NOW actually exits the enemy update
            }
            // Harmless species (juja): a non-killable contact never ends the
            // run. The rotation sizes jujas at 0.35x the player, so this is
            // in practice unreachable — the guard exists for oversized test
            // spawns and future tuning (plan 024).
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
    // (killable yellow — or the species base for a juja, which never flips)
    // transitioning to food-lime — the visual sentence "enemy becomes food".
    // Origin at the body's center.
    const bodyMesh = enemyGroup.userData.bodyMesh;
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
    rumble(55, 0.45); // Pad kick on kill

    // Kill bounty (plan 011): hunting must beat pacifism — the README's
    // "strategically defeating enemies" promise, now actually paid.
    state.score += payout;
    updateScoreDisplay();
    if (state.comboCount > 1) showComboChip(state.comboCount);

    // Enemy becomes food — the drop count is species data (plan 024): grunts
    // and sprinters keep the classic 4, the juja snack pays 2.
    const foodDrop = enemyGroup.userData.species.foodDrop;
    for (let i = 0; i < foodDrop; i++) {
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
    // (endless runs a higher one — its bubble target ramps up). Pending
    // red-warn discs count as reserved slots so we never over-queue.
    const endless = state.worldMode === 'endless';
    const cap = endless ? ENDLESS_ENEMY_CAP : MAX_ENEMIES;
    const reserved = state.enemies.length + pendingSpawns.length;
    const slots = Math.max(0, cap - reserved);
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
        // Reachable combos (plan 024, audit DT-2): the FIRST replacement
        // stays the classic giant at the far spawn distance; the SECOND is a
        // chainable PREY-band grunt at KILL_SPAWN_PREY_MIN..MAX — close
        // enough to sprint down inside the 4s combo window at 1x speed (see
        // the constants' reach math). Net kill economy unchanged: still up
        // to ENEMIES_PER_KILL spawns per kill, one of them now chainable.
        const chainable = n === 1;
        let scaleFactor = newEnemyScaleFactor;
        let dist = spawnDistance;
        if (chainable) {
            const [lo, hi] = PREY_HEIGHT_RANGE;
            scaleFactor = (state.playerScale * (lo + Math.random() * (hi - lo))) / enemyBaseHeight;
            dist = KILL_SPAWN_PREY_MIN + Math.random() * (KILL_SPAWN_PREY_MAX - KILL_SPAWN_PREY_MIN);
        }
        let angle = n === 0
            ? angle1
            : angle1 + Math.PI + (Math.random() - 0.5) * (Math.PI / 2);
        let spawnX = state.player.position.x + Math.cos(angle) * dist;
        let spawnZ = state.player.position.z + Math.sin(angle) * dist;
        if (endless) {
            // Land placement: keep the angle intent for the first try, then
            // re-roll around the circle. All-water rings are practically
            // impossible at this world's lake coverage; if it happens the
            // bubble spawner (updateEnemyStreaming) tops the count back up.
            const radius = scaleFactor * ENEMY_COLLIDER_HALF_WIDTH;
            let placed = isWalkable(spawnX, spawnZ, radius);
            for (let attempt = 0; !placed && attempt < 8; attempt++) {
                angle = Math.random() * Math.PI * 2;
                spawnX = state.player.position.x + Math.cos(angle) * dist;
                spawnZ = state.player.position.z + Math.sin(angle) * dist;
                placed = isWalkable(spawnX, spawnZ, radius);
            }
            if (!placed) continue;
        } else {
            const wrapped = { x: spawnX, y: 0, z: spawnZ };
            wrapPosition(wrapped);
            spawnX = wrapped.x;
            spawnZ = wrapped.z;
        }
        // Red ground flash first — monster appears after SPAWN_WARN_TIME.
        // Species: grunt (scheduleEnemySpawn default) for both replacements.
        scheduleEnemySpawn(spawnX, spawnZ, scaleFactor);
    }
}

// --- Test/debug species spawner (plan 024; plan 025's boss reuses it) ---
// A fully-formed enemy of the given species at (x, z): no warn disc, no
// materialize scale-in, so specs measure species behavior from the first
// frame. scaleFactor is the caller's choice — species and size are
// orthogonal axes in the machinery (the ROTATION couples them for real
// spawns). Production code must never call this.
export function debugSpawnSpecies(speciesKey, x, z, scaleFactor = 1) {
    const enemy = createEnemy(speciesKey);
    enemy.scale.setScalar(scaleFactor);
    enemy.position.set(
        x,
        state.worldMode === 'endless' ? groundHeightAt(x, z) : 0,
        z
    );
    return enemy;
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
let bubbleSpawnCounter = 0; // Drives the SPAWN_SIZE_PATTERN rotation

export function resetEnemyStreaming() {
    bubbleSpawnCooldown = 0;
    bubbleSpawnCounter = 0; // Every run opens with the pattern's prey spawn
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
    if (bubbleSpawnCooldown > 0) return;
    // Hard cap counts EVERY body — live enemies plus reserved warn discs —
    // so the bubble never floods past ENDLESS_ENEMY_CAP however much prey
    // is alive (the balance cap spec pins this).
    if (state.enemies.length + pendingSpawns.length >= ENDLESS_ENEMY_CAP) return;
    // Prey supply (audit DT-4): the top-up TARGET gate counts THREATS, not
    // everything. The owner report behind the rotation ("enemies bigger
    // than me keep appearing, I never get to eat anybody" — constants.js,
    // SPAWN_SIZE_PATTERN) had a sequel: hunting well STARVED that fix,
    // because every killable body waiting to be eaten still held a target
    // slot and switched the rotation off. Now only bodies that can catch
    // you count; pending discs are judged by the size they will materialize
    // at (the same height rule as canKillSpecificEnemy).
    let threats = 0;
    for (const e of state.enemies) {
        if (!canKillSpecificEnemy(e)) threats++;
    }
    for (const p of pendingSpawns) {
        if (state.playerScale * 1.0 <= enemyBaseHeight * p.scaleFactor) threats++;
    }
    if (threats >= target) return;
    bubbleSpawnCooldown = ENDLESS_SPAWN_INTERVAL;

    // Size band rotates deterministically (owner fix: the old always-1.5x rule
    // regenerated the bubble pre-grown — "I never get to eat anybody"). Giants
    // keep the classic rule + ramp; prey/peer scale to the player's CURRENT
    // height so a hunt target is always on its way. Species bands (plan 024):
    // sprinter is small and ALWAYS edible — fast but killable (the danger is
    // it reaches you, the answer is you eat it); juja is a fixed-size
    // harmless critter, bonus food on legs.
    const band = SPAWN_SIZE_PATTERN[bubbleSpawnCounter % SPAWN_SIZE_PATTERN.length];
    let scaleFactor;
    let speciesKey = 'grunt';
    if (band === 'giant') {
        scaleFactor = currentEnemyScaleFactor();
    } else if (band === 'juja') {
        speciesKey = 'juja';
        scaleFactor = (state.playerScale * JUJA_HEIGHT_FACTOR) / enemyBaseHeight;
    } else {
        if (band === 'sprinter') speciesKey = 'sprinter';
        const [lo, hi] = band === 'prey' ? PREY_HEIGHT_RANGE
            : band === 'sprinter' ? SPRINTER_HEIGHT_RANGE
                : PEER_HEIGHT_RANGE;
        const targetHeight = state.playerScale * (lo + Math.random() * (hi - lo));
        scaleFactor = targetHeight / enemyBaseHeight;
    }
    const radius = scaleFactor * ENEMY_COLLIDER_HALF_WIDTH;
    for (let attempt = 0; attempt < 10; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = ENDLESS_SPAWN_MIN + Math.random() * (ENDLESS_SPAWN_MAX - ENDLESS_SPAWN_MIN);
        const spawnX = state.player.position.x + Math.cos(angle) * dist;
        const spawnZ = state.player.position.z + Math.sin(angle) * dist;
        if (!isWalkable(spawnX, spawnZ, radius)) continue;
        scheduleEnemySpawn(spawnX, spawnZ, scaleFactor, speciesKey); // Red warn, then materialize
        bubbleSpawnCounter++; // Advance the band rotation only on a real schedule
        return;
    }
}

// Sums the normalized (torus-aware) away-directions from every neighbor
// within the avoid radius into `out`. The caller scales the result into a
// steering component before the speed cap.
function computeAvoidance(enemyGroup, out) {
    const avoidRadius = 7;
    out.set(0, 0, 0);
    // Plain for loop (plan 020 P-6): this runs per enemy pair per frame —
    // the forEach closure was allocation + call overhead in the hottest path.
    for (let i = 0; i < state.enemies.length; i++) {
        const otherEnemyGroup = state.enemies[i];
        if (otherEnemyGroup === enemyGroup) continue;
        const distance = torusDistance(enemyGroup.position, otherEnemyGroup.position);
        if (distance > 0 && distance < avoidRadius) {
            // Direction away from the other enemy, across the seam if shorter
            torusDelta(otherEnemyGroup.position, enemyGroup.position, awayVec).normalize();
            out.add(awayVec);
        }
    }
    return out;
}
