// Generates intro/outro music beds with Google's Lyria RealTime model
// (Gemini API, @google/genai SDK) — ONLY if video/.env provides GEMINI_API_KEY.
//
// Usage:  node scripts/lyria.js
// Writes: public/audio/intro-bed.wav (~11s), public/audio/outro-bed.wav (~11s)
// Exit:   0 on success, 2 if no key configured, 1 on API failure.
//         The film composition falls back to the game's own music when the
//         beds are absent — Lyria is an enhancement, never a blocker.
//
// Lyria RealTime streams raw PCM chunks (48kHz, stereo, 16-bit) over a live
// session; we collect ~11s per bed and wrap them in a WAV header. The key is
// read from .env and never printed.
const path = require('path');
const fs = require('fs');

const VIDEO_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(VIDEO_DIR, 'public', 'audio');
const SR = 48000;
const CHANNELS = 2;
const BYTES_PER_SEC = SR * CHANNELS * 2;
const TARGET_SECONDS = 11;

function readKey() {
  const envPath = path.join(VIDEO_DIR, '.env');
  if (!fs.existsSync(envPath)) return null;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*"?([^"\s]+)"?\s*$/);
    if (m) return m[1];
  }
  return null;
}

function writeWav(dest, pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(BYTES_PER_SEC, 28);
  header.writeUInt16LE(CHANNELS * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(dest, Buffer.concat([header, pcm]));
}

async function generateBed(ai, { name, prompt, bpm }) {
  const chunks = [];
  let bytes = 0;
  let failed = null;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  const session = await ai.live.music.connect({
    model: 'models/lyria-realtime-exp',
    callbacks: {
      onmessage: (msg) => {
        const audio = msg?.serverContent?.audioChunks;
        if (audio) {
          for (const c of audio) {
            const buf = Buffer.from(c.data, 'base64');
            chunks.push(buf);
            bytes += buf.length;
          }
          if (bytes >= TARGET_SECONDS * BYTES_PER_SEC) resolveDone();
        }
      },
      onerror: (e) => { failed = e?.message ?? String(e); resolveDone(); },
      onclose: () => resolveDone(),
    },
  });

  try {
    await session.setWeightedPrompts({ weightedPrompts: [{ text: prompt, weight: 1.0 }] });
    await session.setMusicGenerationConfig({ musicGenerationConfig: { bpm, temperature: 1.0 } });
    await session.play();
    const timeout = setTimeout(() => { failed = failed ?? 'timed out after 90s'; resolveDone(); }, 90000);
    await done;
    clearTimeout(timeout);
  } finally {
    try { await session.stop?.(); } catch { /* already closed */ }
    try { session.close?.(); } catch { /* already closed */ }
  }

  if (failed) throw new Error(`${name}: ${failed}`);
  if (bytes < 4 * BYTES_PER_SEC) throw new Error(`${name}: only got ${(bytes / BYTES_PER_SEC).toFixed(1)}s of audio`);
  const pcm = Buffer.concat(chunks).subarray(0, TARGET_SECONDS * BYTES_PER_SEC);
  const dest = path.join(OUT_DIR, `${name}.wav`);
  writeWav(dest, pcm);
  console.log(`SAVED ${dest}  ${(pcm.length / 1024 / 1024).toFixed(1)} MB  (~${TARGET_SECONDS}s)`);
}

(async () => {
  const key = readKey();
  if (!key) {
    console.log('No GEMINI_API_KEY in video/.env — skipping Lyria (film falls back to game music).');
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey: key, apiVersion: 'v1alpha' });
  await generateBed(ai, {
    name: 'intro-bed',
    prompt: 'upbeat retro chiptune arcade intro, energetic, 8-bit, bright, no vocals',
    bpm: 128,
  });
  await generateBed(ai, {
    name: 'outro-bed',
    prompt: 'triumphant retro chiptune arcade outro, warm, victorious, 8-bit, no vocals',
    bpm: 112,
  });
})().catch((e) => { console.error('LYRIA FAILED:', e.message); process.exit(1); });
