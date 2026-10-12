// Keyboard shortcuts
import { isEditableTarget } from '$lib/dom';
import { canvas, pointer } from './canvas.svelte';
import { copySelection, cutSelection, duplicateSelection } from './clipboard.svelte';
import { deleteSelection, editor, redo, snapshot, startEditing, stopEditing, undo } from './editor.svelte';
import { rotateSelection, selectAll } from './elements';
import { moveGroup } from './geometry';
import { refreshGestureForShift } from './gestures';
import { closePrintDialog, openPrintDialog, output } from './output.svelte';

export function handleKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  // The print dialog is modal
  if (output.printDialog) {
    if (event.key === 'Escape') closePrintDialog();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
    event.preventDefault();
    openPrintDialog();
    return;
  }
  if (event.key === 'Shift' && (pointer.resize || pointer.endpointDrag)) {
    refreshGestureForShift(true);
    return;
  }

  // Text fields keep their own undo; everywhere else it's the document's
  const inTextField = !!target.closest('textarea, [contenteditable="true"], input[type="text"], input[type="search"]');
  if ((event.ctrlKey || event.metaKey) && !inTextField) {
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
      return;
    }
    if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    // Clipboard shortcuts act on elements, except while a form field has focus
    if (!target.closest('input, select')) {
      const hasSelection = editor.selectedIds.length > 0;
      if (key === 'c' && hasSelection) { event.preventDefault(); copySelection(); return; }
      if (key === 'x' && hasSelection) { event.preventDefault(); cutSelection(); return; }
      if (key === 'd' && hasSelection) { event.preventDefault(); duplicateSelection(); return; }
      if (key === 'a') { event.preventDefault(); selectAll(); return; }
      // Ctrl+V is handled by the paste event, which carries the clipboard contents
    }
  }

  if (event.key === 'Escape') {
    if (canvas.contextMenu) canvas.contextMenu = null;
    else if (editor.editingBoxId !== null) stopEditing();
    else editor.selectedIds = [];
    return;
  }
  // Other shortcuts only apply to selected elements that aren't being edited
  if (editor.selectedIds.length === 0 || editor.editingBoxId !== null) return;
  if (isEditableTarget(target) || target.closest('select')) return;

  const step = event.shiftKey ? 10 : 1;
  const nudge = (dx: number, dy: number) => moveGroup(snapshot(editor.selectedElements), dx, dy);
  switch (event.key) {
    case 'Delete':
    case 'Backspace':
      deleteSelection();
      break;
    case 'Enter':
      if (editor.selected?.kind !== 'text') return;
      startEditing(editor.selected.id);
      break;
    case 'r':
    case 'R':
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      rotateSelection(event.shiftKey ? -1 : 1);
      break;
    case 'ArrowLeft': nudge(-step, 0); break;
    case 'ArrowRight': nudge(step, 0); break;
    case 'ArrowUp': nudge(0, -step); break;
    case 'ArrowDown': nudge(0, step); break;
    default: return;
  }
  event.preventDefault();
}

export function handleKeyUp(event: KeyboardEvent) {
  if (event.key === 'Shift') refreshGestureForShift(false);
}
