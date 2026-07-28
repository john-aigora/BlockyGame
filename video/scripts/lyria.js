// Generates the film's intro/outro music beds with Google's Lyria 3 clip model
// (Gemini API, @google/genai SDK) — ONLY if video/.env provides GEMINI_API_KEY.
//
// Usage:  node scripts/lyria.js
// Writes: public/audio/intro-bed.<mp3|wav>  (upbeat retro chiptune arcade intro)
//         public/audio/outro-bed.<mp3|wav>  (triumphant/uplifting resolve)
// Exit:   0 on success, 2 if no key configured, 1 on API failure.
//         The film composition falls back to the game's own music when the
//         beds are absent — Lyria is an enhancement, never a blocker.
//
// SDK call shape (probed live, July 2026): the Lyria 3 *clip* model is driven
// through the ordinary generateContent surface with an AUDIO response modality —
//   ai.models.generateContent({
//     model: 'lyria-3-clip-preview',
//     contents: '<prompt>',
//     config: { responseModalities: ['AUDIO'] },
//   })
// The clip model always returns a single ~30s instrumental clip as one
// inlineData part (mimeType audio/mpeg, i.e. MP3; base64). We decode and save
// it; the film uses the leading portion of each clip via the composition's
// Sequence windows + volume envelopes. (The newer ai.interactions.create()
// surface exists in the SDK but its 1.x schema is rejected by the API — it now
// demands SDK >= 2.0.0 — so generateContent is both the simplest and the
// working path.) The API key is read from .env and never printed.
import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const VIDEO_DIR = resolve(here, '..');
const OUT_DIR = join(VIDEO_DIR, 'public', 'audio');

function readKey() {
  const envPath = join(VIDEO_DIR, '.env');
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*"?([^"\s]+)"?\s*$/);
    if (m) return m[1];
  }
  return null;
}

// Wrap raw 16-bit PCM in a minimal WAV header (used only if Lyria ever returns
// audio/l16 raw PCM instead of MP3).
function wrapPcmToWav(pcm, sampleRate, channels) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Rough MP3 duration by scanning frame headers (no ffmpeg dependency).
function mp3DurationSeconds(buf) {
  const BR = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const SR = [44100, 48000, 32000];
  let i = 0;
  let samples = 0;
  let sr = 48000;
  while (i < buf.length - 4) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      const brIdx = (buf[i + 2] & 0xf0) >> 4;
      const srIdx = (buf[i + 2] & 0x0c) >> 2;
      const pad = (buf[i + 2] & 0x02) >> 1;
      if (brIdx === 0 || brIdx === 15 || srIdx === 3) { i++; continue; }
      const bitrate = BR[brIdx] * 1000;
      sr = SR[srIdx];
      const frameLen = Math.floor((144 * bitrate) / sr) + pad;
      if (frameLen < 4) { i++; continue; }
      samples += 1152;
      i += frameLen;
    } else {
      i++;
    }
  }
  return samples / sr;
}

async function generateBed(ai, { name, prompt }) {
  const res = await ai.models.generateContent({
    model: 'lyria-3-clip-preview',
    contents: prompt,
    config: { responseModalities: ['AUDIO'] },
  });
  const parts = res?.candidates?.[0]?.content?.parts ?? [];
  const audio = parts.find((p) => p.inlineData?.mimeType?.startsWith('audio/'));
  if (!audio) {
    const kinds = parts.map((p) => (p.inlineData?.mimeType ? p.inlineData.mimeType : Object.keys(p).join('+')));
    throw new Error(`${name}: no audio part returned (got: ${kinds.join(', ') || 'nothing'})`);
  }
  const mime = audio.inlineData.mimeType;
  const raw = Buffer.from(audio.inlineData.data, 'base64');

  let ext;
  let bytes = raw;
  let durationSec;
  let sampleRate;
  if (mime.includes('mpeg') || mime.includes('mp3')) {
    ext = 'mp3';
    durationSec = mp3DurationSeconds(raw);
    sampleRate = 48000; // Lyria clip default
  } else if (mime.includes('wav')) {
    ext = 'wav';
    sampleRate = raw.readUInt32LE(24);
    durationSec = (raw.length - 44) / (sampleRate * 2 * 2);
  } else if (mime.includes('l16') || mime.includes('L16') || mime.includes('pcm')) {
    const rateMatch = mime.match(/rate=(\d+)/);
    sampleRate = rateMatch ? Number(rateMatch[1]) : 48000;
    const channels = 2;
    bytes = wrapPcmToWav(raw, sampleRate, channels);
    ext = 'wav';
    durationSec = raw.length / (sampleRate * channels * 2);
  } else {
    ext = 'bin';
    durationSec = 0;
    sampleRate = 0;
  }

  const dest = join(OUT_DIR, `${name}.${ext}`);
  writeFileSync(dest, bytes);
  console.log(
    `SAVED ${name}.${ext}  mime=${mime}  ${(bytes.length / 1024).toFixed(0)}KB  ~${durationSec.toFixed(1)}s  ${sampleRate}Hz`,
  );
  return { name, ext, mime, durationSec, sampleRate };
}

const key = readKey();
if (!key) {
  console.log('No GEMINI_API_KEY in video/.env — skipping Lyria (film falls back to game music).');
  process.exit(2);
}
mkdirSync(OUT_DIR, { recursive: true });
const ai = new GoogleGenAI({ apiKey: key });

try {
  await generateBed(ai, {
    name: 'intro-bed',
    prompt:
      'Upbeat retro chiptune arcade intro music. Energetic 8-bit / 16-bit video-game ' +
      'style, bright square-wave lead, driving arcade bassline, punchy and immediately ' +
      'exciting from the first beat. Fast tempo, major key, playful and heroic. ' +
      'Purely instrumental, no vocals, no speech.',
  });
  await generateBed(ai, {
    name: 'outro-bed',
    prompt:
      'Triumphant, uplifting retro chiptune outro music that resolves to a warm, ' +
      'victorious finish. 8-bit / 16-bit arcade style, anthemic square-wave melody, ' +
      'bright arpeggios, a sense of achievement and forward progress, resolving on a ' +
      'satisfying major chord. Mid-fast tempo, celebratory. Purely instrumental, no ' +
      'vocals, no speech.',
  });
  console.log('LYRIA OK');
} catch (e) {
  console.error('LYRIA FAILED:', String(e?.message ?? e).slice(0, 400));
  process.exit(1);
}
