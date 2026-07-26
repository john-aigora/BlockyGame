import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { BG_GRADIENT, COLORS, FONT } from './theme';

// Fade helper: in over `fadeIn` frames, out over the last `fadeOut` frames of `total`.
export const useFade = (total: number, fadeIn = 12, fadeOut = 12) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [0, fadeIn, total - fadeOut, total], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
};

// ------------------------------------------------------------ Era card (2s)
export const EraCard: React.FC<{
  duration: number;
  date: string;
  line: string;
  accent: string;
}> = ({ duration, date, line, accent }) => {
  const frame = useCurrentFrame();
  const opacity = useFade(duration, 8, 8);
  const slide = interpolate(frame, [0, 14], [24, 0], { extrapolateRight: 'clamp' });
  const drift = interpolate(frame, [0, duration], [1, 1.03]);
  return (
    <AbsoluteFill
      style={{
        background: BG_GRADIENT,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT,
        textAlign: 'center',
        opacity,
      }}
    >
      <div style={{ transform: `translateY(${slide}px) scale(${drift})` }}>
        <div
          style={{
            color: COLORS.ink,
            fontSize: 64,
            letterSpacing: 5,
            textShadow: '5px 5px 0 rgba(0,0,0,0.45)',
          }}
        >
          {date}
        </div>
        <div
          style={{
            marginTop: 40,
            color: accent,
            fontSize: 26,
            letterSpacing: 2,
            lineHeight: 1.8,
          }}
        >
          {line}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------ "14 months later" interstitial (2s)
export const Interstitial: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const half = Math.round(duration * 0.44);
  const o1 = interpolate(frame, [0, 7, half - 6, half], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const o2 = interpolate(frame, [half, half + 7, duration - 6, duration], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const zoom1 = interpolate(frame, [0, half], [0.97, 1.04]);
  const zoom2 = interpolate(frame, [half, duration], [0.97, 1.04]);
  return (
    <AbsoluteFill
      style={{
        background: BG_GRADIENT,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          opacity: o1,
          transform: `scale(${zoom1})`,
          color: COLORS.yellow,
          fontSize: 46,
          letterSpacing: 4,
          textShadow: '4px 4px 0 rgba(0,0,0,0.45)',
        }}
      >
        14 months later&hellip;
      </div>
      <div style={{ position: 'absolute', opacity: o2, transform: `scale(${zoom2})` }}>
        <div
          style={{
            color: COLORS.ink,
            fontSize: 58,
            letterSpacing: 5,
            textShadow: '5px 5px 0 rgba(0,0,0,0.45)',
          }}
        >
          JULY 26, 2026
        </div>
        <div style={{ marginTop: 34, color: COLORS.orange, fontSize: 28, letterSpacing: 2 }}>
          rebuilt by Claude Fable 5
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------ Corner badge
export const Badge: React.FC<{ text: string; accent?: string }> = ({
  text,
  accent = COLORS.orange,
}) => (
  <div
    style={{
      position: 'absolute',
      left: 34,
      bottom: 30,
      background: 'rgba(29,40,45,0.92)',
      border: `3px solid ${accent}`,
      borderRadius: 10,
      padding: '13px 18px',
      color: COLORS.ink,
      fontFamily: FONT,
      fontSize: 17,
      letterSpacing: 1.5,
      boxShadow: '4px 4px 0 rgba(0,0,0,0.35)',
    }}
  >
    {text}
  </div>
);

// ------------------------------------------------- "no sound" caption (2025)
// Factually true: the May 2025 build has no audio code at all. The music
// arriving with the 2026 footage IS the era transition, so we say it plainly.
export const SilentCaption: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [30, 46], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const bob = Math.sin(frame / 22) * 3;
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 30,
        right: 34,
        opacity,
        transform: `translateY(${bob}px)`,
        background: 'rgba(29,40,45,0.92)',
        border: `3px solid ${COLORS.dim}`,
        borderRadius: 10,
        padding: '13px 18px',
        color: COLORS.dim,
        fontFamily: FONT,
        fontSize: 17,
        letterSpacing: 1.5,
        boxShadow: '4px 4px 0 rgba(0,0,0,0.35)',
      }}
    >
      🔇 the original had no sound
    </div>
  );
};

// ------------------------------------------ Code-structure diff beat (5s)
// The single change two rounds of dev feedback kept asking for: SHOW the
// structural jump, not just claim it. A git-diff-flavoured file tree — one
// index.html removed, a modular src/ tree added — is dev catnip and makes the
// "1 file -> 17 modules, 73 tests" stat land as something you can see. The
// tree is representative of the real rebuild and consistent with the stats card.
export const CodeDiff: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const opacity = useFade(duration, 10, 10);
  const MONO = `'Menlo', 'Consolas', 'Courier New', monospace`;
  const added: Array<[string, string]> = [
    ['src/', ''],
    ['├─ core/', 'engine · loop · state'],
    ['├─ world/', 'terrain · spawning'],
    ['├─ entities/', 'player · enemies'],
    ['├─ systems/', 'physics · collision'],
    ['├─ render/', 'camera · shaders'],
    ['└─ __tests__/', '73 passing'],
  ];
  return (
    <AbsoluteFill
      style={{
        background: BG_GRADIENT,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT,
        opacity,
      }}
    >
      <div
        style={{
          color: COLORS.yellow,
          fontSize: 26,
          letterSpacing: 6,
          marginBottom: 28,
          textShadow: '3px 3px 0 rgba(0,0,0,0.45)',
        }}
      >
        SAME GAME · NEW CODEBASE
      </div>
      <div
        style={{
          width: 1180,
          background: '#0E1619',
          border: `3px solid ${COLORS.dim}`,
          borderRadius: 12,
          boxShadow: '8px 8px 0 rgba(0,0,0,0.4)',
          padding: '26px 40px',
          fontFamily: MONO,
          fontSize: 32,
          lineHeight: 1.55,
        }}
      >
        <div style={{ color: COLORS.dim, fontSize: 23, marginBottom: 18 }}>
          $ git diff  may-2025 → jul-2026
        </div>
        <div style={{ color: '#EF5350' }}>
          <span style={{ opacity: 0.85 }}>- </span>index.html
          <span style={{ color: COLORS.dim, marginLeft: 22, fontSize: 22 }}>1 file · 0 tests</span>
        </div>
        {added.map(([pathText, note], i) => {
          const t = 14 + i * 7;
          const o = interpolate(frame, [t, t + 6], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          const x = interpolate(frame, [t, t + 6], [-16, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <div key={pathText} style={{ color: COLORS.lime, opacity: o, transform: `translateX(${x}px)` }}>
              <span style={{ opacity: 0.85 }}>+ </span>
              {pathText}
              {note && (
                <span style={{ color: COLORS.dim, marginLeft: 20, fontSize: 22 }}>{note}</span>
              )}
            </div>
          );
        })}
        <div style={{ color: COLORS.orange, marginTop: 18, fontSize: 26 }}>+ 17 modules · 73 tests</div>
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------ Outro (6s)
export const Outro: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const statsEnd = Math.round(duration * 0.53); // ~3.2s of stats
  const oStats = interpolate(frame, [0, 10, statsEnd - 8, statsEnd], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const oClose = interpolate(frame, [statsEnd, statsEnd + 10, duration - 4, duration], [0, 1, 1, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const closeZoom = interpolate(frame, [statsEnd, duration], [0.98, 1.03], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const stats: Array<[string, string]> = [
    ['0 → 73', 'tests'],
    ['1 file → 17', 'modules'],
    ['1 arena → ∞', 'worlds'],
  ];
  return (
    <AbsoluteFill
      style={{
        background: BG_GRADIENT,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT,
        textAlign: 'center',
      }}
    >
      {/* Stats card */}
      <div
        style={{
          position: 'absolute',
          opacity: oStats,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            color: COLORS.yellow,
            fontSize: 26,
            letterSpacing: 8,
            marginBottom: 14,
            textShadow: '3px 3px 0 rgba(0,0,0,0.45)',
          }}
        >
          UNDER THE HOOD
        </div>
        {stats.map(([num, label], i) => {
          const o = interpolate(frame, [4 + i * 11, 15 + i * 11], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          const rise = interpolate(frame, [4 + i * 11, 15 + i * 11], [16, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <div
              key={label}
              style={{
                opacity: o,
                transform: `translateY(${rise}px)`,
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'center',
                gap: 28,
                margin: '38px 0',
              }}
            >
              <span style={{ color: COLORS.lime, fontSize: 52, letterSpacing: 3 }}>{num}</span>
              <span style={{ color: COLORS.dim, fontSize: 26, letterSpacing: 2 }}>{label}</span>
            </div>
          );
        })}
      </div>
      {/* Closing line */}
      <div style={{ position: 'absolute', opacity: oClose, transform: `scale(${closeZoom})` }}>
        <div style={{ color: COLORS.teal, fontSize: 22, letterSpacing: 2, lineHeight: 1.9 }}>
          same repo. same family.
          <br />
          14 months of AI progress.
        </div>
        <div
          style={{
            marginTop: 42,
            color: COLORS.orange,
            fontSize: 44,
            letterSpacing: 3,
            lineHeight: 1.6,
            textShadow: '5px 5px 0 rgba(0,0,0,0.45)',
          }}
        >
          look how far
          <br />
          models have come.
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 26,
          width: '100%',
          textAlign: 'center',
          color: COLORS.dim,
          fontSize: 13,
          letterSpacing: 2,
          opacity: 0.7 * oClose,
        }}
      >
        real gameplay · real game audio · made with Remotion
      </div>
    </AbsoluteFill>
  );
};
