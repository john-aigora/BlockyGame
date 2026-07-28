import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { BG_GRADIENT, COLORS, FONT } from './theme';

// The opening hook doubles as the X thumbnail: frame 0 is FULLY composed
// (zero fade-in) — split composite of both eras + giant title + labels —
// then the whole card animates apart into the film.
//
// Stills are 1920x1080 page screenshots from the recording sessions; the
// crop below isolates the game canvas region.
const CROP = { x: 180, y: 66, w: 1555, h: 864 };
const PANEL_W = 860;
const S = PANEL_W / CROP.w;
const PANEL_H = Math.round(CROP.h * S); // ~478

const Panel: React.FC<{
  still: string;
  x: number;
  slide: number;
  date: string;
  model: string;
  accent: string;
}> = ({ still, x, slide, date, model, accent }) => (
  <div style={{ position: 'absolute', left: x, top: 110, transform: `translateX(${slide}px)` }}>
    <div
      style={{
        width: PANEL_W,
        height: PANEL_H,
        overflow: 'hidden',
        borderRadius: 14,
        border: `4px solid ${accent}`,
        boxShadow: '8px 8px 0 rgba(0,0,0,0.4)',
        background: '#1D282D',
      }}
    >
      <Img
        src={staticFile(still)}
        style={{
          width: 1920,
          height: 1080,
          transform: `scale(${S}) translate(${-CROP.x}px, ${-CROP.y}px)`,
          transformOrigin: '0 0',
        }}
      />
    </div>
    <div style={{ marginTop: 24, width: PANEL_W, textAlign: 'center', fontFamily: FONT }}>
      <div style={{ color: COLORS.ink, fontSize: 32, letterSpacing: 3, textShadow: '3px 3px 0 rgba(0,0,0,0.45)' }}>
        {date}
      </div>
      <div style={{ marginTop: 12, color: accent, fontSize: 19, letterSpacing: 1.5 }}>{model}</div>
    </div>
  </div>
);

export const Hook: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const holdEnd = 40; // composed hold (thumbnail beat)
  const out = (from: number, to: number) =>
    interpolate(frame, [holdEnd, duration - 6], [from, to], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.in(Easing.cubic),
    });
  const breathe = interpolate(frame, [0, holdEnd], [1, 1.015], {
    extrapolateRight: 'clamp',
  });
  const titleFade = interpolate(frame, [holdEnd + 8, duration - 12], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ background: BG_GRADIENT, fontFamily: FONT }}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${breathe})` }}>
        <Panel
          still="still-2025.png"
          x={44}
          slide={out(0, -1040)}
          date="MAY 10, 2025"
          model="Cursor + Claude 3.7 Sonnet"
          accent={COLORS.teal}
        />
        <Panel
          still="still-2026.png"
          x={1016}
          slide={out(0, 1040)}
          date="JULY 26, 2026"
          model="Claude Fable 5"
          accent={COLORS.orange}
        />
        {/* Giant title, lower third — this is what reads at thumbnail size */}
        <div
          style={{
            position: 'absolute',
            top: 762,
            width: '100%',
            textAlign: 'center',
            opacity: titleFade,
            transform: `translateY(${out(0, -60)}px)`,
            color: COLORS.orange,
            fontSize: 92,
            letterSpacing: 6,
            textShadow: '7px 7px 0 rgba(0,0,0,0.5)',
          }}
        >
          SAME GAME.
        </div>
        <div
          style={{
            position: 'absolute',
            top: 906,
            width: '100%',
            textAlign: 'center',
            opacity: titleFade,
            transform: `translateY(${out(0, 60)}px)`,
            color: COLORS.yellow,
            fontSize: 56,
            letterSpacing: 5,
            textShadow: '5px 5px 0 rgba(0,0,0,0.5)',
          }}
        >
          14 MONTHS APART.
        </div>
      </div>
    </AbsoluteFill>
  );
};
