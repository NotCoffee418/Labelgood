export type Align = 'left' | 'center' | 'right';

export type TextStyle = {
  fontFamily: string;
  fontSize: number; // pt
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: Align; // applies to the whole box
};

export type ShapeStyle = {
  stroke: number; // pt
  color: string;
  fill: boolean; // rectangles only
};

// Positions and sizes are in px, relative to the label as displayed
export type TextElement = {
  kind: 'text';
  id: number;
  x: number;
  y: number;
  w: number | null; // null = fit the text
  h: number | null; // minimum height; grows with the text
  html: string;
  style: TextStyle;
  rotation?: number; // degrees clockwise, multiples of 90
};
export type RectElement = { kind: 'rect'; id: number; x: number; y: number; w: number; h: number } & ShapeStyle;
export type ImageElement = { kind: 'image'; id: number; x: number; y: number; w: number; h: number; imageId: string; rotation?: number };
export type LineElement = {
  kind: 'line';
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: number;
  color: string;
};
export type LabelElement = TextElement | RectElement | ImageElement | LineElement;
// Elements laid out as a box (everything except lines)
export type BoxElement = Exclude<LabelElement, LineElement>;

export type LabelFormat = {
  id: string;
  name: string;
  width: number; // mm across the roll
  height: number | null; // mm along the feed, null for continuous rolls
};

export type Margins = { top: number; right: number; bottom: number; left: number };
export type MarginMode = 'default' | 'none' | 'custom';
export type Orientation = 'landscape' | 'portrait';
export type Theme = 'system' | 'light' | 'dark';

// A printer driver option, as reported by the print system (CUPS on Linux, Print Schema on Windows)
export type PrinterOption = { key: string; label: string; choices: string[]; choice_labels: string[]; default: string | null };

export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; w: number; h: number };
export type Area = { minX: number; minY: number; maxX: number; maxY: number };
