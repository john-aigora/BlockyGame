import * as THREE from 'three';
import {
    MAX_ENEMY_INDICATORS, DANGER_RADIUS, DANGER_VIGNETTE_MAX, HEARTBEAT_BPM, DEATH_SCREEN_DELAY,
    SURVIVAL_BEAT_COOLDOWN, PHEW_PEAK_MIN, NEAR_MISS_FACTOR,
    PLAYER_COLLIDER_HALF_WIDTH, ENEMY_COLLIDER_HALF_WIDTH, DANGER_MUSIC_THRESHOLD,
    WORLD_SEED, DAILY_WORLD
} from './constants.js';
import { state } from './state.js';
import { canKillSpecificEnemy } from './enemies.js';
import { recordScore, recordCoopScore, loadHiscores } from './hiscores.js';
import { torusDistance } from './worldmath.js';
import { unlockAudio, sfx, music, isMuted, setMuted, audioState } from './audio.js';
import { onPlayerDeath, onNewBest, spawnTextPopup } from './effects.js';
import { rumble } from './rumble.js';
import { applySpeedMultiplier } from './game.js';

// Cached DOM references, resolved once at init (plan 007) — the hot loop
// must never call getElementById. game.js calls initUI() before any UI write.
export const el = {
    score: null,
    distanceDisplay: null,
    distance: null,
    time: null,
    finalDistanceLine: null,
    finalDistance: null,
    finalRegions: null,
    collectTime: null,
    collectTimerDisplay: null,
    killIndicator: null,
    comboChip: null,
    dangerVignette: null,
    messageBox: null,
    deathTitle: null, // Swapped per show (plan 029): 'GAME OVER' or 'ASCENDED!'
    deathReason: null,
    finalScore: null,
    startOverlay: null,
    startButton: null,
    endlessHint: null,
    familyBest: null,
    familyBestDistance: null,
    jumpButton: null,
    pauseButton: null,
    speedButton: null,
    hiscoreSlot: null,
    muteButton: null,
    goFlourish: null,
    dailyToggle: null,
    seedValue: null,
    // --- 2P dual-mode elements (plan 026) ---
    onePlayerButton: null, // Start-overlay roster picker
    twoPlayerButton: null,
    scoreDisplay: null, // The solo Score row (hidden in 2P)
    coopHud: null, // The two .player-hud columns (hidden solo)
    coopFinal: null, // 2P death-screen columns (hidden solo)
    coopP1Score: null,
    coopP2Score: null,
    coopP1Distance: null,
    coopP2Distance: null,
    coopTeamScore: null,
    coopFinalRegions: null,
    // Per-seat element sets, indexed by seat.
    seatVignettes: [null, null],
    seatKills: [null, null],
    seatCombos: [null, null],
    seatWaits: [null, null],
    hudScores: [null, null],
    hudDistances: [null, null],
    hudCollects: [null, null],
    hudCollectDisplays: [null, null]
};

// One seat's element out of a data-seat pair.
function bySeat(selector, seat) {
    return document.querySelector(`${selector}[data-seat="${seat}"]`);
}

export function initUI() {
    el.score = document.getElementById('score');
    el.distanceDisplay = document.getElementById('distance-display');
    el.distance = document.getElementById('distance');
    el.time = document.getElementById('time');
    el.finalDistanceLine = document.getElementById('final-distance-line');
    el.finalDistance = document.getElementById('final-distance');
    el.finalRegions = document.getElementById('final-regions');
    el.collectTime = document.getElementById('collect-time');
    el.collectTimerDisplay = document.getElementById('collect-timer-display');
    el.dangerVignette = document.getElementById('danger-vignette');
    dangerReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.killIndicator = document.getElementById('kill-indicator');
    el.comboChip = document.getElementById('combo-chip');
    el.messageBox = document.getElementById('message-box');
    el.deathTitle = document.getElementById('death-title');
    el.deathReason = document.getElementById('death-reason');
    el.finalScore = document.getElementById('final-score');
    el.startOverlay = document.getElementById('start-overlay');
    el.startButton = document.getElementById('start-button');
    el.endlessHint = document.getElementById('endless-hint');
    el.familyBest = document.getElementById('family-best');
    el.familyBestDistance = document.getElementById('family-best-distance');
    el.jumpButton = document.getElementById('jump-button');
    el.pauseButton = document.getElementById('pause-button');
    el.speedButton = document.getElementById('speed-cycle-button');
    el.hiscoreSlot = document.getElementById('hiscore-slot');
    el.muteButton = document.getElementById('mute-button');
    el.goFlourish = document.getElementById('go-flourish');
    el.dailyToggle = document.getElementById('daily-toggle');
    el.seedValue = document.getElementById('seed-value');
    el.onePlayerButton = document.getElementById('one-player-button');
    el.twoPlayerButton = document.getElementById('two-player-button');
    el.scoreDisplay = document.getElementById('score-display');
    el.coopHud = document.getElementById('coop-hud');
    el.coopFinal = document.getElementById('coop-final');
    el.coopP1Score = document.getElementById('coop-p1-score');
    el.coopP2Score = document.getElementById('coop-p2-score');
    el.coopP1Distance = document.getElementById('coop-p1-distance');
    el.coopP2Distance = document.getElementById('coop-p2-distance');
    el.coopTeamScore = document.getElementById('coop-team-score');
    el.coopFinalRegions = document.getElementById('coop-final-regions');
    for (const seat of [0, 1]) {
        el.seatVignettes[seat] = bySeat('.danger-vignette', seat);
        el.seatKills[seat] = bySeat('.kill-indicator', seat);
        el.seatCombos[seat] = bySeat('.combo-chip', seat);
        el.seatWaits[seat] = bySeat('.waiting-chip', seat);
        const hud = bySeat('.player-hud', seat);
        el.hudScores[seat] = hud ? hud.querySelector('.hud-score') : null;
        el.hudDistances[seat] = hud ? hud.querySelector('.hud-distance') : null;
        el.hudCollects[seat] = hud ? hud.querySelector('.hud-collect-time') : null;
        el.hudCollectDisplays[seat] = hud ? hud.querySelector('.hud-collect-display') : null;
    }
    initMuteToggle();
    initDailyToggle();
}

// True while the live layout is the two-half coop screen.
function coopMode() {
    return state.players.length >= 2;
}

// --- Dual-mode HUD flip (plan 026) ---
// Solo shows the classic id elements exactly as always; 2P swaps in the
// per-seat sets. Called by setPlayerCount (game.js) on every roster change.
export function updateHudMode() {
    const coop = coopMode();
    // The overlay picker's selected state tracks the live roster.
    if (el.onePlayerButton) el.onePlayerButton.classList.toggle('mode-selected', !coop);
    if (el.twoPlayerButton) el.twoPlayerButton.classList.toggle('mode-selected', coop);
    if (el.scoreDisplay) el.scoreDisplay.style.display = coop ? 'none' : '';
    if (el.collectTimerDisplay) el.collectTimerDisplay.style.display = coop ? 'none' : '';
    if (el.distanceDisplay) el.distanceDisplay.style.display = coop ? 'none' : (state.worldMode === 'endless' ? '' : 'none');
    if (el.coopHud) el.coopHud.style.display = coop ? 'flex' : 'none';
    if (el.dangerVignette) el.dangerVignette.style.opacity = '0';
    for (const seat of [0, 1]) {
        if (el.seatVignettes[seat]) {
            el.seatVignettes[seat].style.display = coop ? 'block' : 'none';
            el.seatVignettes[seat].style.opacity = '0';
        }
        // KILL!/combo/waiting are frame/event-driven — a mode flip parks them.
        if (el.seatKills[seat]) el.seatKills[seat].style.display = 'none';
        if (el.seatCombos[seat]) el.seatCombos[seat].style.display = 'none';
        if (el.seatWaits[seat]) el.seatWaits[seat].style.display = 'none';
    }
    if (el.killIndicator && coop) el.killIndicator.style.display = 'none';
    if (el.comboChip && coop) el.comboChip.style.display = 'none';
}

// --- TODAY'S WORLD toggle + seed line (plan 025) ---
// The seed resolves ONCE at module load (constants.js WORLD_SEED), so the
// toggle persists the flag and NAVIGATES to re-resolve — a world cannot be
// reseeded under a live run. The rebuilt URL drops ?seed/?daily so the
// sessionStorage flag alone decides; every other param (move, paddebug)
// survives. The seed line makes determinism visible: same number = same
// world, today's number = the map the whole family is racing.
function initDailyToggle() {
    if (el.seedValue) {
        el.seedValue.textContent = `${WORLD_SEED}${DAILY_WORLD ? ' · DAILY' : ''}`;
    }
    if (!el.dailyToggle) return;
    el.dailyToggle.classList.toggle('mode-selected', DAILY_WORLD);
    // The start overlay itself starts the run on ANY pointerdown — the
    // toggle must not (same reason the START button needs no guard: its
    // action IS starting). Stop the press here, act on the click.
    el.dailyToggle.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.dailyToggle.addEventListener('click', () => {
        const turningOn = !DAILY_WORLD;
        try { sessionStorage.setItem('blocky.daily', turningOn ? '1' : '0'); }
        catch { /* blocked storage — the reload below just keeps the default world */ }
        // Mutual exclusion with 2P: coop only writes TEAM RUNS, so daily×2P
        // would never place on TODAY'S BEST. Turning daily on forces solo.
        if (turningOn) {
            try { sessionStorage.setItem('blocky.playerCount', '1'); }
            catch { /* blocked storage */ }
        }
        const url = new URL(location.href);
        url.searchParams.delete('seed');
        url.searchParams.delete('daily');
        location.href = url.toString();
    });
}

// --- GO! flourish (spectacle pass) ---
// One big center-screen "GO!" flash when a run begins: a single 0.6s
// scale+fade play (simple fade under reduced motion, via CSS) — one flash,
// nowhere near the 3/sec photosensitivity limit. The element idles at
// opacity 0, so no display bookkeeping is needed; the remove/reflow/add
// dance restarts the animation on rapid restarts.
export function showGoFlourish() {
    if (!el.goFlourish) return;
    el.goFlourish.classList.remove('go-play');
    void el.goFlourish.offsetWidth; // Forces a reflow so the animation restarts
    el.goFlourish.classList.add('go-play');
}

// --- Per-mode HUD visibility (audit D-4) ---
// The mode-picker UI is retired (classic is a test/debug path via
// forceWorldMode only); what survives is the LIVE per-mode HUD state: the
// jump hint and the distance readout exist only in the endless world.
// Controls-hint text is single-sourced in index.html (#controls-hint) —
// the old per-mode textContent overwrite is gone (plan 021); classic is a
// test-only path and keeps the endless wording.
export function updateModeHud() {
    const endless = state.worldMode === 'endless';
    if (el.endlessHint) el.endlessHint.style.display = endless ? '' : 'none';
    if (el.distanceDisplay) {
        // The solo distance row also yields to the per-seat columns in 2P.
        el.distanceDisplay.style.display = endless && !coopMode() ? '' : 'none';
    }
}

// --- On-screen JUMP button (endless + touch only) ---
// Visible exactly while an endless run is live on a coarse-pointer device —
// the touch counterpart of Space, following the continuous BOOST button
// pattern (game.js wires its pointerdown to tryJump). Hidden everywhere
// else so classic and desktop layouts are untouched.
export function updateJumpButton() {
    if (!el.jumpButton) return;
    const show = state.isMobile && state.worldMode === 'endless' &&
        state.gameActive && !state.onStartScreen;
    const display = show ? 'block' : 'none';
    if (el.jumpButton.style.display !== display) el.jumpButton.style.display = display;
}

// --- Mute Toggle (plan 010) ---
// Persisted by src/audio.js (the storage owner); the label reflects the
// saved state from boot. The click is a sanctioned unlock gesture, so
// unmuting works even before the first run starts.
function updateMuteButtonLabel() {
    if (!el.muteButton) return;
    el.muteButton.textContent = isMuted() ? '\u{1F507}' : '\u{1F50A}';
    el.muteButton.setAttribute('aria-pressed', String(isMuted()));
}

// Shared by the mute button and the gamepad Select/Back bind (input.js).
export function toggleMuteFromUI() {
    unlockAudio();
    setMuted(!isMuted()); // muting also stops the music (audio.js)
    updateMuteButtonLabel();
    if (!isMuted()) {
        sfx.click();
        // Unmuting mid-run brings the music back immediately — but only
        // while the run is actually live: music follows the pause state
        // (togglePause), so unmuting while paused must stay silent.
        if (state.gameActive && !state.isPaused && !state.onStartScreen) music.start();
    }
}

function initMuteToggle() {
    updateMuteButtonLabel();
    if (!el.muteButton) return;
    el.muteButton.addEventListener('click', () => {
        toggleMuteFromUI();
    });
}

// FAMILY BEST on the start overlay (plan 023): the endless board's top
// distance — the number the household actually chases — greets every boot
// and every post-death menu. Hidden when the board is empty (fresh browser
// or unavailable storage; loadHiscores already degrades to []).
function updateFamilyBest() {
    if (!el.familyBest) return;
    const best = loadHiscores('endless')[0];
    if (best) {
        el.familyBestDistance.textContent = best.distance ?? 0;
        el.familyBest.style.display = '';
    } else {
        el.familyBest.style.display = 'none';
    }
}

// --- Start Overlay Functions (plan 008) ---
// The overlay owns the boot (and post-death) UX: while it is visible the
// game sits paused underneath and any key / click / tap starts the run.
export function showStartOverlay() {
    el.startOverlay.style.display = 'flex';
    state.onStartScreen = true;
    updateJumpButton(); // The menu never shows the touch JUMP control
    updateFamilyBest();
    // Title warmth (plan 023): a QUIET music bed under the menu — but only
    // when a real gesture already unlocked the context (the gate submit
    // counts; index.html rides unlockAudio on it). A bypassed gate or a
    // rejected autoplay leaves ctx absent/suspended: skip SILENTLY, no
    // retry — startRun's own gesture brings music up at full volume anyway.
    // music.start() self-guards mute; a post-death overlay reuses this path.
    if (audioState().state === 'running') {
        music.setVolume(0.5); // HALF gain — a bed, not a performance
        music.start();
    }
}

export function hideStartOverlay() {
    el.startOverlay.style.display = 'none';
    state.onStartScreen = false;
    updateJumpButton(); // A live endless run on touch gets its JUMP control
}

// --- Distance HUD (endless) ---
// "Distance: <n>" beside the score — the run's furthest true distance from
// the start, integer, written only when it changes. Hidden in classic.
let lastDistanceShown = -1;

export function updateDistanceDisplay() {
    if (!el.distance) return;
    const shown = Math.floor(state.furthestDistance);
    if (shown === lastDistanceShown) return;
    lastDistanceShown = shown;
    el.distance.textContent = shown;
}

// New game: zero the readout and show/hide the element per the mode.
export function resetDistanceDisplay() {
    lastDistanceShown = -1;
    updateDistanceDisplay(); // furthestDistance was just reset — writes "0"
    if (el.distanceDisplay) {
        // Solo row only — 2P shows the per-seat columns instead (plan 026).
        el.distanceDisplay.style.display = state.worldMode === 'endless' && !coopMode() ? '' : 'none';
    }
}

// --- Survival time HUD (plan 023 DT-10) ---
// "Time: m:ss" beside DISTANCE — time survived, the run's other currency,
// finally visible. Driven from state.runTime (the game clock — pause and
// death freeze it) with whole-second change detection, so the hot loop
// writes the DOM at most once per second. Every full minute earns a beat:
// the distance-milestone pattern (chime + popup over the player's head).
let lastTimeShown = -1; // Whole seconds last written to the DOM

export function updateTimeDisplay() {
    if (!el.time) return;
    const sec = Math.floor(state.runTime);
    if (sec === lastTimeShown) return;
    const prev = lastTimeShown;
    lastTimeShown = sec;
    const minutes = Math.floor(sec / 60);
    el.time.textContent = `${minutes}:${String(sec % 60).padStart(2, '0')}`;
    // Minute milestone: fires when the shown time crosses a whole-minute
    // boundary mid-run. prev >= 0 guards the reset's -1 -> 0 write, and the
    // gameActive/player guard keeps a post-death HUD refresh silent.
    // Run time is SHARED (plan 026): the beat rises over every living hero
    // (one popup each — solo is exactly one), with a single chime.
    if (minutes >= 1 && prev >= 0 && minutes > Math.floor(prev / 60) &&
        state.gameActive) {
        let celebrated = false;
        for (const player of state.players) {
            if (!player.alive || !player.mesh) continue;
            const p = player.mesh.position;
            survivalBeatOrigin.x = p.x;
            survivalBeatOrigin.y = p.y + player.scale + 0.6;
            survivalBeatOrigin.z = p.z;
            spawnTextPopup(survivalBeatOrigin, `${minutes} MINUTE${minutes > 1 ? 'S' : ''}!`, '#8BC34A', player);
            celebrated = true;
        }
        if (celebrated) sfx.milestone();
    }
}

// New game: rewind the change detector and write the fresh 0:00.
export function resetTimeDisplay() {
    lastTimeShown = -1;
    updateTimeDisplay(); // runTime was just reset — writes "0:00", no beat (prev guard)
}

// --- Death Screen Functions ---
// Fills the structured death screen (title is static "GAME OVER" markup);
// #hiscore-slot hosts the local top-5 leaderboard (plan 009). A rank-0
// NEW BEST earns confetti bursts behind the box + a victory fanfare.
// Endless deaths also show how far the run pushed.
export function showDeathScreen(reason, hiscores = [], rank = -1, boardTitle = 'BEST RUNS', ascended = false) {
    // Title per show (plan 029): the INVARIANT is that death shows always
    // restore exactly 'GAME OVER' (five specs pin the exact text) — an
    // ascension end that came before must never leak its title forward.
    if (el.deathTitle) el.deathTitle.textContent = ascended ? 'ASCENDED!' : 'GAME OVER';
    el.deathReason.textContent = reason;
    const coop = coopMode();
    // 2P: the two columns + team line replace the solo score/distance lines.
    if (el.finalScore.parentElement) {
        el.finalScore.parentElement.style.display = coop ? 'none' : '';
    }
    if (el.coopFinal) el.coopFinal.style.display = coop ? '' : 'none';
    if (coop) {
        const [p1, p2] = state.players;
        el.coopP1Score.textContent = p1.score;
        el.coopP2Score.textContent = p2.score;
        el.coopP1Distance.textContent = Math.floor(p1.distanceBest);
        el.coopP2Distance.textContent = Math.floor(p2.distanceBest);
        el.coopTeamScore.textContent = p1.score + p2.score;
        if (el.coopFinalRegions) el.coopFinalRegions.textContent = state.regionsVisited.size || 1;
    }
    el.finalScore.textContent = state.score;
    if (el.finalDistanceLine) {
        if (!coop && state.worldMode === 'endless') {
            el.finalDistance.textContent = Math.floor(state.furthestDistance);
            // REGIONS visited (plan 025): the run's exploration stat beside
            // its distance — counts from 1 (the spawn region).
            if (el.finalRegions) el.finalRegions.textContent = state.regionsVisited.size || 1;
            el.finalDistanceLine.style.display = '';
        } else {
            el.finalDistanceLine.style.display = 'none';
        }
    }
    renderHiscores(hiscores, rank, boardTitle);
    el.messageBox.style.display = 'block'; // Make the death screen visible
    if (rank === 0) {
        onNewBest(); // Staggered palette bursts, visible around the box
        sfx.fanfare();
    }
}

// Renders the BEST RUNS list into #hiscore-slot. The new run's row (by
// rank) is highlighted; rank 0 also earns the NEW BEST! badge. An empty
// list (storage unavailable AND the run failed to record) leaves the slot
// empty, which hides it.
function renderHiscores(list, rank, boardTitle = 'BEST RUNS') {
    el.hiscoreSlot.innerHTML = '';
    if (list.length === 0) return;
    if (rank === 0) {
        const badge = document.createElement('p');
        badge.className = 'hiscore-badge';
        badge.textContent = 'NEW BEST!';
        el.hiscoreSlot.appendChild(badge);
    }
    const title = document.createElement('p');
    title.className = 'hiscore-title';
    title.textContent = boardTitle; // "TODAY'S BEST" on a daily-world death (plan 025)
    el.hiscoreSlot.appendChild(title);
    const ol = document.createElement('ol');
    ol.className = 'hiscore-list';
    list.forEach((entry, i) => {
        const li = document.createElement('li');
        // Ascended runs wear a permanent mark (plan 029) — ranking untouched.
        const mark = (entry.asc || entry.ascCount > 0) ? '✦ ' : '';
        // Coop rows lead with the TEAM total (their ranking key — plan 026);
        // endless rows lead with DISTANCE — the mode's real currency and now
        // its ranking key (hiscores.js) — with the score alongside; classic
        // rows are untouched (score-ranked, score-first).
        li.textContent = mark + (entry.teamScore !== undefined
            ? `${entry.teamScore} pts — ${entry.maxDistance}u — ${entry.date}`
            : entry.distance !== undefined
                ? `${entry.distance}u — ${entry.score} pts — ${entry.date}`
                : `${entry.score} — ${entry.date}`);
        if (i === rank) li.classList.add('is-new');
        ol.appendChild(li);
    });
    el.hiscoreSlot.appendChild(ol);
}

// --- Combo chip (score-juice pass) ---
// A small yellow "COMBO xN" chip under the kill indicator. Visible only at
// x2 and up (x1 is just "a kill"); pops on every increment via the same
// remove/reflow/add dance as the score pop. enemies.js shows it on chained
// kills; timers.js hides it when the window expires; death and new games
// reset it here.
export function showComboChip(count, player = state.players[0]) {
    // 2P: the chip pops under the KILLER's own half (plan 026).
    const chip = coopMode() ? el.seatCombos[player.seat] : el.comboChip;
    if (!chip) return;
    chip.textContent = `COMBO x${count}`;
    chip.style.display = 'block';
    chip.classList.remove('combo-pop');
    void chip.offsetWidth; // Forces a reflow so the animation restarts
    chip.classList.add('combo-pop');
}

export function hideComboChip(player = null) {
    // No player: every chip (death/reset). A player: just their seat's.
    const chips = player && coopMode()
        ? [el.seatCombos[player.seat]]
        : [el.comboChip, el.seatCombos[0], el.seatCombos[1]];
    for (const chip of chips) {
        if (chip && chip.style.display !== 'none') chip.style.display = 'none';
    }
}

// Zeroes the combo state and hides the chip — the single combo reset path
// (death via endGame, and every setupNewGame so a mid-run restart can't
// smuggle a live combo into the next run). All players (plan 026).
export function resetCombo() {
    for (const p of state.players) {
        p.comboCount = 0;
        p.comboTimeLeft = 0;
    }
    hideComboChip();
}

// Ends the current run. This is the ONLY legal way to end a game — every
// death cause (enemy collision, collect-clock expiry, future hazards) must
// call it. Idempotent: safe against double triggers within one frame.
//
// Cinematic beat (spectacle pass): the player squashes flat and bursts
// (effects.js — the world is already frozen by the gameActive gate, but
// updateEffects keeps running), and the death screen arrives only after
// DEATH_SCREEN_DELAY. setTimeout is legal here — UI sequencing, not
// simulation. A restart during the delay is guarded twice: hideMessage()
// (via setupNewGame) clears the timer, and the callback re-checks that the
// game is still sitting on THIS dead run before showing anything.
let deathScreenTimer = null;

// Kills ONE player (plan 026). The single per-player death entry: the
// collect clock (timers.js) and enemy contact (enemies.js) both land here.
// While a partner still lives the run continues — this hero squashes and
// becomes a spectator (Stage E adds the partner-cam + WAITING chip); the
// LAST death forwards to endGame, which is byte-for-byte the solo path.
export function killPlayer(player, reason) {
    if (!state.gameActive || !player.alive) return;
    let othersLiving = 0;
    for (const q of state.players) {
        if (q !== player && q.alive) othersLiving++;
    }
    if (othersLiving === 0) {
        endGame(reason, player);
        return;
    }
    player.alive = false;
    onPlayerDeath(player); // Squash flat + burst for THIS hero only
    sfx.death();
    rumble(180, 0.7, player.seat); // The fallen hero's own pad takes the hit
    // Enemy pace tracks max LIVING mult — drop a dead seat's 5x immediately
    // so the survivor is not stuck fighting a pack tuned to the fallen hero.
    applySpeedMultiplier();
    // Spectator mode (plan 026): their half switches to the partner cam
    // (world.js renderFrame) under the WAITING chip; resetIndicators (via
    // endGame/setupNewGame) retires the chip with the run. The text is
    // written on EVERY show (single-writer-per-show rule, plan 029): a
    // death after a prior ascension must restore the default label.
    if (el.seatWaits[player.seat]) {
        el.seatWaits[player.seat].textContent = player.seat === 0 ? 'WAITING FOR P2' : 'WAITING FOR P1';
        el.seatWaits[player.seat].style.display = 'block';
    }
    // Their half's transient overlays go dark — nothing to fight the chip.
    if (el.seatKills[player.seat]) el.seatKills[player.seat].style.display = 'none';
    // Death breaks THEIR chain (B8 review ADV-7): zero the state with the
    // chip, or the frozen window sits live until tickComboClock drains it.
    player.comboCount = 0;
    player.comboTimeLeft = 0;
    hideComboChip(player);
    if (el.seatVignettes[player.seat]) {
        el.seatVignettes[player.seat].__lastCss = null;
        el.seatVignettes[player.seat].style.opacity = '0';
    }
}

export function endGame(reason, dyingPlayer = state.players[0], { ascended = false } = {}) {
    if (!state.gameActive) return;
    state.gameActive = false;
    dyingPlayer.alive = false; // The final death — every seat is down now
    resetCombo(); // Death breaks the chain (and clears the chip behind the box)
    resetTension(); // Panic pulse and danger vignette must not haunt the death screen
    resetIndicators(); // Nor stale enemy arrows / a frozen KILL! flash
    updateJumpButton(); // The dead can't hop — hide the touch JUMP control
    music.stop(); // 0.3s fadeout — the death jingle plays over it
    if (!ascended) {
        // An ascended end already left in light (plan 029): no death sting,
        // no death rumble, no squash — the hero is gone, gloriously.
        sfx.death();
        rumble(180, 0.7, dyingPlayer.seat); // Stronger death pulse when the pad can rumble
        onPlayerDeath(dyingPlayer); // Squash flat + orange-red burst (pool), behind the beat
    }
    // Per-mode boards: the death screen shows the ladder of the mode that
    // just ended, and endless runs never pollute the classic top-5. A 2P
    // run records ONLY the coop team board (plan 026) — never the solo
    // endless/daily ladders (different game, different ladder). Ascension
    // (plan 029): rows carry the mark; a team run containing an ascension
    // is a crowned run (title shows ASCENDED! either way).
    const ascendedSeatCount = state.players.filter((p) => p.ascended).length;
    const crowned = ascended || ascendedSeatCount > 0;
    let list;
    let rank;
    let boardTitle;
    if (coopMode()) {
        ({ list, rank } = recordCoopScore(
            state.players[0].score, state.players[1].score, state.furthestDistance,
            ascendedSeatCount));
        boardTitle = 'TEAM RUNS';
    } else {
        ({ list, rank } = recordScore(state.score, state.worldMode, state.furthestDistance, crowned));
        boardTitle = 'BEST RUNS';
        if (DAILY_WORLD && state.worldMode === 'endless') {
            // A daily run IS an endless run — the solo board above already
            // recorded it. It ALSO ranks on today's world's own ladder, and
            // THAT is the board the death screen shows (the family race).
            ({ list, rank } = recordScore(state.score, 'daily', state.furthestDistance, crowned));
            boardTitle = "TODAY'S BEST";
        }
    }
    deathScreenTimer = setTimeout(() => {
        deathScreenTimer = null;
        if (state.gameActive || state.onStartScreen) return; // A restart beat us to it
        showDeathScreen(reason, list, rank, boardTitle, crowned);
    }, DEATH_SCREEN_DELAY * 1000);
}

// Settles an ASCENDED hero while a partner still fights (plan 029): the
// spectator bookkeeping of killPlayer WITHOUT the death juice — no squash,
// no death sting, no rumble; the ceremony already provided the exit. The
// last active hero's ascension routes through endGame instead (game.js
// finishAscension owns that fork).
export function settleAscendedPlayer(player) {
    if (!state.gameActive || !player.alive) return;
    player.alive = false;
    // Enemy pace tracks max LIVING mult — drop the ascended seat's toy
    // immediately, same rule as a death.
    applySpeedMultiplier();
    if (el.seatWaits[player.seat]) {
        el.seatWaits[player.seat].textContent = player.seat === 0 ? 'ASCENDED — WATCHING P2' : 'ASCENDED — WATCHING P1';
        el.seatWaits[player.seat].style.display = 'block';
    }
    if (el.seatKills[player.seat]) el.seatKills[player.seat].style.display = 'none';
    player.comboCount = 0;
    player.comboTimeLeft = 0;
    hideComboChip(player);
    if (el.seatVignettes[player.seat]) {
        el.seatVignettes[player.seat].__lastCss = null;
        el.seatVignettes[player.seat].style.opacity = '0';
    }
}

// --- Tension systems (awesome pass) ---
// The panic-timer CSS class and the danger vignette + heartbeat. All
// transient, all zeroed together by resetTension (endGame + setupNewGame).

let timerPanicOn = false;
let dangerBreathClock = 0; // Wall-independent breath phase (advances with game dt)
let dangerReducedMotion = false; // Resolved once in initUI
let lastVignetteCss = null; // Skip same-value style writes in the hot loop

// Toggles the 1Hz red pulse on the collect-timer display. Guarded so the
// per-frame call from tickCollectClock touches classList only on changes.
export function setTimerPanic(on) {
    if (on === timerPanicOn || !el.collectTimerDisplay) return;
    timerPanicOn = on;
    el.collectTimerDisplay.classList.toggle('timer-panic', on);
}

// --- Survival beats (plan 023 DT-10) ---
// PHEW! (a real scare fully drained away) and CLOSE ONE! (a hunter got
// within a whisker of contact and the player slipped out) — the survival
// axis finally celebrates. ONE shared rate limit on the GAME clock: two
// simultaneous triggers (an escape that was also a near miss) fire once,
// and neither can ever spam. Popup + sfx only — zero gameplay effect.
const survivalBeatOrigin = { x: 0, y: 0, z: 0 }; // Scratch — never allocated per beat

// Per player since plan 026: each hero has their own beat cooldown and the
// popup rises over THEIR head — a P2 escape celebrates P2.
function fireSurvivalBeat(player, text, fillStyle, sound) {
    if (state.runTime - player.lastSurvivalBeat < SURVIVAL_BEAT_COOLDOWN) return;
    player.lastSurvivalBeat = state.runTime;
    const p = player.mesh.position;
    survivalBeatOrigin.x = p.x;
    survivalBeatOrigin.y = p.y + player.scale + 0.6; // Above the head (distance-milestone pattern)
    survivalBeatOrigin.z = p.z;
    spawnTextPopup(survivalBeatOrigin, text, fillStyle, player);
    sound();
}

// Danger pulse + heartbeat, called each update frame from game.js BEFORE
// updateEnemies — so a death inside the enemy pass can zero the vignette
// without this frame re-raising it afterwards. The vignette eases toward
// DANGER_VIGNETTE_MAX while the nearest NON-killable enemy is within
// DANGER_RADIUS (torus-aware), with a slow 0.4Hz breath on top (static
// under reduced motion). The heartbeat thumps at HEARTBEAT_BPM only while
// danger persists AND hunt mode is off — the hunt layer already owns the
// music intensity; the heartbeat owns the dread.
export function updateDangerPulse(dt) {
    if (!state.gameActive || !state.players[0].mesh) return;
    let maxIntensity = 0; // Music layer request = MAX of the players' states (plan 026)
    let anyHeartbeatDanger = false; // Heartbeat fires if EITHER hero is in prey-less dread
    for (const player of state.players) {
        // An ascending hero (plan 029) has left the dread channel: no
        // vignette, no heartbeat, no near-miss beats during the ceremony.
        if (!player.alive || !player.mesh || player.ascension) continue;
        let nearest = Infinity;
        let anyKillable = false;
        for (const enemyGroup of state.enemies) {
            const ud = enemyGroup.userData;
            // Near-miss arming is per (enemy, seat) since plan 026 — the
            // same hunter can be a whisker from P2 while ignoring P1.
            if (ud.nearMissArmed === undefined || typeof ud.nearMissArmed === 'boolean') {
                ud.nearMissArmed = [false, false];
            }
            if (canKillSpecificEnemy(enemyGroup, player)) {
                anyKillable = true;
                // Disarm any stale near-miss: an armed hunter the player has
                // since outgrown must not fire CLOSE ONE! if it ever un-flips
                // (B5+B6 review ADV-5 — latent trap if rescaling ever lands).
                ud.nearMissArmed[player.seat] = false;
                continue; // Killable enemies flee — they are prey, not danger
            }
            if (ud.species.harmless) {
                // Harmless species are NEVER a threat, even when too big for
                // this viewer to eat (2P divergent scales): no vignette, no
                // heartbeat, no CLOSE ONE! from a critter that cannot hurt
                // you (terminal review B-1).
                ud.nearMissArmed[player.seat] = false;
                continue;
            }
            const d = torusDistance(enemyGroup.position, player.mesh.position);
            if (d < nearest) nearest = d;
            // CLOSE ONE! near-miss (plan 023): arm when a hunter enters the
            // whisker band around actual contact, fire when it exits with the
            // player still alive (a death never reaches here — gameActive gate
            // above). Materializing spawns can't collide, so they never arm.
            if (ud.materializing === undefined) {
                const armRadius = NEAR_MISS_FACTOR * (
                    player.scale * PLAYER_COLLIDER_HALF_WIDTH +
                    enemyGroup.scale.y * ENEMY_COLLIDER_HALF_WIDTH
                );
                if (d < armRadius) {
                    ud.nearMissArmed[player.seat] = true;
                } else if (ud.nearMissArmed[player.seat]) {
                    ud.nearMissArmed[player.seat] = false;
                    fireSurvivalBeat(player, 'CLOSE ONE!', '#FFC107', sfx.tick); // Amber — warning that ended well
                }
            } else {
                ud.nearMissArmed[player.seat] = false;
            }
        }
        const inDanger = nearest < DANGER_RADIUS;

        const target = inDanger ? DANGER_VIGNETTE_MAX : 0;
        player.dangerOpacity += (target - player.dangerOpacity) * (1 - Math.exp(-5 * dt));
        if (!inDanger && player.dangerOpacity < 0.003) player.dangerOpacity = 0; // Settle instead of asymptote

        // PHEW! escape beat (plan 023): the dread system gets a positive
        // resolution — when a REAL scare (peak above PHEW_PEAK_MIN) has fully
        // drained away, celebrate the escape once, then re-arm. The peak always
        // resets at the zero crossing, so one scare can never span two beats.
        if (player.dangerOpacity > player.dangerPeak) player.dangerPeak = player.dangerOpacity;
        if (player.dangerOpacity <= 0.01) {
            if (player.dangerPeak > PHEW_PEAK_MIN) {
                fireSurvivalBeat(player, 'PHEW!', '#8BC34A', sfx.phew); // Soft green — survival's own color
            }
            player.dangerPeak = 0;
        }

        // This player's music request: hunt (prey exists for THEM) keeps
        // priority at 1; danger (2) only when dread owns their channel.
        const intensity = anyKillable ? 1 : (player.dangerOpacity > DANGER_MUSIC_THRESHOLD ? 2 : 0);
        if (intensity > maxIntensity) maxIntensity = intensity;
        if (inDanger && !anyKillable) anyHeartbeatDanger = true;
    }

    // Vignette element(s): solo drives the classic full-frame overlay from
    // seat 0; 2P drives each half's own vignette from ITS player. One
    // shared breath clock — the halves breathe in phase, deliberately.
    const anyShown = coopMode()
        ? Math.max(state.players[0].dangerOpacity, state.players[1].dangerOpacity)
        : state.players[0].dangerOpacity;
    let breath = 1;
    if (!dangerReducedMotion && anyShown > 0) {
        dangerBreathClock += dt;
        // 0.4Hz breath riding the eased base; peak stays DANGER_VIGNETTE_MAX
        breath = 0.8 + 0.2 * Math.sin(dangerBreathClock * Math.PI * 0.8);
    }
    if (coopMode()) {
        for (const player of state.players) {
            const vignette = el.seatVignettes[player.seat];
            if (!vignette) continue;
            const seatCss = (player.alive ? player.dangerOpacity * breath : 0).toFixed(3);
            if (vignette.__lastCss !== seatCss) {
                vignette.__lastCss = seatCss;
                vignette.style.opacity = seatCss;
            }
        }
    } else {
        const css = (state.players[0].dangerOpacity * breath).toFixed(3);
        if (el.dangerVignette && css !== lastVignetteCss) {
            lastVignetteCss = css;
            el.dangerVignette.style.opacity = css;
        }
    }

    // Music layer (plan 023 CAP-5) — the ONE setIntensity driver; in 2P the
    // request is the MAX of the players' states (plan 026). Bar-line commits
    // in audio.js keep every switch musical, so this per-frame write is safe.
    music.setIntensity(maxIntensity);

    // Heartbeat: ONE audible heart (seat 0's clock is THE clock), thumping
    // while ANY living hero is in prey-less danger (plan 026 Stage E rule).
    if (anyHeartbeatDanger) {
        state.heartbeatClock -= dt;
        if (state.heartbeatClock <= 0) {
            sfx.heartbeat();
            state.heartbeatClock += 60 / HEARTBEAT_BPM;
        }
    } else {
        state.heartbeatClock = 0; // Re-entering danger thumps immediately
    }
}

// Zeroes every tension transient — the single reset path, called by endGame
// and by setupNewGame so neither the death screen nor a fresh run inherits
// a pulsing timer or a lingering red frame.
export function resetTension() {
    setTimerPanic(false);
    for (const p of state.players) {
        p.dangerOpacity = 0;
        p.dangerPeak = 0; // A scare must not leak a PHEW! across death / new game
        p.lastSurvivalBeat = -SURVIVAL_BEAT_COOLDOWN; // Fresh run: first beat is free
        p.heartbeatClock = 0;
    }
    dangerBreathClock = 0;
    lastVignetteCss = null;
    if (el.dangerVignette) el.dangerVignette.style.opacity = '0';
    for (const vignette of el.seatVignettes) {
        if (vignette) {
            vignette.__lastCss = null;
            vignette.style.opacity = '0';
        }
    }
}

// Hides every enemy indicator — the off-screen arrow pool and the KILL!
// flash — and rewinds the flash clock so the next appearance starts fully
// visible. The per-frame updaters only run while the game is live, so
// without this reset the last frame's indicators would freeze in place and
// haunt the death screen / start overlay, pointing at enemies that no
// longer exist. Same single-reset-path pattern as resetTension: called by
// endGame and by setupNewGame.
export function resetIndicators() {
    for (const indicator of state.enemyIndicators) {
        if (indicator.style.display !== 'none') indicator.style.display = 'none';
        indicator.__lastDisplay = 'none'; // Keep the hot-loop write cache honest
    }
    for (const p of state.players) {
        p.killFlashClock = 0;
        p.killIndicatorVisible = true;
    }
    if (el.killIndicator && el.killIndicator.style.display !== 'none') {
        el.killIndicator.style.display = 'none';
    }
    for (const seat of [0, 1]) {
        if (el.seatKills[seat] && el.seatKills[seat].style.display !== 'none') {
            el.seatKills[seat].style.display = 'none';
        }
        // The spectator chips die with the run too (endGame + setupNewGame
        // both land here — the single reset path).
        if (el.seatWaits[seat] && el.seatWaits[seat].style.display !== 'none') {
            el.seatWaits[seat].style.display = 'none';
        }
    }
}

// Hides the message box — and cancels a death screen still waiting out the
// cinematic beat, so a fast restart can never have it pop over the overlay.
export function hideMessage() {
    if (deathScreenTimer !== null) {
        clearTimeout(deathScreenTimer);
        deathScreenTimer = null;
    }
    el.messageBox.style.display = 'none'; // Make the message box invisible
}

// Score / timer DOM writes. Score INCREASES get a pop animation (plan 015);
// resets to 0 on a new game don't. The remove/reflow/add dance retriggers
// the CSS animation on rapid scoring; reduced-motion users get no pop (CSS).
export function updateScoreDisplay() {
    const prev = Number(el.score.textContent);
    el.score.textContent = state.score;
    if (state.score > prev) {
        el.score.classList.remove('score-pop');
        void el.score.offsetWidth; // Forces a reflow so the animation restarts
        el.score.classList.add('score-pop');
    }
    // 2P: each seat's own score column (same pop juice, per column).
    if (coopMode()) {
        for (const player of state.players) {
            const slot = el.hudScores[player.seat];
            if (!slot) continue;
            const shown = Number(slot.textContent);
            if (shown === player.score) continue;
            slot.textContent = player.score;
            if (player.score > shown) {
                slot.classList.remove('score-pop');
                void slot.offsetWidth;
                slot.classList.add('score-pop');
            }
        }
    }
}

// Per-seat DISTANCE readout (2P): each hero's own furthest, written on
// change from updateEndlessProgress. Solo never calls this.
export function updateSeatDistanceDisplay(player) {
    const slot = el.hudDistances[player.seat];
    if (!slot) return;
    const shown = Math.floor(player.distanceBest);
    if (slot.__lastShown === shown) return;
    slot.__lastShown = shown;
    slot.textContent = shown;
}

export function updateCollectTimeDisplay() {
    el.collectTime.textContent = Math.max(0, Math.ceil(state.collectTimeLeft));
}

// Creates the pool of off-screen enemy indicator elements.
export function createEnemyIndicators() {
    state.offscreenIndicatorContainer = document.getElementById('offscreen-indicator-container');
    if (state.offscreenIndicatorContainer) {
        for (let i = 0; i < MAX_ENEMY_INDICATORS; i++) {
            const indicator = document.createElement('div');
            indicator.className = 'enemy-indicator';
            // Base arrow points up (due to clip-path), will be rotated.
            state.offscreenIndicatorContainer.appendChild(indicator);
            state.enemyIndicators.push(indicator);
        }
    }
}

// Per-frame kill indicator update (flashes when any enemy is killable).
// dt is in seconds; the 0.5s accumulator gives a 1 flash/sec pulse — well
// under the 3/sec photosensitivity limit (WCAG 2.3.1) and, with the CSS
// opacity transition removed, an actually visible discrete flash.
export function updateKillIndicator(dt) {
    // (Music intensity moved to updateDangerPulse — plan 023: it needs the
    // danger scalar too, and one writer beats two fighting ones.)
    if (coopMode()) {
        // 2P: each half flashes for ITS viewer's edibility, on that
        // player's own flash clock (plan 026). 1Hz per element — the same
        // photosensitivity budget as solo, per half.
        for (const player of state.players) {
            const badge = el.seatKills[player.seat];
            if (!badge) continue;
            const anyForSeat = player.alive && !player.ascension &&
                state.enemies.some((enemy) => canKillSpecificEnemy(enemy, player));
            if (anyForSeat) {
                badge.style.display = 'block';
                player.killFlashClock += dt;
                if (player.killFlashClock > 0.5) {
                    player.killFlashClock = 0;
                    player.killIndicatorVisible = !player.killIndicatorVisible;
                }
                badge.style.opacity = player.killIndicatorVisible ? '1' : '0.35';
            } else if (badge.style.display !== 'none') {
                badge.style.display = 'none';
                player.killFlashClock = 0;
                player.killIndicatorVisible = true;
            }
        }
        return;
    }
    // Solo ceremony (plan 029): the KILL! flash stands down with the hunt.
    const anyEnemyKillable = !state.players[0].ascension &&
        state.enemies.some(enemy => canKillSpecificEnemy(enemy));
    if (!el.killIndicator) return;
    if (anyEnemyKillable) {
        el.killIndicator.style.display = 'block';
        state.killFlashClock += dt;
        if (state.killFlashClock > 0.5) {
            state.killFlashClock = 0;
            state.killIndicatorVisible = !state.killIndicatorVisible;
        }
        el.killIndicator.style.opacity = state.killIndicatorVisible ? '1' : '0.35';
    } else if (el.killIndicator.style.display !== 'none') {
        el.killIndicator.style.display = 'none';
        // Reset so the next appearance always starts fully visible
        state.killFlashClock = 0;
        state.killIndicatorVisible = true;
    }
}

// --- Off-Screen Enemy Indicator Logic (per-frame) ---
// View-space scratch for the behind-camera check (audit C-3) — reused per enemy.
const indicatorViewPos = new THREE.Vector3();
// Projection scratch (plan 020 P-5): copy into it, never clone, per enemy.
const indicatorWorldPos = new THREE.Vector3();

// Hot-loop hygiene (plan 020 P-5): positions ride ONE rounded translate3d
// transform (left/top are pinned to 0 in CSS — the old per-frame left/top
// writes forced layout), and every style write is skipped when unchanged
// (cached on the element). resetIndicators keeps the display cache honest.
//
// PER-VIEW passes (B8 review BLOCK-4): solo is ONE full-rect pass through
// seat 0's camera over the whole pool — arithmetically identical to the
// pre-2P code. 2P runs one pass per LIVING seat, each projecting through
// THAT seat's camera and clamping inside THAT seat's half of the canvas
// (the seam is an edge like any other), with the pool split half/half and
// colors judged by THAT viewer's edibility. A dead seat's half is the
// partner-cam spectator view — it carries no arrows of its own.
export function updateOffscreenIndicators() {
    if (coopMode()) {
        const poolHalf = Math.floor(MAX_ENEMY_INDICATORS / 2);
        // Same seam renderFrame draws (world.js): left half [0, halfW),
        // right half [halfW, width).
        const halfW = Math.floor(state.gameCanvasRect.width / 2);
        for (const player of state.players) {
            const poolStart = player.seat * poolHalf;
            if (player.alive && !player.ascension && player.camera) {
                const rectLeft = player.seat === 0 ? 0 : halfW;
                const rectWidth = player.seat === 0 ? halfW : state.gameCanvasRect.width - halfW;
                updateIndicatorsForView(player.camera, player, rectLeft, rectWidth,
                    poolStart, poolStart + poolHalf);
            } else {
                hideIndicatorRange(poolStart, poolStart + poolHalf);
            }
        }
        return;
    }
    if (state.players[0].ascension) {
        // Solo ceremony (plan 029): arrows point at threats — there are none.
        hideIndicatorRange(0, MAX_ENEMY_INDICATORS);
        return;
    }
    updateIndicatorsForView(state.camera, state.players[0], 0, state.gameCanvasRect.width,
        0, MAX_ENEMY_INDICATORS);
}

// One view's indicator pass: project every enemy through `camera`, place
// arrows for the off-view ones inside [rectLeft, rectLeft+rectWidth) of the
// canvas using pool slots [poolStart, poolEnd), colored by `viewer`'s own
// edibility. Solo passes the full rect and the whole pool.
function updateIndicatorsForView(camera, viewer, rectLeft, rectWidth, poolStart, poolEnd) {
    let indicatorsUsed = poolStart;
    const screenPadding = 15; // How far from the view edge indicators should sit (reduced slightly)

    for (const enemyGroup of state.enemies) {
        if (indicatorsUsed >= poolEnd) break;
        // Truthful arrows (audit C-3): project() divides by a NEGATIVE w for
        // points behind the camera plane, mirroring both axes — enemies ≳30u
        // "south" (+Z) of the player are routinely behind it, and their
        // arrows pointed exactly the wrong way. View space tells the truth
        // (z > -near means behind); for those, negate the mirrored
        // projection to recover the true screen direction and push it far
        // outside the frustum so the edge clamp below owns the placement.
        indicatorViewPos.copy(enemyGroup.position).applyMatrix4(camera.matrixWorldInverse);
        const behindCamera = indicatorViewPos.z > -camera.near;
        const screenPos = indicatorWorldPos.copy(enemyGroup.position).project(camera);
        if (behindCamera) {
            // Mirror-correct the projection (negative w flipped both axes)
            // and push it JUST past the NDC unit box along the true bearing:
            // scaling by 1.001/max(|x|,|y|) saturates only the dominant
            // axis, so the per-axis pixel clamp below lands on the TRUE
            // edge point. The old fixed radius-1000 push blew BOTH axes
            // past their clamps, corner-quantizing every non-axis-aligned
            // bearing by up to ~25-30° (B2+B3 review, H7).
            const major = Math.max(Math.abs(screenPos.x), Math.abs(screenPos.y)) || 1;
            const push = 1.001 / major;
            screenPos.x = -screenPos.x * push;
            screenPos.y = -screenPos.y * push;
        }

        const isOffScreenX = screenPos.x < -1 || screenPos.x > 1;
        const isOffScreenY = screenPos.y < -1 || screenPos.y > 1;

        if (isOffScreenX || isOffScreenY) {
            const viewerCanKill = canKillSpecificEnemy(enemyGroup, viewer);
            // A harmless critter this viewer can't eat is neither threat nor
            // food — no arrow at all; a blue "hunts you" arrow for a juja
            // would be a lie (terminal review B-1).
            if (enemyGroup.userData.species.harmless && !viewerCanKill) continue;
            const indicator = state.enemyIndicators[indicatorsUsed];

            // Color by killability FOR THIS VIEWER (yellow = killable by
            // them, blue = hunts them) — each half tells its own truth.
            const color = viewerCanKill
                ? 'rgba(255, 235, 59, 0.8)'
                : 'rgba(3, 169, 244, 0.8)';

            // Convert NDC to pixels within THIS view's rect of the canvas
            const x = (screenPos.x * rectWidth / 2) + rectWidth / 2 + rectLeft;
            const y = -(screenPos.y * state.gameCanvasRect.height / 2) + state.gameCanvasRect.height / 2;

            // Clamp to the view's edges (padding), in viewport coordinates
            // (#offscreen-indicator-container is viewport-sized).
            const clampedX = Math.max(rectLeft + screenPadding, Math.min(x, rectLeft + rectWidth - screenPadding)) + state.gameCanvasRect.left;
            const clampedY = Math.max(screenPadding, Math.min(y, state.gameCanvasRect.height - screenPadding)) + state.gameCanvasRect.top;

            // Angle from the VIEW center (the viewer's hero is centered in
            // their own half) to the clamped screen position
            const centerX = state.gameCanvasRect.left + rectLeft + rectWidth / 2;
            const angle = Math.atan2(clampedY - state.gameCanvasCenterY, clampedX - centerX) * 180 / Math.PI;

            const transform = `translate3d(${Math.round(clampedX)}px, ${Math.round(clampedY)}px, 0) translate(-50%, -50%) rotate(${Math.round(angle + 90)}deg)`;
            if (indicator.__lastDisplay !== 'block') {
                indicator.style.display = 'block';
                indicator.__lastDisplay = 'block';
            }
            if (indicator.__lastBg !== color) {
                indicator.style.backgroundColor = color;
                indicator.__lastBg = color;
            }
            if (indicator.__lastTransform !== transform) {
                indicator.style.transform = transform;
                indicator.__lastTransform = transform;
            }

            indicatorsUsed++;
        }
    }

    // Hide this view's unused slice of the pool
    hideIndicatorRange(indicatorsUsed, poolEnd);
}

function hideIndicatorRange(from, to) {
    for (let i = from; i < to; i++) {
        const indicator = state.enemyIndicators[i];
        if (indicator.__lastDisplay !== 'none') {
            indicator.style.display = 'none';
            indicator.__lastDisplay = 'none';
        }
    }
}
