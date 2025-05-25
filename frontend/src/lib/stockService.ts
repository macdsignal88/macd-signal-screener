import { TimeFrame } from './types';

// Get available timeframes
export const getTimeFrames = (): TimeFrame[] => {
  return ['1d', '3d','5d', '1wk', '2wk', '1mo', '3mo',];
};


