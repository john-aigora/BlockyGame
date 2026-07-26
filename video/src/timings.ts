// Film timeline + clip trims, all in seconds. The trims are hand-picked per
// take from src/events/*.json (event timestamps are clip-relative), so the
// windows below are guaranteed to contain the moments the sfx land on.
export const FPS = 30;
export const sec = (s: number) => Math.round(s * FPS);

// Where each gameplay window starts inside its source webm.
export const TRIMS = {
  original: 12.8, // collect @14.1, enemy drama @20.6
  classic: 8.35, // kills @8.73 / 15.11 / 19.70, milestone @11.79
  endless: 6.6, // collect @7.62, jump @7.80, land @8.69, collects @13.66 / 17.83
  splitOriginal: 13.0,
  splitEndless: 12.0,
};

// Segment durations (X cut: ~55s total).
export const SEGS = {
  hook: 3,
  era: 2,
  original: 10,
  inter: 2,
  classic: 12,
  endless: 12,
  split: 8,
  outro: 6,
};

export const TOTAL_SEC =
  SEGS.hook + SEGS.era + SEGS.original + SEGS.inter + SEGS.classic + SEGS.endless + SEGS.split + SEGS.outro;
export const TOTAL_FRAMES = sec(TOTAL_SEC);

// Segment start times (seconds).
export const START = (() => {
  let at = 0;
  const s: Record<string, number> = {};
  for (const k of ['hook', 'era', 'original', 'inter', 'classic', 'endless', 'split', 'outro'] as const) {
    s[k] = at;
    at += SEGS[k];
  }
  return s as { hook: number; era: number; original: number; inter: number; classic: number; endless: number; split: number; outro: number };
})();
