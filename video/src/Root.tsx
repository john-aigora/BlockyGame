import React from 'react';
import { Composition } from 'remotion';
import { Comparison } from './Comparison';
import { TOTAL_FRAMES } from './timings';

export const Root: React.FC = () => {
  return (
    <Composition
      id="comparison-v2"
      component={Comparison}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
