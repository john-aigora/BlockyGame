import React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { Badge, EraCard, Interstitial, Outro, SilentCaption, useFade } from './cards';
import { Hook } from './Hook';
import { BG_GRADIENT, COLORS, FONT } from './theme';
import { FPS, SEGS, START, TOTAL_FRAMES, TRIMS, sec } from './timings';
import classicLog from './events/classic.json';
import endlessLog from './events/endless.json';

export { TOTAL_FRAMES };

type SfxEvent = { t: number; s: string; a: unknown[] };

// ---------------------------------------------------------------- gameplay
const Gameplay: React.FC<{
  src: string;
  trimBeforeSec: number;
  durationSec: number;
  badge: string;
  badgeAccent?: string;
  children?: React.ReactNode;
}> = ({ src, trimBeforeSec, durationSec, badge, badgeAccent, children }) => {
  const total = sec(durationSec);
  const opacity = useFade(total, 8, 8);
  return (
    <AbsoluteFill style={{ background: BG_GRADIENT }}>
      <AbsoluteFill style={{ opacity }}>
        <OffthreadVideo
          src={staticFile(src)}
          trimBefore={sec(trimBeforeSec)}
          trimAfter={sec(trimBeforeSec + durationSec)}
          style={{ width: 1920, height: 1080 }}
        />
        <Badge text={badge} accent={badgeAccent} />
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------- gameplay sfx
// Plays the game's real sfx at the real moments they fired during the
// recording (timestamps from src/events/*.json, logged by scripts/record.js
// by wrapping the game's own sfx object).
const SFX_MAP: Record<string, { file: (a: unknown[]) => string; vol: number }> = {
  collect: { file: () => 'audio/sfx-collect.wav', vol: 0.7 },
  kill: {
    file: (a) => `audio/sfx-kill${Math.min(typeof a[0] === 'number' ? a[0] : 0, 2)}.wav`,
    vol: 1.0,
  },
  jump: { file: () => 'audio/sfx-jump.wav', vol: 0.9 },
  land: { file: () => 'audio/sfx-land.wav', vol: 0.85 },
  milestone: { file: () => 'audio/sfx-milestone.wav', vol: 0.9 },
  distance: { file: () => 'audio/sfx-distance.wav', vol: 0.85 },
};

const GameplaySfx: React.FC<{
  events: SfxEvent[];
  trimBeforeSec: number;
  segmentStartSec: number;
  durationSec: number;
}> = ({ events, trimBeforeSec, segmentStartSec, durationSec }) => {
  const usable = events
    .filter((e) => SFX_MAP[e.s])
    .filter((e) => e.t >= trimBeforeSec + 0.05 && e.t <= trimBeforeSec + durationSec - 0.35)
    .sort((a, b) => a.t - b.t);
  // Collapse same-sound events closer than 120ms (multi-collect frames).
  const kept: SfxEvent[] = [];
  for (const e of usable) {
    const prev = kept[kept.length - 1];
    if (prev && prev.s === e.s && e.t - prev.t < 0.12) continue;
    kept.push(e);
  }
  return (
    <>
      {kept.map((e, i) => {
        const { file, vol } = SFX_MAP[e.s];
        return (
          <Sequence
            key={`${e.s}-${i}`}
            from={sec(segmentStartSec + (e.t - trimBeforeSec))}
            durationInFrames={sec(1.6)}
          >
            <Audio src={staticFile(file(e.a))} volume={vol} />
          </Sequence>
        );
      })}
    </>
  );
};

// ---------------------------------------------------------------- split
const CROP = { x: 160, y: 56, w: 1600, h: 968 };
const Panel: React.FC<{
  src: string;
  trimBeforeSec: number;
  durationSec: number;
  x: number;
  date: string;
  model: string;
  accent: string;
}> = ({ src, trimBeforeSec, durationSec, x, date, model, accent }) => {
  const S = 900 / CROP.w;
  return (
    <div style={{ position: 'absolute', left: x, top: 172 }}>
      <div
        style={{
          width: 900,
          height: Math.round(CROP.h * S),
          overflow: 'hidden',
          borderRadius: 14,
          border: `3px solid ${accent}`,
          boxShadow: '6px 6px 0 rgba(0,0,0,0.35)',
          background: '#1D282D',
        }}
      >
        <OffthreadVideo
          src={staticFile(src)}
          trimBefore={sec(trimBeforeSec)}
          trimAfter={sec(trimBeforeSec + durationSec)}
          style={{
            width: 1920,
            height: 1080,
            transform: `scale(${S}) translate(${-CROP.x}px, ${-CROP.y}px)`,
            transformOrigin: '0 0',
          }}
        />
      </div>
      <div style={{ marginTop: 28, textAlign: 'center', fontFamily: FONT, width: 900 }}>
        <div style={{ color: COLORS.ink, fontSize: 30, letterSpacing: 3 }}>{date}</div>
        <div style={{ marginTop: 14, color: accent, fontSize: 19, letterSpacing: 1.5 }}>{model}</div>
      </div>
    </div>
  );
};

const SplitScreen: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const opacity = useFade(duration, 10, 10);
  const headerSlide = interpolate(frame, [0, 14], [-18, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: BG_GRADIENT, opacity }}>
      <div
        style={{
          position: 'absolute',
          top: 70,
          width: '100%',
          textAlign: 'center',
          fontFamily: FONT,
          color: COLORS.yellow,
          fontSize: 40,
          letterSpacing: 4,
          textShadow: '4px 4px 0 rgba(0,0,0,0.45)',
          transform: `translateY(${headerSlide}px)`,
        }}
      >
        the same game.
      </div>
      <Panel
        src="clip-original.webm"
        trimBeforeSec={TRIMS.splitOriginal}
        durationSec={duration / FPS}
        x={38}
        date="MAY 10, 2025"
        model="Cursor + Claude 3.7 Sonnet"
        accent={COLORS.teal}
      />
      <Panel
        src="clip-endless.webm"
        trimBeforeSec={TRIMS.splitEndless}
        durationSec={duration / FPS}
        x={982}
        date="JULY 26, 2026"
        model="Claude Fable 5"
        accent={COLORS.orange}
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- music bed
// The 2025 era is silent on purpose (the original had no sound). Music enters
// with the era transition and never leaves until the closing fade.
// Intro/outro beds: Lyria beds when video/.env provides a key at build time;
// this build uses the documented fallback — the game's own boot jingle and
// calm loop (see README).
const MusicBed: React.FC = () => (
  <>
    {/* Hook: game boot jingle + calm loop as the intro bed */}
    <Sequence from={0} durationInFrames={sec(3.5)}>
      <Audio src={staticFile('audio/sfx-start.wav')} volume={0.95} />
    </Sequence>
    <Sequence from={0} durationInFrames={sec(3.5)}>
      <Audio
        src={staticFile('audio/music-calm.wav')}
        volume={(f) =>
          interpolate(f, [0, 12, sec(2.6), sec(3.4)], [0.5, 0.5, 0.45, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        }
      />
    </Sequence>
    {/* 2026 era: calm under interstitial + classic */}
    <Sequence from={sec(START.inter)} durationInFrames={sec(14.6)}>
      <Audio
        src={staticFile('audio/music-calm.wav')}
        volume={(f) =>
          interpolate(f, [0, 24, sec(13.4), sec(14.6)], [0, 1, 1, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        }
      />
    </Sequence>
    {/* Hunt layer under endless, ducked under the split reveal */}
    <Sequence from={sec(START.endless)} durationInFrames={sec(19.8)}>
      <Audio
        src={staticFile('audio/music-hunt.wav')}
        volume={(f) =>
          interpolate(
            f,
            [0, 15, sec(12), sec(12.8), sec(18.4), sec(19.6)],
            [0, 1, 1, 0.38, 0.38, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          )
        }
      />
    </Sequence>
    {/* Fanfare on the split-screen reveal */}
    <Sequence from={sec(START.split + 0.15)} durationInFrames={sec(1.8)}>
      <Audio src={staticFile('audio/sfx-fanfare.wav')} volume={1} />
    </Sequence>
    {/* Outro: calm reprise fading to a clean end */}
    <Sequence from={sec(START.outro + 0.3)} durationInFrames={sec(5.6)}>
      <Audio
        src={staticFile('audio/music-calm.wav')}
        volume={(f) =>
          interpolate(f, [0, 18, sec(4.3), sec(5.5)], [0, 0.42, 0.42, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        }
      />
    </Sequence>
  </>
);

// ---------------------------------------------------------------- film
export const Comparison: React.FC = () => {
  const frame = useCurrentFrame();
  const endFade = interpolate(frame, [TOTAL_FRAMES - 16, TOTAL_FRAMES - 2], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const seg = (startSec: number, durSec: number) => ({
    from: sec(startSec),
    durationInFrames: sec(durSec),
  });
  return (
    <AbsoluteFill style={{ background: BG_GRADIENT }}>
      <Sequence {...seg(START.hook, SEGS.hook)}>
        <Hook duration={sec(SEGS.hook)} />
      </Sequence>
      <Sequence {...seg(START.era, SEGS.era)}>
        <EraCard
          duration={sec(SEGS.era)}
          date="MAY 10, 2025"
          line="built with Cursor + Claude 3.7 Sonnet"
          accent={COLORS.teal}
        />
      </Sequence>
      <Sequence {...seg(START.original, SEGS.original)}>
        <Gameplay
          src="clip-original.webm"
          trimBeforeSec={TRIMS.original}
          durationSec={SEGS.original}
          badge="2025 · Cursor + Claude 3.7 Sonnet"
          badgeAccent={COLORS.teal}
        >
          <SilentCaption />
        </Gameplay>
      </Sequence>
      <Sequence {...seg(START.inter, SEGS.inter)}>
        <Interstitial duration={sec(SEGS.inter)} />
      </Sequence>
      <Sequence {...seg(START.classic, SEGS.classic)}>
        <Gameplay
          src="clip-classic.webm"
          trimBeforeSec={TRIMS.classic}
          durationSec={SEGS.classic}
          badge="2026 · Claude Fable 5"
        />
      </Sequence>
      <Sequence {...seg(START.endless, SEGS.endless)}>
        <Gameplay
          src="clip-endless.webm"
          trimBeforeSec={TRIMS.endless}
          durationSec={SEGS.endless}
          badge="2026 · Claude Fable 5 · NEW: ENDLESS WORLD"
        />
      </Sequence>
      <Sequence {...seg(START.split, SEGS.split)}>
        <SplitScreen duration={sec(SEGS.split)} />
      </Sequence>
      <Sequence {...seg(START.outro, SEGS.outro)}>
        <Outro duration={sec(SEGS.outro)} />
      </Sequence>

      {/* Sound: the 2025 clip stays silent — that's the honest sound of it. */}
      <MusicBed />
      <GameplaySfx
        events={classicLog.sfx as SfxEvent[]}
        trimBeforeSec={TRIMS.classic}
        segmentStartSec={START.classic}
        durationSec={SEGS.classic}
      />
      <GameplaySfx
        events={endlessLog.sfx as SfxEvent[]}
        trimBeforeSec={TRIMS.endless}
        segmentStartSec={START.endless}
        durationSec={SEGS.endless}
      />

      {/* Clean fade to black at the very end */}
      <AbsoluteFill style={{ background: '#000', opacity: endFade, pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};
