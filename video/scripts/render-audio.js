// Renders the GAME'S OWN music + sfx to WAV files via OfflineAudioContext.
//
// Usage:  node scripts/render-audio.js
// Needs:  the game dev server running at http://localhost:5173
// Writes: public/audio/*.wav
//
// Provenance guarantee: nothing here re-creates the sound by ear. The page
// dynamically imports the game's real module (/src/audio.js, served by the
// same Vite dev server the game runs on) and drives its EXPORTED functions:
//
//   - sfx.*    schedule their oscillators on module-level `ctx`, which we
//     point at an OfflineAudioContext by shimming window.AudioContext before
//     calling the module's own unlockAudio(). One startRendering() per file.
//   - music.start()/setIntensity() run the module's real lookahead scheduler
//     (setInterval + ctx.currentTime). Offline contexts render faster than
//     wall time, so we drive it faithfully with OfflineAudioContext
//     suspend/resume: pause the render every 50ms of audio time (half the
//     module's 100ms lookahead) and give the real setInterval a beat to
//     schedule ahead, then resume. The output is the same note stream the
//     game schedules live, at the same times, through the same nodes.
//
// The page used as the import host is /original/index.html — same origin,
// but the 2025 build never imports /src/audio.js, so our dynamic import is
// the module's first and only instantiation there (no game code races us).
//
// Loudness: the game mixes music at 0.12 master gain so sfx ride on top.
// That in-game balance is preserved; we only apply fixed film makeup gains
// (MUSIC_GAIN x3.0, SFX_GAIN x2.2) so the film master sits at a healthy
// level. Peaks are printed per file and asserted < 0.95 (no clipping).
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));

const OUT_DIR = path.resolve(__dirname, '..', 'public', 'audio');
const PAGE = 'http://localhost:5173/original/index.html';
const SR = 44100;
const MUSIC_GAIN = 5.0;
const SFX_GAIN = 2.2;

// One WAV per entry. `call` runs in the page with the freshly imported module.
const JOBS = [
  // --- SFX (one-shots; scheduled at t=0, then a single startRendering) ---
  { name: 'sfx-start', dur: 0.7, gain: SFX_GAIN, kind: 'sfx', fn: 'start', args: [] },
  { name: 'sfx-collect', dur: 0.4, gain: SFX_GAIN, kind: 'sfx', fn: 'collect', args: [] },
  { name: 'sfx-kill0', dur: 0.8, gain: SFX_GAIN, kind: 'sfx', fn: 'kill', args: [0] },
  { name: 'sfx-kill1', dur: 0.8, gain: SFX_GAIN, kind: 'sfx', fn: 'kill', args: [1] },
  { name: 'sfx-kill2', dur: 0.8, gain: SFX_GAIN, kind: 'sfx', fn: 'kill', args: [2] },
  { name: 'sfx-jump', dur: 0.5, gain: SFX_GAIN, kind: 'sfx', fn: 'jump', args: [] },
  { name: 'sfx-land', dur: 0.4, gain: SFX_GAIN, kind: 'sfx', fn: 'land', args: [] },
  { name: 'sfx-milestone', dur: 0.7, gain: SFX_GAIN, kind: 'sfx', fn: 'milestone', args: [] },
  { name: 'sfx-distance', dur: 0.7, gain: SFX_GAIN, kind: 'sfx', fn: 'distance', args: [] },
  { name: 'sfx-fanfare', dur: 1.5, gain: SFX_GAIN, kind: 'sfx', fn: 'fanfare', args: [] },
  // --- MUSIC (the 2-bar loop is 4.2857s at 112 BPM; 7 loops = exactly 30s) ---
  { name: 'music-calm', dur: 30.1, gain: MUSIC_GAIN, kind: 'music', intensity: 0 },
  { name: 'music-hunt', dur: 21.6, gain: MUSIC_GAIN, kind: 'music', intensity: 1 },
];

// Runs inside the page. Returns { base64, peak } for a 16-bit mono WAV.
async function renderInPage({ job, sr }) {
  const mod = await import('/src/audio.js');
  const off = new OfflineAudioContext(1, Math.ceil(job.dur * sr), sr);
  const realResume = off.resume.bind(off);
  off.resume = () => Promise.resolve(); // unlockAudio() resumes; offline ctx would reject
  window.AudioContext = function AudioContextShim() { return off; };
  window.webkitAudioContext = window.AudioContext;
  mod.setMuted(false);
  mod.unlockAudio(); // module-level ctx := our OfflineAudioContext

  if (mod.audioState() !== 'suspended') {
    throw new Error('audio module did not adopt the offline context: ' + mod.audioState());
  }

  if (job.kind === 'sfx') {
    mod.sfx[job.fn](...job.args);
  } else {
    // Drive the module's real-time scheduler against the offline render head:
    // suspend every 50ms of audio time, let setInterval(25ms) top up the
    // 100ms lookahead, resume. Scheduler stays >=50ms ahead of the head.
    const STEP = 0.05;
    for (let t = STEP; t < job.dur - 0.01; t += STEP) {
      off.suspend(t).then(async () => {
        await new Promise((r) => setTimeout(r, 32));
        realResume();
      });
    }
    mod.music.start();
    if (job.intensity) mod.music.setIntensity(1);
    // Pre-roll: render head sits at 0 until startRendering; let the scheduler
    // fill the first lookahead window.
    await new Promise((r) => setTimeout(r, 160));
  }

  const buf = await off.startRendering();
  if (job.kind === 'music') mod.music.stop();

  const data = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i] * job.gain);
    if (v > peak) peak = v;
  }
  // 16-bit PCM mono WAV
  const n = data.length;
  const bytes = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(bytes);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wstr(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, data[i] * job.gain));
    dv.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  let bin = '';
  const u8 = new Uint8Array(bytes);
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return { base64: btoa(bin), peak };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const job of JOBS) {
      // Fresh page per file: audio.js caches its ctx at module level, and a
      // fresh navigation gives a fresh module instance + fresh offline ctx.
      const page = await browser.newPage();
      await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
      const { base64, peak } = await page.evaluate(renderInPage, { job, sr: SR })
        .catch(async (e) => { await page.close(); throw new Error(`${job.name}: ${e.message}`); });
      await page.close();
      const wav = Buffer.from(base64, 'base64');
      const dest = path.join(OUT_DIR, `${job.name}.wav`);
      fs.writeFileSync(dest, wav);
      const flag = peak >= 0.95 ? '  !! CLIPPING RISK' : '';
      console.log(`SAVED ${dest}  ${(wav.length / 1024).toFixed(0)} KB  dur=${job.dur}s  peak=${peak.toFixed(3)}${flag}`);
      if (peak >= 0.95) process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('AUDIO RENDER FAILED:', e); process.exit(1); });
