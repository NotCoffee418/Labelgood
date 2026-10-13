import { tick } from 'svelte';
import { caretRangeAt, type RangeStyle } from '#lib/richtext.ts';
import type { LabelElement, LineElement, RectElement, ShapeStyle, TextElement, TextStyle } from '#lib/types.ts';
import { isChangingDocument } from './canvas.svelte';
import { History } from './history.svelte';
import { label } from './label.svelte';

const INITIAL_STYLE: TextStyle = {
  fontFamily: 'sans-serif',
  fontSize: 12,
  color: '#000000',
  bold: false,
  italic: false,
  underline: false,
  align: 'left',
};

// The label's elements, the selection and text editing
class Editor {
  elements = $state<LabelElement[]>([
    { kind: 'text', id: 1, x: 0, y: 0, w: null, h: null, html: 'Sample Label Text', style: { ...INITIAL_STYLE } }
  ]);

  // Formatting applied to new text boxes and shapes
  defaultStyle = $state<TextStyle>({ ...INITIAL_STYLE });
  defaultShape = $state<ShapeStyle>({ stroke: 1, color: '#000000', fill: false });

  selectedIds = $state<number[]>([]);
  editingBoxId = $state<number | null>(null);
  // The text selected inside the box being edited, kept while toolbar controls have focus
  hasTextSelection = $state(false);
  selectionMarks = $state({ bold: false, italic: false, underline: false });
  selectionStyle = $state<RangeStyle | null>(null);
  savedRange: Range | null = null;

  selectedElements = $derived(this.elements.filter(el => this.selectedIds.includes(el.id)));
  // The selected element when exactly one is selected (resize handles, editing)
  selected = $derived(this.selectedElements.length === 1 ? this.selectedElements[0] : null);
  selectedTexts = $derived(this.selectedElements.filter((el): el is TextElement => el.kind === 'text'));
  selectedShapes = $derived(this.selectedElements.filter((el): el is RectElement | LineElement => el.kind === 'rect' || el.kind === 'line'));
  selectedImage = $derived(this.selected?.kind === 'image' ? this.selected : null);
  // Toolbar shows shape controls when only shapes are selected
  shapeToolbar = $derived(this.selectedShapes.length > 0 && this.selectedShapes.length === this.selectedElements.length);

  // What the formatting toolbar changes: the selected text, the selected boxes, or new boxes
  formatScope = $derived<'selection' | 'box' | 'defaults'>(
    this.hasTextSelection && this.editingBoxId !== null ? 'selection' : this.selectedTexts.length > 0 ? 'box' : 'defaults'
  );
  activeStyle = $derived(this.selectedTexts[0]?.style ?? this.defaultStyle);
  activeMarks = $derived(this.formatScope === 'selection' ? this.selectionMarks : this.activeStyle);
  // What the toolbar shows: the selected text's formatting when there is a selection
  displayStyle = $derived(
    this.formatScope === 'selection' && this.selectionStyle ? { ...this.activeStyle, ...this.selectionStyle } : this.activeStyle
  );
  activeShape = $derived<ShapeStyle>(
    this.selectedShapes[0] ? { ...this.defaultShape, ...this.selectedShapes[0] } : this.defaultShape
  );

  // The undoable document. Theme, output and default formatting aren't part of it.
  documentJson = $derived(JSON.stringify({
    elements: this.elements,
    labelFormat: label.format,
    width: label.width,
    height: label.height,
    continuousWidth: label.continuousWidth,
    continuousHeight: label.continuousHeight,
    orientation: label.orientation,
    marginMode: label.marginMode,
    customMargins: label.customMargins,
  }));
}

export const editor = new Editor();

// Inserted images by id. Elements only reference these, which keeps undo snapshots small.
export const images = new Map<string, { src: string; width: number; height: number }>();
export const editors = new Map<number, HTMLElement>(); // text box content elements
export const nodes = new Map<number, HTMLElement>(); // element wrappers

// Plain copies of elements, e.g. to remember where they were before a move
export function snapshot(els: LabelElement[]): LabelElement[] {
  return els.map(el => $state.snapshot(el) as LabelElement);
}

// ---- Undo / redo ----

export const history = new History({
  snapshot: () => editor.documentJson,
  restore,
  busy: () => isChangingDocument() || editor.editingBoxId !== null,
});

export function commit() {
  history.commit();
}

export function undo() {
  stopEditing();
  history.undo();
}

export function redo() {
  stopEditing();
  history.redo();
}

function restore(json: string) {
  const doc = JSON.parse(json);
  editor.elements = doc.elements;
  label.format = doc.labelFormat;
  label.width = doc.width;
  label.height = doc.height;
  label.continuousWidth = doc.continuousWidth;
  label.continuousHeight = doc.continuousHeight;
  label.orientation = doc.orientation;
  label.marginMode = doc.marginMode;
  label.customMargins = doc.customMargins;
  editor.selectedIds = editor.selectedIds.filter(id => editor.elements.some(el => el.id === id));

  // Text box content is only written to the DOM on creation, so sync it here
  tick().then(() => {
    for (const el of editor.elements) {
      const editorNode = el.kind === 'text' ? editors.get(el.id) : undefined;
      if (el.kind === 'text' && editorNode && editorNode.innerHTML !== el.html) {
        editorNode.innerHTML = el.html;
      }
    }
  });
}

// Replaces the whole document (a new or opened label) and starts its undo history over
export function replaceDocument(json: string) {
  editor.editingBoxId = null;
  editor.hasTextSelection = false;
  editor.savedRange = null;
  editor.selectedIds = [];
  restore(json);
  history.reset();
}

// ---- Element registration (actions) ----

// Registers an element's wrapper so its rendered size can be measured
export function registerNode(node: HTMLElement, id: number) {
  nodes.set(id, node);
  return {
    destroy() {
      nodes.delete(id);
    }
  };
}

// Registers a text box's editable element and fills in its initial content
export function registerEditor(node: HTMLElement, box: TextElement) {
  node.innerHTML = box.html;
  editors.set(box.id, node);
  return {
    destroy() {
      editors.delete(box.id);
    }
  };
}

// ---- Text editing ----

export async function startEditing(boxId: number, event?: MouseEvent) {
  editor.selectedIds = [boxId];
  editor.editingBoxId = boxId;
  await tick();
  const el = editors.get(boxId);
  if (!el) return;
  el.focus();
  // Put the caret where the user double-clicked, or select everything
  let range = event ? caretRangeAt(event.clientX, event.clientY) : null;
  if (!range || !el.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(el);
  }
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

// Stores what was typed into a text box
export function updateTextHtml(box: TextElement, html: string) {
  box.html = html;
}

export function stopEditing() {
  if (editor.editingBoxId === null) return;
  const id = editor.editingBoxId;
  const el = editors.get(id);
  editor.editingBoxId = null;
  editor.hasTextSelection = false;
  editor.savedRange = null;
  if (el) {
    el.blur();
    // Drop boxes that were left empty
    if (!el.textContent?.trim()) {
      deleteElements([id]);
    }
  }
  commit();
}

export function deselect() {
  stopEditing();
  editor.selectedIds = [];
}

export function deleteElements(ids: number[]) {
  editor.elements = editor.elements.filter(el => !ids.includes(el.id));
  editor.selectedIds = editor.selectedIds.filter(id => !ids.includes(id));
  if (editor.editingBoxId !== null && ids.includes(editor.editingBoxId)) {
    editor.editingBoxId = null;
    editor.hasTextSelection = false;
    editor.savedRange = null;
  }
}

export function deleteSelection() {
  deleteElements([...editor.selectedIds]);
}
