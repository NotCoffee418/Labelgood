// Adding, arranging and rotating elements
import { tick } from 'svelte';
import { BOX_INSET, MIN_ELEMENT_SIZE, PX_PER_MM } from '#lib/constants.ts';
import { escapeHtml } from '#lib/richtext.ts';
import type { Point } from '#lib/types.ts';
import { editor, history, images, startEditing, stopEditing } from './editor.svelte';
import { clampElements, clampSelection, elementBounds, insertPosition, printableArea, renderedSize } from './geometry';
import { status } from './status.svelte';

export function nextId() {
  return Math.max(0, ...editor.elements.map(el => el.id)) + 1;
}

// Start the sample box with the restored default formatting, at the margins. Only on
// an untouched document: the page re-runs this when it hot-reloads during development.
export function initSampleBox() {
  const sample = editor.elements[0];
  if (editor.elements.length !== 1 || sample.kind !== 'text' || history.canUndo || history.canRedo) return;
  sample.style = { ...editor.defaultStyle };
  const area = printableArea(BOX_INSET);
  sample.x = Math.round(area.minX);
  sample.y = Math.round(area.minY);
}

// Adds a text box; with `text` (e.g. pasted) it's just placed, otherwise it opens for typing
export function addTextBox(text?: string) {
  const id = nextId();
  editor.elements.push({
    kind: 'text', id, ...insertPosition(BOX_INSET), w: null, h: null,
    html: text !== undefined ? escapeHtml(text) : 'New Text', style: { ...editor.defaultStyle },
  });
  stopEditing();
  if (text !== undefined) {
    editor.selectedIds = [id];
    tick().then(() => clampElements(editor.elements.filter(el => el.id === id)));
  } else {
    startEditing(id);
  }
}

export function addLine() {
  stopEditing();
  const area = printableArea(0);
  const id = nextId();
  const length = Math.min(30 * PX_PER_MM, area.maxX - area.minX);
  const { x, y } = insertPosition(0);
  const midY = Math.round(Math.min(y + (area.maxY - area.minY) / 2, area.maxY));
  const { stroke, color } = editor.defaultShape;
  editor.elements.push({ kind: 'line', id, x1: x, y1: midY, x2: Math.round(x + length), y2: midY, stroke, color });
  editor.selectedIds = [id];
}

export function addRect() {
  stopEditing();
  const area = printableArea(0);
  const id = nextId();
  const size = Math.round(Math.max(MIN_ELEMENT_SIZE, Math.min(10 * PX_PER_MM, area.maxX - area.minX, area.maxY - area.minY)));
  editor.elements.push({ kind: 'rect', id, ...insertPosition(0), w: size, h: size, ...editor.defaultShape });
  editor.selectedIds = [id];
}

// Inserts an image file; with `at` (a label position, e.g. where it was dropped) it's centred there
export function readImageFile(file: File, at?: Point) {
  const reader = new FileReader();
  reader.onload = () => {
    const src = reader.result as string;
    // Only image data is kept (opening a label checks the same)
    if (!src.startsWith('data:image/')) {
      status.message = { text: `Couldn't read ${file.name} as an image.`, error: true };
      return;
    }
    const img = new Image();
    img.onload = () => insertImage(src, img.naturalWidth, img.naturalHeight, at);
    img.onerror = () => status.message = { text: `Couldn't read ${file.name} as an image.`, error: true };
    img.src = src;
  };
  reader.readAsDataURL(file);
}

const UNSIZED_IMAGE = 100; // px, for images without a size of their own (some SVGs)

function insertImage(src: string, naturalWidth: number, naturalHeight: number, at?: Point) {
  stopEditing();
  naturalWidth ||= UNSIZED_IMAGE;
  naturalHeight ||= UNSIZED_IMAGE;
  const imageId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  images.set(imageId, { src, width: naturalWidth, height: naturalHeight });
  // Fit inside the printable area, keeping the image's proportions
  const area = printableArea(0);
  const scale = Math.min(1, (area.maxX - area.minX) / naturalWidth, (area.maxY - area.minY) / naturalHeight);
  const w = Math.max(MIN_ELEMENT_SIZE, Math.round(naturalWidth * scale));
  const h = Math.max(MIN_ELEMENT_SIZE, Math.round(naturalHeight * scale));
  const pos = at ? { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2) } : insertPosition(0);
  const id = nextId();
  editor.elements.push({ kind: 'image', id, ...pos, w, h, imageId });
  editor.selectedIds = [id];
  if (at) clampSelection();
}

// Restores an image's original proportions, keeping its width
export function resetImageRatio() {
  const el = editor.selectedImage;
  const info = el && images.get(el.imageId);
  if (!el || !info) return;
  el.h = Math.round(el.w * info.height / info.width);
}

export function selectAll() {
  stopEditing();
  editor.selectedIds = editor.elements.map(el => el.id);
}

export function bringToFront() {
  editor.elements = [...editor.elements.filter(el => !editor.selectedIds.includes(el.id)), ...editor.selectedElements];
}

export function sendToBack() {
  editor.elements = [...editor.selectedElements, ...editor.elements.filter(el => !editor.selectedIds.includes(el.id))];
}

// Rotates the selection a quarter turn around its centre: positions turn with it,
// text boxes and images turn, rectangles swap width/height, lines turn their ends
export function rotateSelection(direction: 1 | -1) {
  stopEditing();
  const els = editor.selectedElements;
  if (els.length === 0) return;
  const boxes = els.map(elementBounds);
  const cx = (Math.min(...boxes.map(b => b.x)) + Math.max(...boxes.map(b => b.x + b.w))) / 2;
  const cy = (Math.min(...boxes.map(b => b.y)) + Math.max(...boxes.map(b => b.y + b.h))) / 2;
  // Clockwise in screen coordinates (y points down) for direction 1
  const turn = (x: number, y: number) => direction === 1
    ? { x: cx - (y - cy), y: cy + (x - cx) }
    : { x: cx + (y - cy), y: cy - (x - cx) };

  for (const el of els) {
    if (el.kind === 'line') {
      const a = turn(el.x1, el.y1);
      const b = turn(el.x2, el.y2);
      el.x1 = Math.round(a.x); el.y1 = Math.round(a.y);
      el.x2 = Math.round(b.x); el.y2 = Math.round(b.y);
      continue;
    }
    const { w, h } = renderedSize(el);
    const centre = turn(el.x + w / 2, el.y + h / 2);
    if (el.kind === 'rect') {
      [el.w, el.h] = [el.h, el.w];
      el.x = Math.round(centre.x - el.w / 2);
      el.y = Math.round(centre.y - el.h / 2);
    } else {
      // Rotated around their own centre, so the layout box keeps its size
      el.rotation = ((el.rotation ?? 0) + 90 * direction + 360) % 360;
      el.x = Math.round(centre.x - w / 2);
      el.y = Math.round(centre.y - h / 2);
    }
  }
  tick().then(clampSelection);
}
