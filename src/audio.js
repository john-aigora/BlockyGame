// Synthesized WebAudio SFX + procedural chiptune music (plan 010).
// Zero asset files: every sound is an oscillator / noise-buffer envelope
// built at schedule time. Lazily initialized — `ctx` exists only after
// unlockAudio() runs from a REAL user gesture (startRun, button clicks),
// per the browser autoplay policy; never call unlockAudio from timers.
// Every public function is a no-op (never a throw) when ctx is null or
// muted: audio failure must never break gameplay.
//
// localStorage is allowed here and in src/hiscores.js only.
// The setInterval below is the standard WebAudio lookahead scheduler
// ("a tale of two clocks") — it only SCHEDULES notes on ctx.currentTime,
// it never drives the game simulation, so the game-clock rules don't apply.

let ctx = null;
let muted = loadMuted();

function loadMuted() {
    try { return localStorage.getItem('blocky.muted') === '1'; }
    catch { return false; /* storage unavailable — default to sound on */ }
}

export function isMuted() { return muted; }

export function setMuted(m) {
    muted = m;
    if (m) music.stop();
    try { localStorage.setItem('blocky.muted', m ? '1' : '0'); }
    catch { /* private mode — mute still applies for this session */ }
}

// Call from a user gesture (startRun, mute button).
export function unlockAudio() {
    if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch { ctx = null; /* no WebAudio — game stays silent, never broken */ }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
}

// Test/debug introspection (exposed on window.__game.debug in main.js).
// An OBJECT since plan 023: `state` is the old string; `intensity` is the
// REQUESTED music layer (what setIntensity last stored — deterministic for
// specs even when a suspended headless context never advances a bar line);
// `activeIntensity` is the bar-committed layer actually sounding.
export function audioState() {
    return {
        state: ctx?.state ?? 'none',
        intensity: pendingIntensity,
        activeIntensity: intensity,
        musicVolume: volumeFactor
    };
}

// --- One-shot SFX -----------------------------------------------------
// blip() is the house envelope — new effects should be blip compositions
// first, custom nodes only if genuinely needed.

function blip({ freq = 440, endFreq, type = 'square', dur = 0.1, vol = 0.2, delay = 0 }) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
}

export const sfx = {
    collect: () => blip({ freq: 660, endFreq: 990, dur: 0.08, vol: 0.15 }),
    // comboStep escalates the kill pitch: +2 semitones per chained kill
    // (score-juice pass), so a combo AUDIBLY climbs. Step 0 is the original
    // sound exactly; the clamp keeps even absurd steps musical.
    kill: (comboStep = 0) => {
        const pitch = Math.pow(2, Math.min(comboStep, 8) / 6);
        blip({ freq: 220 * pitch, endFreq: 55 * pitch, type: 'sawtooth', dur: 0.25, vol: 0.25 });
        blip({ freq: 880 * pitch, endFreq: 1760 * pitch, dur: 0.12, vol: 0.12, delay: 0.05 });
    },
    death: () => { blip({ freq: 330, endFreq: 82, type: 'triangle', dur: 0.6, vol: 0.3 }); },
    start: () => { [523, 659, 784].forEach((f, i) => blip({ freq: f, dur: 0.09, vol: 0.15, delay: i * 0.09 })); },
    // New-best fanfare (spectacle pass): a four-note rising C-major arpeggio
    // capped with a held two-voice chord — unmistakably bigger than the
    // three-note boot jingle. Plays under the death screen at rank 0, and
    // FULL again for the titan kill (plan 025). fanfare('short') is the
    // same arpeggio at double speed with no held chord — the gold-food
    // flourish: richer than a collect blip, humbler than a triumph.
    fanfare: (variant) => {
        if (variant === 'short') {
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => blip({ freq: f, dur: 0.07, vol: 0.13, delay: i * 0.05 }));
            return;
        }
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => blip({ freq: f, dur: 0.12, vol: 0.16, delay: i * 0.11 }));
        blip({ freq: 1567.98, dur: 0.4, vol: 0.13, delay: 0.44 });
        blip({ freq: 783.99, type: 'triangle', dur: 0.4, vol: 0.12, delay: 0.44 });
    },
    // Growth milestone: a quick 3-note rising jingle (E5 G5 B5) — brighter
    // and faster than the start fanfare, so it reads as "level up", not "boot".
    milestone: () => { [659, 784, 988].forEach((f, i) => blip({ freq: f, dur: 0.1, vol: 0.18, delay: i * 0.08 })); },
    // Distance milestone (endless): a two-note "waypoint" chime — an open
    // fifth (G5→D6) with a soft triangle shadow, deliberately rounder and
    // shorter than the growth jingle so ears learn "that's distance".
    distance: () => {
        blip({ freq: 784, dur: 0.09, vol: 0.14 });
        blip({ freq: 1175, dur: 0.16, vol: 0.12, delay: 0.1 });
        blip({ freq: 587, type: 'triangle', dur: 0.2, vol: 0.1, delay: 0.1 });
    },
    // Jump (endless): a rising "boing" — one quick sine sweep up with a
    // square glint on top; landing answers with a soft low thump.
    jump: () => {
        blip({ freq: 240, endFreq: 660, type: 'sine', dur: 0.16, vol: 0.16 });
        blip({ freq: 480, endFreq: 990, dur: 0.08, vol: 0.06, delay: 0.02 });
    },
    land: () => blip({ freq: 130, endFreq: 55, type: 'triangle', dur: 0.11, vol: 0.16 }),
    click: () => blip({ freq: 880, dur: 0.03, vol: 0.08 }),
    // Panic tick: one soft, short click per displayed second while the
    // collect countdown is in its last PANIC_TIME seconds (timers.js drives
    // the cadence off the same shown-integer change that writes the DOM).
    tick: () => blip({ freq: 1150, dur: 0.025, vol: 0.06 }),
    // Escape beat (plan 023 DT-10): a relieved exhale — a falling sigh
    // answered by a small rising "we're okay" flick. Two soft sine blips,
    // pure house style; name stays generic per the plan's maintenance note
    // (future species reuse it).
    phew: () => {
        blip({ freq: 540, endFreq: 320, type: 'sine', dur: 0.18, vol: 0.15 });
        blip({ freq: 392, endFreq: 660, type: 'sine', dur: 0.2, vol: 0.12, delay: 0.2 });
    },
    // Danger heartbeat: one low lub-dub per call. The ~72bpm LOOP lives in
    // ui.js on the game clock (dt-driven) — audio stays fire-and-forget
    // one-shots, so pause and death stop the heart by not calling this.
    heartbeat: () => {
        blip({ freq: 68, endFreq: 46, type: 'sine', dur: 0.12, vol: 0.08 });
        blip({ freq: 62, endFreq: 44, type: 'sine', dur: 0.1, vol: 0.055, delay: 0.16 });
    },
    // Ascension (plan 029): a long rising C-major climb into held light —
    // deliberately the BIGGEST jingle in the game; the run just crowned.
    ascend: () => {
        [261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
            blip({ freq: f, dur: 0.14, vol: 0.15, delay: i * 0.16 }));
        blip({ freq: 1046.5, type: 'triangle', dur: 1.6, vol: 0.10, delay: 1.15 });
        blip({ freq: 1318.5, type: 'sine', dur: 1.6, vol: 0.08, delay: 1.15 });
    },
    // The starburst: one bright chord + a long high shimmer tail.
    ascendBurst: () => {
        [1046.5, 1318.5, 1568].forEach((f) => blip({ freq: f, dur: 0.5, vol: 0.12 }));
        blip({ freq: 2093, endFreq: 3136, type: 'sine', dur: 0.9, vol: 0.06, delay: 0.1 });
    },
};

// --- Background music (procedural chiptune loop) -----------------------
// ~112 BPM, A-minor pentatonic, 2-bar loop in 16th-note steps:
//   triangle bass (one note per beat) + square arpeggio (16ths, quiet)
//   + a soft bandpassed-noise hat. Master music gain sits low so the SFX
// always ride on top. THREE layers since plan 023 (CAP-5):
//   0 calm — the base loop;
//   1 hunt (any enemy killable) — lead up an octave + off-beat hats;
//   2 danger (dread owns the channel: no prey, vignette risen) — everything
//     level 1 does PLUS a low held sine pad each half-bar (the bass root an
//     octave down) and a doubled bass note on the bar start.
// Every switch lands on bar boundaries only, so layer changes never jar
// mid-bar. ui.js updateDangerPulse is the single setIntensity driver.

const BPM = 112;
const STEP_DUR = 60 / BPM / 4;   // one 16th note, in seconds
const STEPS_PER_BAR = 16;        // 4/4
const LOOP_STEPS = 32;           // 2-bar loop
const MUSIC_VOL = 0.12;
const LOOKAHEAD_S = 0.1;         // schedule this far ahead on ctx.currentTime
const TICK_MS = 25;              // scheduler wake-up interval

// Bass: one note per beat over 2 bars — A1 A1 C2 C2 | E2 E2 G1 G1
const BASS_HZ = [55.0, 55.0, 65.41, 65.41, 82.41, 82.41, 49.0, 49.0];
// Arpeggio: 8-step up/down — A3 C4 E4 A4 E4 C4 A3 E4
const ARP_HZ = [220.0, 261.63, 329.63, 440.0, 329.63, 261.63, 220.0, 329.63];

let musicTimer = null;    // setInterval id — doubles as the "active" flag
let musicGain = null;     // per-run master gain (rides the stop() fadeout)
let nextStepTime = 0;
let stepIndex = 0;
let intensity = 0;        // applied layer (0 calm, 1 hunt, 2 danger); commits on bar lines
let pendingIntensity = 0; // requested layer (clamped 0..2); adopted at the next bar line
let volumeFactor = 1;     // Master music scale 0..1 (plan 023: title bed 0.5, runs 1); persists across start/stop
let noiseBuf = null;      // shared 1s white-noise buffer for the hat

function getNoiseBuffer() {
    if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
}

// Note/hat volumes below are relative to musicGain (MUSIC_VOL).
function note({ freq, type, dur, vol, t }) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
}

function hat(t) {
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 6000;
    bp.Q.value = 1.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(bp).connect(gain).connect(musicGain);
    src.start(t);
    src.stop(t + 0.05);
}

function scheduleStep(s, t) {
    // Layer switches commit on bar lines only.
    if (s % STEPS_PER_BAR === 0) intensity = pendingIntensity;
    // Triangle bass, one note per beat, held almost to the next beat.
    if (s % 4 === 0) {
        const bass = BASS_HZ[(s / 4) % BASS_HZ.length];
        note({ freq: bass, type: 'triangle', dur: STEP_DUR * 3.5, vol: 1.0, t });
        // Danger layer: the bar-start bass note is DOUBLED (a second unison
        // triangle voice — constructive attack, a heavier downbeat thump).
        if (intensity === 2 && s % STEPS_PER_BAR === 0) {
            note({ freq: bass, type: 'triangle', dur: STEP_DUR * 3.5, vol: 0.8, t });
        }
    }
    // Danger layer: a low held pad each half-bar — the current bass root an
    // octave DOWN, sine, held nearly the whole half-bar. vol is relative to
    // musicGain: 0.42 × MUSIC_VOL ≈ 0.05 absolute, the plan's target gain.
    if (intensity === 2 && s % 8 === 0) {
        note({ freq: BASS_HZ[(s / 4) % BASS_HZ.length] / 2, type: 'sine', dur: STEP_DUR * 7.5, vol: 0.42, t });
    }
    // Square arpeggio on every 16th; levels >=1 lift it an octave.
    const lead = ARP_HZ[s % ARP_HZ.length] * (intensity >= 1 ? 2 : 1);
    note({ freq: lead, type: 'square', dur: STEP_DUR * 0.9, vol: 0.4, t });
    // Hat on the beats; levels >=1 add the off-beat 8ths.
    if (s % 4 === 0 || (intensity >= 1 && s % 4 === 2)) hat(t);
}

function schedulerTick() {
    if (!ctx || !musicGain) return;
    // Stall recovery (plan 033, audit C-20 / prior C-9): a backgrounded tab
    // throttles this interval; without a floor the loop would schedule
    // every missed 16th at once on return — one garbled burst. Drop the
    // backlog, never replay it.
    if (nextStepTime < ctx.currentTime) nextStepTime = ctx.currentTime + 0.02;
    while (nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
        scheduleStep(stepIndex, nextStepTime);
        stepIndex = (stepIndex + 1) % LOOP_STEPS;
        nextStepTime += STEP_DUR;
    }
}

export const music = {
    start() {
        if (!ctx || muted || musicTimer) return;
        // Suspended context (iOS/Safari — prior audit C-8): a scheduler on a
        // dead clock burst-fires everything on resume. The caller's gesture
        // path (unlockAudio) is responsible for resuming first.
        if (ctx.state !== 'running') return;
        musicGain = ctx.createGain();
        musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
        musicGain.gain.exponentialRampToValueAtTime(
            Math.max(MUSIC_VOL * volumeFactor, 0.0001), ctx.currentTime + 0.1);
        musicGain.connect(ctx.destination);
        stepIndex = 0;
        intensity = 0;
        pendingIntensity = 0;
        nextStepTime = ctx.currentTime + 0.05;
        musicTimer = setInterval(schedulerTick, TICK_MS);
    },
    stop() {
        if (!musicTimer) return;
        clearInterval(musicTimer);
        musicTimer = null;
        // Already-scheduled notes (up to LOOKAHEAD_S ahead) ride the fadeout.
        if (musicGain && ctx) {
            const dyingGain = musicGain;
            const t = ctx.currentTime;
            dyingGain.gain.cancelScheduledValues(t);
            dyingGain.gain.setValueAtTime(Math.max(dyingGain.gain.value, 0.0001), t);
            dyingGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
            setTimeout(() => dyingGain.disconnect(), 500);
        }
        musicGain = null;
    },
    setIntensity(level) {
        // Stores the clamped integer 0|1|2; scheduleStep adopts it at the
        // next bar line (never mid-bar — the musical-transition law).
        pendingIntensity = Math.max(0, Math.min(2, Math.round(Number(level) || 0)));
    },
    // Title warmth (plan 023): scales the ONE master music gain. The factor
    // persists so a start() that follows (or already ran) plays at it —
    // ui.js sets 0.5 for the overlay bed, startRun restores 1. Live changes
    // ramp over 0.25s: a step would click.
    setVolume(factor) {
        volumeFactor = Math.max(0, Math.min(1, Number(factor) || 0));
        if (ctx && musicGain) {
            const t = ctx.currentTime;
            musicGain.gain.cancelScheduledValues(t);
            musicGain.gain.setValueAtTime(Math.max(musicGain.gain.value, 0.0001), t);
            musicGain.gain.exponentialRampToValueAtTime(
                Math.max(MUSIC_VOL * volumeFactor, 0.0001), t + 0.25);
        }
    },
    isActive() {
        return musicTimer !== null;
    },
};
