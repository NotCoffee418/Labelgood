import type { LabelFormat } from './types';

// Common label printer media (62 mm wide label printers such as the Brother QL-800 series)
export const LABEL_FORMATS: { group: string; formats: LabelFormat[] }[] = [
  {
    group: 'Continuous roll',
    formats: [
      { id: 'c62', name: '62 mm continuous', width: 62, height: null },
      { id: 'c50', name: '50 mm continuous', width: 50, height: null },
      { id: 'c38', name: '38 mm continuous', width: 38, height: null },
      { id: 'c29', name: '29 mm continuous', width: 29, height: null },
      { id: 'c12', name: '12 mm continuous', width: 12, height: null },
    ],
  },
  {
    group: 'Die-cut labels',
    formats: [
      { id: 'd62x100', name: '62 × 100 mm – shipping', width: 62, height: 100 },
      { id: 'd62x29', name: '62 × 29 mm – small address', width: 62, height: 29 },
      { id: 'd29x90', name: '29 × 90 mm – address', width: 29, height: 90 },
      { id: 'd38x90', name: '38 × 90 mm – large address', width: 38, height: 90 },
      { id: 'd17x87', name: '17 × 87 mm – file folder', width: 17, height: 87 },
      { id: 'd17x54', name: '17 × 54 mm – multi-purpose', width: 17, height: 54 },
      { id: 'd23x23', name: '23 × 23 mm – square', width: 23, height: 23 },
    ],
  },
];
export const ALL_FORMATS = LABEL_FORMATS.flatMap(g => g.formats);

// Continuous label length limits (Brother QL-800 series: 12.7 mm to 1 m)
export const MIN_LENGTH_MM = 12.7;
export const MAX_LENGTH_MM = 1000;

export const clampLength = (mm: number) => Math.min(MAX_LENGTH_MM, Math.max(MIN_LENGTH_MM, Number(mm) || MIN_LENGTH_MM));

// Label printers can't print right up to the media edge: typically ~1.5 mm on
// each side across the roll and ~3 mm at each end along the feed.
export const DEFAULT_MARGIN_SIDES = 1.5;
export const DEFAULT_MARGIN_ENDS = 3;
