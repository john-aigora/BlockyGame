// Film timeline + clip trims, all in seconds. The trims are hand-picked per
// take from src/events/*.json (event timestamps are clip-relative), so the
// windows below are guaranteed to contain the moments the sfx land on.
export const FPS = 30;
export const sec = (s: number) => Math.round(s * FPS);

// Where each gameplay window starts inside its source webm.
export const TRIMS = {
  original: 12.8, // collect @14.1, enemy drama @20.6
  classic: 8.35, // (clip unwired from the cut) kills @8.73 / 15.11 / 19.70
  // Staged kill take (owner's brief): jump @7.4-8.25, yellow-prey KILL @12.11
  // (+30 popup, milestone, collects 12.1-12.4), lake/shore walk after. The
  // 11s window 4.2-15.2 runs vista -> jump -> chase -> kill -> shoreline.
  endless: 4.2,
  splitOriginal: 13.0,
  splitEndless: 13.0, // post-kill shore/lake, so the split never replays the kill
};

// Segment durations (short X cut: ~36s total).
// Owner's recut (July 2026): the classic 2026 clip and both codebase screens
// (stats card + file-tree diff) are cut from the timeline — the 2026 era is
// the endless world-view clip alone, and the outro is just the closing line.
// The CodeDiff/stats components stay in cards.tsx (unwired, may return).
export const SEGS = {
  hook: 3,
  era: 2,
  original: 5, // trimmed 10 -> 7 -> 5: the silent 2025 clip dragged (X pacing), reach 2026 faster
  inter: 2,
  endless: 11, // the 2026 money shot: vista / curve / jump, kept in full
  split: 8,
  outro: 5, // closing line only (stats beat cut)
};

export const TOTAL_SEC =
  SEGS.hook + SEGS.era + SEGS.original + SEGS.inter + SEGS.endless + SEGS.split + SEGS.outro;
export const TOTAL_FRAMES = sec(TOTAL_SEC);

// Segment start times (seconds).
export const START = (() => {
  let at = 0;
  const s: Record<string, number> = {};
  for (const k of ['hook', 'era', 'original', 'inter', 'endless', 'split', 'outro'] as const) {
    s[k] = at;
    at += SEGS[k];
  }
  return s as { hook: number; era: number; original: number; inter: number; endless: number; split: number; outro: number };
})();
