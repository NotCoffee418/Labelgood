// The formatting toolbar: text styles (per selection or per box) and shape styles
import { clearInlineFormat, formatRange, styleAtRange } from '#lib/richtext.ts';
import type { ShapeStyle, TextElement, TextStyle } from '#lib/types.ts';
import { editor, editors } from './editor.svelte';

// Tracks the text selected in the box being edited, so the toolbar can show and format it
export function handleSelectionChange() {
  if (editor.editingBoxId === null) return;
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  // Ignore selection moving elsewhere (e.g. into a toolbar input) so it can still be formatted
  if (!el || el.closest('.text-box-content') !== editors.get(editor.editingBoxId)) return;

  if (sel.isCollapsed) {
    editor.savedRange = null;
    editor.hasTextSelection = false;
  } else {
    editor.savedRange = sel.getRangeAt(0).cloneRange();
    editor.hasTextSelection = true;
    editor.selectionStyle = styleAtRange(editor.savedRange);
    editor.selectionMarks = {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
    };
  }
}

function applyToSelection(box: TextElement, key: keyof TextStyle, value: TextStyle[keyof TextStyle]) {
  const el = editors.get(box.id);
  if (!el || !editor.savedRange) return;
  formatRange(el, editor.savedRange, key, value);
  box.html = el.innerHTML;
  handleSelectionChange();
}

export function applyFormat<K extends keyof TextStyle>(key: K, value: TextStyle[K]) {
  const { selected } = editor;
  // Alignment always applies to the whole box
  if (editor.formatScope === 'selection' && selected?.kind === 'text' && key !== 'align') {
    applyToSelection(selected, key, value);
  } else if (editor.selectedTexts.length > 0) {
    for (const box of editor.selectedTexts) {
      box.style[key] = value;
      const el = editors.get(box.id);
      if (el) {
        clearInlineFormat(el, key);
        box.html = el.innerHTML;
      }
    }
  } else {
    editor.defaultStyle[key] = value;
  }
}

export function toggleFormat(key: 'bold' | 'italic' | 'underline') {
  applyFormat(key, !editor.activeMarks[key]);
}

export function applyShape<K extends keyof ShapeStyle>(key: K, value: ShapeStyle[K]) {
  editor.defaultShape[key] = value;
  for (const el of editor.selectedShapes) {
    if (key === 'fill' && el.kind !== 'rect') continue;
    (el as ShapeStyle)[key] = value;
  }
}
