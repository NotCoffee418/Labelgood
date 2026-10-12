// Element positions and sizes on the label, and keeping elements inside the margins
import { BOX_INSET, PX_PER_MM } from '$lib/constants';
import type { Area, Bounds, BoxElement, LabelElement, Point } from '$lib/types';
import { canvas } from './canvas.svelte';
import { editor, nodes, snapshot } from './editor.svelte';
import { label } from './label.svelte';

// An element's extent along a continuous label (see lengthForBounds)
export type LengthItem = { b: Bounds; inset: number; moving: boolean };

// Printable area in px. Text boxes may extend past it by their padding, so
// their text (not their outline) lines up with the margins. With `growable`, the
// far end of a continuous label is open: the label lengthens to fit instead.
export function printableArea(inset: number, growable = false): Area {
  const m = label.displayMargins;
  return {
    minX: m.left * PX_PER_MM - inset,
    minY: m.top * PX_PER_MM - inset,
    maxX: growable && label.resizeEdge === 'right' ? Infinity
      : (canvas.labelEl?.clientWidth ?? label.renderWidth * PX_PER_MM) - m.right * PX_PER_MM + inset,
    maxY: growable && label.resizeEdge === 'bottom' ? Infinity
      : (canvas.labelEl?.clientHeight ?? label.renderHeight * PX_PER_MM) - m.bottom * PX_PER_MM + inset,
  };
}

// Text boxes may overlap the margins by their padding (see BOX_INSET)
export function insetOf(el: LabelElement): number {
  return el.kind === 'text' ? BOX_INSET : 0;
}

export function lengthItem(el: LabelElement, moving: boolean): LengthItem {
  return { b: elementBounds(el), inset: insetOf(el), moving };
}

// Length (mm) a continuous label needs so every element stays inside the end margin
export function measureContentLength(): number {
  return lengthForBounds(editor.elements.map(el => lengthItem(el, false)), { x: 0, y: 0 });
}

// Continuous length needed for elements at `items` (moving ones shifted by `offset`)
export function lengthForBounds(items: LengthItem[], offset: Point): number {
  if (!label.resizeEdge || items.length === 0) return 0;
  const alongWidth = label.resizeEdge === 'right';
  let farEdge = 0;
  for (const { b, inset, moving } of items) {
    const end = alongWidth ? b.x + b.w + (moving ? offset.x : 0) : b.y + b.h + (moving ? offset.y : 0);
    farEdge = Math.max(farEdge, end - inset);
  }
  const endMargin = alongWidth ? label.displayMargins.right : label.displayMargins.bottom;
  return Math.ceil(farEdge / PX_PER_MM + endMargin);
}

// Size of an element's layout box as rendered (before rotation)
export function renderedSize(el: BoxElement, fallback = 0): { w: number; h: number } {
  const node = nodes.get(el.id);
  return { w: node?.offsetWidth ?? el.w ?? fallback, h: node?.offsetHeight ?? el.h ?? fallback };
}

// Bounding box of an element in label px
export function elementBounds(el: LabelElement): Bounds {
  if (el.kind === 'line') {
    return { x: Math.min(el.x1, el.x2), y: Math.min(el.y1, el.y2), w: Math.abs(el.x2 - el.x1), h: Math.abs(el.y2 - el.y1) };
  }
  const { w, h } = renderedSize(el);
  if (el.kind !== 'rect' && (el.rotation ?? 0) % 180 !== 0) {
    // Quarter turns swap width and height around the centre
    return { x: el.x + (w - h) / 2, y: el.y + (h - w) / 2, w: h, h: w };
  }
  return { x: el.x, y: el.y, w, h };
}

// Top-left corner of the box around all of `els`
export function groupOrigin(els: LabelElement[]): Point {
  const boxes = els.map(elementBounds);
  return { x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)) };
}

export function rotationOf(el: LabelElement): number {
  return el.kind === 'text' || el.kind === 'image' ? el.rotation ?? 0 : 0;
}

// Where an element may go: its printable area, open at the far end of a continuous label
export function dragArea(el: LabelElement): Area {
  return printableArea(insetOf(el), true);
}

// The move (dx, dy) limited so every element stays inside its area
export function groupDelta(bounds: Bounds[], areas: Area[], dx: number, dy: number): Point {
  let loX = -Infinity, hiX = Infinity, loY = -Infinity, hiY = Infinity;
  bounds.forEach((b, i) => {
    const area = areas[i];
    loX = Math.max(loX, area.minX - b.x); hiX = Math.min(hiX, area.maxX - b.x - b.w);
    loY = Math.max(loY, area.minY - b.y); hiY = Math.min(hiY, area.maxY - b.y - b.h);
  });
  // If the group doesn't fit, pin it to the top-left of the printable area
  return {
    x: Math.round(loX > hiX ? loX : Math.max(loX, Math.min(dx, hiX))),
    y: Math.round(loY > hiY ? loY : Math.max(loY, Math.min(dy, hiY))),
  };
}

// Moves elements together from their original positions, limiting the move so
// the whole group stays inside the margins
export function moveGroup(origs: LabelElement[], dx: number, dy: number) {
  const { x, y } = groupDelta(origs.map(elementBounds), origs.map(dragArea), dx, dy);
  for (const orig of origs) {
    const el = editor.elements.find(e => e.id === orig.id);
    if (el) moveElement(el, orig, x, y);
  }
}

// Keeps the selected elements inside the margins, as a group
export function clampSelection() {
  moveGroup(snapshot(editor.selectedElements), 0, 0);
}

// Keeps each element inside the margins
export function clampElements(els: LabelElement[]) {
  for (const el of els) moveGroup(snapshot([el]), 0, 0);
}

export function moveElement(el: LabelElement, orig: LabelElement, dx: number, dy: number) {
  if (el.kind === 'line' && orig.kind === 'line') {
    el.x1 = orig.x1 + dx; el.x2 = orig.x2 + dx;
    el.y1 = orig.y1 + dy; el.y2 = orig.y2 + dy;
  } else if (el.kind !== 'line' && orig.kind !== 'line') {
    el.x = orig.x + dx;
    el.y = orig.y + dy;
  }
}

// Where a new element goes: the margin corner, staggered so repeated inserts don't stack exactly
export function insertPosition(inset: number): Point {
  const area = printableArea(inset);
  const offset = (editor.elements.length % 5) * 12;
  return { x: Math.round(area.minX) + offset, y: Math.round(area.minY) + offset };
}
