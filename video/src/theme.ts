import { loadFont } from '@remotion/google-fonts/PressStart2P';

const { fontFamily } = loadFont();

export const FONT = `'${fontFamily}', 'Courier New', monospace`;

export const COLORS = {
  bgTop: '#263238',
  bgBottom: '#004D40',
  orange: '#FF4500',
  lime: '#AEEA00',
  yellow: '#FFEB3B',
  teal: '#4DB6AC',
  ink: '#ECEFF1',
  dim: '#90A4AE',
};

export const BG_GRADIENT = `linear-gradient(180deg, ${COLORS.bgTop} 0%, #1E3A34 55%, ${COLORS.bgBottom} 100%)`;
