// Audience-persona review: uploads the rendered film to the Gemini API and
// asks a Gemini Flash model to watch it as the target X viewer. Reads
// GEMINI_API_KEY from video/.env (git-ignored — never commit it).
//
//   cd video && node scripts/gemini-review.js [path-to-mp4]
//
// Model: gemini-3.6-flash by default (override: GEMINI_MODEL in .env). If the
// exact id 404s, the script lists available models and picks the closest
// "3.6 ... flash" match so a versioned id (e.g. -001) still resolves.
import { GoogleGenAI } from '@google/genai';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '../.env');
if (!existsSync(envPath)) {
  console.error('No video/.env found. Create it with: GEMINI_API_KEY=<your key>');
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
if (!env.GEMINI_API_KEY) {
  console.error('video/.env exists but has no GEMINI_API_KEY line.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
const videoPath = resolve(here, '..', process.argv[2] ?? 'out/comparison-v2.mp4');
const requestedModel = env.GEMINI_MODEL ?? 'gemini-3.6-flash';

const PERSONA_PROMPT = `You are scrolling X (Twitter). You're a software developer who follows AI
news closely, uses AI coding tools daily, and loves concrete "how far have
models come" comparisons. This video appears in your feed.

Watch it in that mindset and answer, concretely:
1. THUMB-STOP: Does the first frame stop your scroll? Why / why not?
2. FIRST 3 SECONDS: Do you understand what you're looking at before you'd swipe?
3. THE CLAIM: The video claims the same game was rebuilt 14 months apart by two
   AI model generations (May 2025: Claude 3.7 Sonnet -> July 2026: Claude Fable 5).
   Does the footage SELL that claim? Where does it land hardest / weakest?
4. PACING: Any second where you'd swipe away? Timestamp it.
5. AUDIO: The 2025 half is deliberately silent ("the original had no sound") and
   music arrives with the 2026 era. Does that read as intentional or broken?
6. SHAREABILITY: Would you repost? What one change would most increase the odds?
7. Rate it /10 as AI-progress content, and write the reply you'd actually leave.

Be specific and blunt. Timestamped notes beat generalities.`;

async function resolveModel() {
  // gemini-3.6-flash is callable but NOT returned by models.list(), so we
  // probe with a real generateContent call rather than models.get()/list().
  try {
    await ai.models.generateContent({ model: requestedModel, contents: 'ok' });
    return requestedModel;
  } catch (e) {
    console.error(`(model "${requestedModel}" probe failed: ${String(e.message || e).slice(0, 80)} — falling back)`);
    return 'gemini-3.5-flash';
  }
}

const model = await resolveModel();
console.error(`Uploading ${videoPath} ...`);
let file = await ai.files.upload({ file: videoPath, config: { mimeType: 'video/mp4' } });
while (file.state === 'PROCESSING') {
  await new Promise((r) => setTimeout(r, 4000));
  file = await ai.files.get({ name: file.name });
}
if (file.state !== 'ACTIVE') throw new Error(`Upload failed: ${file.state}`);
console.error(`Watching with ${model} ...`);

const result = await ai.models.generateContent({
  model,
  contents: [
    { role: 'user', parts: [{ fileData: { fileUri: file.uri, mimeType: 'video/mp4' } }, { text: PERSONA_PROMPT }] },
  ],
});
console.log(result.text);
