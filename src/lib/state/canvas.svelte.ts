import { tick } from 'svelte';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, PX_PER_MM } from '$lib/constants';
import type { Area, Bounds, LabelElement, Point } from '$lib/types';
import { label } from './label.svelte';

// The editing area: zoom, its DOM elements and the context menu
class Canvas {
  zoom = $state(DEFAULT_ZOOM);
  // Slider position (0-1000) on a logarithmic scale, so each step feels the same
  zoomSlider = $derived(Math.round(1000 * Math.log(this.zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)));

  // The label element, which is what gets captured for printing
  labelEl!: HTMLDivElement;
  // The scrolling area around the label
  viewport!: HTMLDivElement;

  contextMenu = $state<{ x: number; y: number; labelX: number; labelY: number } | null>(null);
}

export const canvas = new Canvas();

// The mouse gesture in progress on the canvas (handled in gestures.ts)
class Pointer {
  dragging = $state(false);
  // Sizes and limits are measured once when a drag starts, so moving needs no page measuring
  drag: {
    startX: number;
    startY: number;
    origs: LabelElement[];
    bounds: Bounds[];
    areas: Area[];
    // every element, for the continuous label length while dragging
    all: { b: Bounds; inset: number; moving: boolean }[];
  } | null = null;
  // Visual offset of the dragged elements; their positions are updated on release
  dragOffset = $state({ x: 0, y: 0 });
  // A click (no drag) on an already selected element selects the one beneath it
  clickThrough: { id: number; x: number; y: number } | null = null;

  marquee = $state<{ x0: number; y0: number; x1: number; y1: number; additive: boolean } | null>(null);
  pan = $state<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);

  resize: {
    id: number; sx: -1 | 0 | 1; sy: -1 | 0 | 1;
    startX: number; startY: number; x0: number; y0: number; w0: number; h0: number;
  } | null = null;
  endpointDrag: { id: number; end: 1 | 2 } | null = null;

  // Dragging the cut edge of a continuous label
  resizingLabel = $state(false);
  resizeStartPos = { x: 0, y: 0 };
  resizeStartDimension = 0;

  lastPointer: Point | null = null;
}

export const pointer = new Pointer();

// Whether a gesture that changes the document is in progress
export function isChangingDocument(): boolean {
  return !!(pointer.drag || pointer.resize || pointer.endpointDrag || pointer.resizingLabel);
}

// Zooms keeping the point under the cursor (or the view centre) in place
export function setZoom(value: number, clientX?: number, clientY?: number) {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  if (next === canvas.zoom || !canvas.viewport || !canvas.labelEl) {
    canvas.zoom = next;
    return;
  }
  const view = canvas.viewport.getBoundingClientRect();
  const px = clientX ?? view.left + view.width / 2;
  const py = clientY ?? view.top + view.height / 2;
  const labelRect = canvas.labelEl.getBoundingClientRect();
  const lx = (px - labelRect.left) / canvas.zoom;
  const ly = (py - labelRect.top) / canvas.zoom;
  canvas.zoom = next;
  tick().then(() => {
    const moved = canvas.labelEl.getBoundingClientRect();
    canvas.viewport.scrollLeft += moved.left + lx * next - px;
    canvas.viewport.scrollTop += moved.top + ly * next - py;
  });
}

export function zoomToFit() {
  const padding = 48;
  const fit = Math.min(
    (canvas.viewport.clientWidth - padding * 2) / (label.renderWidth * PX_PER_MM),
    (canvas.viewport.clientHeight - padding * 2) / (label.renderHeight * PX_PER_MM),
  );
  setZoom(fit);
}

export function zoomFromSlider(value: number) {
  setZoom(MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, value / 1000));
}
