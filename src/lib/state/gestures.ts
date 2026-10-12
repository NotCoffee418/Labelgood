// Mouse interaction on the canvas: selecting, moving, resizing, panning and the context menu
import { MIN_ELEMENT_SIZE, PX_PER_MM } from '$lib/constants';
import { clampLength } from '$lib/formats';
import type { LabelElement, LineElement } from '$lib/types';
import { canvas, pointer } from './canvas.svelte';
import { commit, deselect, editor, nodes, snapshot, startEditing, stopEditing } from './editor.svelte';
import { dragArea, elementBounds, groupDelta, lengthForBounds, lengthItem, moveGroup, renderedSize, rotationOf } from './geometry';
import { label } from './label.svelte';

// Lines snap to horizontal/vertical within this angle unless Shift is held
const LINE_SNAP_TOLERANCE = Math.tan(5 * Math.PI / 180);

// Mousedown on the label is prevented (to stop native drag/selection), which also stops
// focus moving. Release focus from sidebar/toolbar controls so keyboard shortcuts apply.
function releaseControlFocus() {
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body && !canvas.labelEl?.contains(active)) {
    active.blur();
  }
}

// ---- Elements ----

export function handleElementMouseDown(event: MouseEvent, el: LabelElement) {
  if (event.button !== 0) return;
  releaseControlFocus();
  const target = event.target as HTMLElement;
  if (target.closest('.handle')) return;
  // Let the user select text inside the box being edited
  if (editor.editingBoxId === el.id && target.closest('.text-box-content')) return;

  if (editor.editingBoxId !== el.id) {
    stopEditing();
  }
  event.preventDefault();

  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    // Toggle in/out of the selection; no drag
    editor.selectedIds = editor.selectedIds.includes(el.id)
      ? editor.selectedIds.filter(id => id !== el.id)
      : [...editor.selectedIds, el.id];
    return;
  }
  // Clicking the selected element again (or Alt+click) selects what's beneath it on release
  const soleSelected = editor.selectedIds.length === 1 && editor.selectedIds[0] === el.id;
  pointer.clickThrough = soleSelected || event.altKey ? { id: el.id, x: event.clientX, y: event.clientY } : null;
  // Clicking an element that's part of a multi-selection drags the whole group
  if (!editor.selectedIds.includes(el.id)) {
    editor.selectedIds = [el.id];
  }
  const origs = snapshot(editor.selectedElements);
  pointer.drag = {
    startX: event.clientX,
    startY: event.clientY,
    origs,
    bounds: origs.map(elementBounds),
    areas: origs.map(dragArea),
    all: editor.elements.map(e => lengthItem(e, editor.selectedIds.includes(e.id))),
  };
  pointer.dragOffset = { x: 0, y: 0 };
  pointer.dragging = true;
}

export function startElementResize(event: MouseEvent, el: LabelElement, sx: -1 | 0 | 1, sy: -1 | 0 | 1) {
  if (event.button !== 0 || el.kind === 'line') return;
  event.preventDefault();
  event.stopPropagation();
  const { w, h } = renderedSize(el, MIN_ELEMENT_SIZE);
  pointer.resize = {
    id: el.id, sx, sy,
    startX: event.clientX, startY: event.clientY,
    x0: el.x, y0: el.y, w0: w, h0: h,
  };
}

// Resizing is free-form for every element; Shift keeps the starting proportions, Ctrl makes it square
function applyResize(clientX: number, clientY: number, keepRatio: boolean, square: boolean) {
  if (!pointer.resize) return;
  const r = pointer.resize;
  const el = editor.elements.find(e => e.id === r.id);
  if (!el || el.kind === 'line') return;

  // Pointer movement in the element's own (unrotated) axes
  const angle = rotationOf(el) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const sdx = (clientX - r.startX) / canvas.zoom;
  const sdy = (clientY - r.startY) / canvas.zoom;
  const ldx = sdx * cos + sdy * sin;
  const ldy = -sdx * sin + sdy * cos;

  let w = r.sx ? Math.max(MIN_ELEMENT_SIZE, r.w0 + r.sx * ldx) : r.w0;
  let h = r.sy ? Math.max(MIN_ELEMENT_SIZE, r.h0 + r.sy * ldy) : r.h0;
  if (square) {
    const side = r.sx && r.sy ? Math.max(w, h) : r.sx ? w : h;
    w = h = side;
  } else if (keepRatio) {
    const scale = r.sx && r.sy ? Math.max(w / r.w0, h / r.h0) : r.sx ? w / r.w0 : h / r.h0;
    w = r.w0 * scale;
    h = r.h0 * scale;
  }

  // Anchor the opposite edge; an axis without a handle grows from the centre.
  // Work out the centre's shift in the element's axes, then rotate it onto the screen.
  const lcx = r.sx * (w - r.w0) / 2;
  const lcy = r.sy * (h - r.h0) / 2;
  const cx = r.x0 + r.w0 / 2 + lcx * cos - lcy * sin;
  const cy = r.y0 + r.h0 / 2 + lcx * sin + lcy * cos;
  el.x = Math.round(cx - w / 2);
  el.y = Math.round(cy - h / 2);
  if (el.kind === 'text') {
    // Only fix the dimensions actually being dragged, so auto width keeps working
    if (r.sx) el.w = Math.round(w);
    if (r.sy) el.h = Math.round(h);
  } else {
    el.w = Math.round(w);
    el.h = Math.round(h);
  }
}

export function startEndpointDrag(event: MouseEvent, el: LineElement, end: 1 | 2) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  pointer.endpointDrag = { id: el.id, end };
}

// Moves one end of a line, snapping to horizontal/vertical unless Shift is held
function applyEndpoint(clientX: number, clientY: number, free: boolean) {
  if (!pointer.endpointDrag || !canvas.labelEl) return;
  const { id, end } = pointer.endpointDrag;
  const el = editor.elements.find(e => e.id === id);
  if (!el || el.kind !== 'line') return;
  const rect = canvas.labelEl.getBoundingClientRect();
  let x = (clientX - rect.left) / canvas.zoom;
  let y = (clientY - rect.top) / canvas.zoom;
  const ox = end === 1 ? el.x2 : el.x1;
  const oy = end === 1 ? el.y2 : el.y1;
  if (!free) {
    if (Math.abs(y - oy) <= Math.abs(x - ox) * LINE_SNAP_TOLERANCE) y = oy;
    else if (Math.abs(x - ox) <= Math.abs(y - oy) * LINE_SNAP_TOLERANCE) x = ox;
  }
  x = Math.round(Math.max(0, Math.min(x, canvas.labelEl.clientWidth)));
  y = Math.round(Math.max(0, Math.min(y, canvas.labelEl.clientHeight)));
  if (end === 1) {
    el.x1 = x; el.y1 = y;
  } else {
    el.x2 = x; el.y2 = y;
  }
}

// Pressing or releasing Shift/Ctrl mid-resize updates the preview right away
export function refreshGestureForModifiers(event: KeyboardEvent) {
  if (!pointer.lastPointer) return;
  if (pointer.resize) applyResize(pointer.lastPointer.x, pointer.lastPointer.y, event.shiftKey, event.ctrlKey || event.metaKey);
  if (pointer.endpointDrag) applyEndpoint(pointer.lastPointer.x, pointer.lastPointer.y, event.shiftKey);
}

// ---- Continuous label length ----

export function startLabelResize(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  pointer.resizingLabel = true;
  pointer.resizeStartPos = { x: event.clientX, y: event.clientY };
  pointer.resizeStartDimension = label.continuousWidth ? label.actualWidth : label.actualHeight;
}

// ---- Canvas ----

export function handleCanvasMouseDown(event: MouseEvent) {
  releaseControlFocus();
  canvas.contextMenu = null;
  if (event.button === 1) {
    // Middle mouse button pans
    event.preventDefault();
    pointer.pan = {
      startX: event.clientX, startY: event.clientY,
      scrollLeft: canvas.viewport.scrollLeft, scrollTop: canvas.viewport.scrollTop,
    };
    return;
  }
  if (event.button !== 0) return;
  if ((event.target as HTMLElement).closest('.element, .handle, .resize-handle')) return;
  // Empty space: deselect (unless adding) and start a selection rectangle
  event.preventDefault();
  const additive = event.shiftKey || event.ctrlKey || event.metaKey;
  if (!additive) deselect();
  else stopEditing();
  pointer.marquee = { x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY, additive };
}

// Selects every element touching the selection rectangle
function finishMarquee() {
  if (!pointer.marquee) return;
  const m = pointer.marquee;
  pointer.marquee = null;
  const left = Math.min(m.x0, m.x1), right = Math.max(m.x0, m.x1);
  const top = Math.min(m.y0, m.y1), bottom = Math.max(m.y0, m.y1);
  if (right - left < 3 && bottom - top < 3) return; // just a click
  const hits = editor.elements.filter(el => {
    const node = el.kind === 'line'
      ? canvas.labelEl.querySelector<HTMLElement>(`[data-element-id="${el.id}"]`)
      : nodes.get(el.id);
    if (!node) return false;
    const r = node.getBoundingClientRect();
    return r.left <= right && r.right >= left && r.top <= bottom && r.bottom >= top;
  }).map(el => el.id);
  editor.selectedIds = m.additive ? [...new Set([...editor.selectedIds, ...hits])] : hits;
}

// Elements under a screen point, topmost first (skips hollow shape interiors)
function elementsAt(clientX: number, clientY: number): LabelElement[] {
  const ids = new Set<number>();
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    const owner = (node as HTMLElement).closest?.<HTMLElement>('[data-element-id]');
    if (owner && canvas.labelEl.contains(owner)) ids.add(Number(owner.dataset.elementId));
  }
  return [...ids].map(id => editor.elements.find(el => el.id === id)).filter((el): el is LabelElement => !!el);
}

// Selects the next element below `id` at a point, wrapping back to the top
function selectBeneath(id: number, clientX: number, clientY: number) {
  const stack = elementsAt(clientX, clientY);
  if (stack.length < 2) return;
  const index = stack.findIndex(el => el.id === id);
  editor.selectedIds = [stack[(index + 1) % stack.length].id];
}

// Double-click edits a text box under the cursor, even beneath other elements
export function handleCanvasDblClick(event: MouseEvent) {
  const { selected } = editor;
  const inSelected = selected?.kind === 'text' && elementsAt(event.clientX, event.clientY).some(el => el.id === selected.id);
  const target = inSelected ? selected : elementsAt(event.clientX, event.clientY).find(el => el.kind === 'text');
  if (target && editor.editingBoxId !== target.id) startEditing(target.id, event);
}

export function handleContextMenu(event: MouseEvent) {
  const target = event.target as HTMLElement;
  // Keep the normal text menu while editing text
  if (target.closest('[contenteditable="true"]')) return;
  event.preventDefault();
  const elementNode = target.closest<HTMLElement>('[data-element-id]');
  if (elementNode) {
    const id = Number(elementNode.dataset.elementId);
    if (!editor.selectedIds.includes(id)) {
      stopEditing();
      editor.selectedIds = [id];
    }
  } else {
    deselect();
  }
  const rect = canvas.labelEl.getBoundingClientRect();
  canvas.contextMenu = {
    x: event.clientX,
    y: event.clientY,
    labelX: (event.clientX - rect.left) / canvas.zoom,
    labelY: (event.clientY - rect.top) / canvas.zoom,
  };
}

// ---- Moving and releasing (window-wide, so gestures continue outside the canvas) ----

// Mice can report far more moves than the screen shows; apply at most one per frame
let pendingMove: MouseEvent | null = null;

export function handleGlobalMouseMove(event: MouseEvent) {
  pointer.lastPointer = { x: event.clientX, y: event.clientY };
  if (!(pointer.resizingLabel || pointer.resize || pointer.endpointDrag || pointer.drag || pointer.marquee || pointer.pan)) return;
  const scheduled = pendingMove !== null;
  pendingMove = event;
  if (!scheduled) {
    requestAnimationFrame(() => {
      const latest = pendingMove;
      pendingMove = null;
      if (latest) applyPointerMove(latest);
    });
  }
}

function applyPointerMove(event: MouseEvent) {
  const { drag, marquee, pan } = pointer;
  if (pointer.resizingLabel) {
    // Change in pixels along the handle's axis, converted to whole millimetres
    const deltaPx = label.resizeEdge === 'right'
      ? event.clientX - pointer.resizeStartPos.x
      : event.clientY - pointer.resizeStartPos.y;
    const newDimension = clampLength(Math.round(pointer.resizeStartDimension + deltaPx / canvas.zoom / PX_PER_MM));
    if (label.continuousWidth) {
      label.width = newDimension;
    } else if (label.continuousHeight) {
      label.height = newDimension;
    }
  } else if (pointer.resize) {
    applyResize(event.clientX, event.clientY, event.shiftKey, event.ctrlKey || event.metaKey);
  } else if (pointer.endpointDrag) {
    applyEndpoint(event.clientX, event.clientY, event.shiftKey);
  } else if (drag) {
    // Only the visual offset changes while dragging (no layout); positions update on release
    pointer.dragOffset = groupDelta(drag.bounds, drag.areas, (event.clientX - drag.startX) / canvas.zoom, (event.clientY - drag.startY) / canvas.zoom);
    if (label.resizeEdge) label.contentLength = lengthForBounds(drag.all, pointer.dragOffset);
  } else if (marquee) {
    marquee.x1 = event.clientX;
    marquee.y1 = event.clientY;
  } else if (pan) {
    canvas.viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    canvas.viewport.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  }
}

export function handleMouseUp(event: MouseEvent) {
  // Apply a move still waiting for the next frame, so the drop lands where the mouse is
  if (pendingMove) {
    applyPointerMove(pendingMove);
    pendingMove = null;
  }
  // The modifiers held on release decide the final shape
  if (pointer.resize) applyResize(event.clientX, event.clientY, event.shiftKey, event.ctrlKey || event.metaKey);
  if (pointer.endpointDrag) applyEndpoint(event.clientX, event.clientY, event.shiftKey);
  const { clickThrough, drag, dragOffset } = pointer;
  const isClick = clickThrough !== null && Math.hypot(event.clientX - clickThrough.x, event.clientY - clickThrough.y) < 3;
  if (drag && !isClick && (dragOffset.x !== 0 || dragOffset.y !== 0)) {
    moveGroup(drag.origs, dragOffset.x, dragOffset.y);
  }
  pointer.dragOffset = { x: 0, y: 0 };
  if (isClick && clickThrough) {
    selectBeneath(clickThrough.id, event.clientX, event.clientY);
  }
  pointer.clickThrough = null;
  finishMarquee();
  pointer.pan = null;
  pointer.drag = null;
  pointer.dragging = false;
  pointer.resize = null;
  pointer.endpointDrag = null;
  pointer.resizingLabel = false;
  commit();
}
