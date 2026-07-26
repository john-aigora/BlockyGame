# BlockyGame before/after film (v2)

A ~55s X-ready comparison film: the untouched May 2025 build (Cursor +
Claude 3.7 Sonnet) vs the July 2026 rebuild (Claude Fable 5) — real gameplay,
real game audio, built with [Remotion](https://remotion.dev).

Everything in the film is honest by construction:

- **Footage** is Playwright screencasts of real runs against the live dev
  server (a scripted bot plays; only presentation CSS is injected — canvas
  enlargement, cursor hidden, and the 2026 build's "ORIGINAL '25" switcher
  link hidden so 2026 footage can't be mislabeled by its own chrome).
- **Sound** is the game's own WebAudio synth (`src/audio.js` in the repo
  root), rendered offline by driving the module's real exported functions
  into an `OfflineAudioContext` — never an ear-recreation. Sfx land at the
  timestamps the game actually fired them during the recorded runs.
- **The 2025 segment is silent on purpose**: the original build has no audio
  code at all. The music arriving with the 2026 footage is the era
  transition.

## Prerequisites

- The game dev server running: `npm run dev` in the repo root
  (serves the rebuild at `/` and the untouched 2025 build at
  `/original/index.html`).
- `npm install` in this directory.
- Playwright comes from the repo root's `node_modules`.

## Workflow

### 1. Record clips

```sh
node scripts/record.js original   # 2025 build  → public/clip-original.webm
node scripts/record.js classic    # 2026 classic → public/clip-classic.webm
node scripts/record.js endless    # 2026 endless → public/clip-endless.webm
```

Each run writes `src/events/<name>.json` with clip-relative timestamps of
every sfx call the game made (captured by wrapping `window.__game.debug.sfx`
at record time; page and recorder share the wall clock). It also saves
`public/still-2025.png` / `public/still-2026.png` used by the hook card and
thumbnail. Gameplay is randomized — re-run until the log shows a take you
like (for classic: three `kill` entries and no `death`), then update `TRIMS`
in `src/timings.ts` to frame the action.

### 2. Render audio

```sh
node scripts/render-audio.js      # → public/audio/*.wav
```

Renders the game's music loops (calm + hunt layer) and one-shots (start,
collect, kill x3 combo pitches, jump, land, milestone, distance, fanfare)
from the game's own audio module via OfflineAudioContext. See the header of
the script for how the module's real-time lookahead scheduler is driven
faithfully offline (suspend/resume every 50ms of audio time).

Optional Lyria intro/outro beds (only if `video/.env` contains
`GEMINI_API_KEY=...`):

```sh
node scripts/lyria.js             # → public/audio/intro-bed.wav, outro-bed.wav
```

Without the key (or on API failure) the film automatically uses the game's
own boot jingle + calm loop as the intro bed and a calm reprise as the outro
— it never blocks on Lyria. (If you do generate the beds, point the two
intro/outro `<Audio>` cues in `src/Comparison.tsx` (`MusicBed`) at them.)

### 3. Render the film

```sh
npx remotion render src/index.ts comparison-v2 out/comparison-v2.mp4 --codec=h264
npx remotion still  src/index.ts comparison-v2 out/thumbnail.png --frame=0
```

1920x1080, 30fps, H.264 + AAC. Frame 0 doubles as the X thumbnail: it is a
fully-composed split card (no fade-in) that animates apart into the film.

For a live preview while editing: `npx remotion studio src/index.ts`.

## Layout

```
scripts/record.js        gameplay recorder + event logger (Playwright)
scripts/render-audio.js  game-synth → WAV (OfflineAudioContext)
scripts/lyria.js         optional Lyria intro/outro beds (needs .env)
src/timings.ts           film timeline + per-take trim points
src/Comparison.tsx       composition: segments, music bed, event-synced sfx
src/Hook.tsx             frame-0 thumbnail card
src/cards.tsx            era/interstitial/outro cards, badges, captions
src/events/*.json        per-take event logs (committed: they document the takes)
public/                  clips, stills, wavs (gitignored artifacts)
out/                     renders (gitignored)
```
