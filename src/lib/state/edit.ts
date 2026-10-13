// Edit menu commands: they act on the text being edited, or else on the selected elements.
// Menu items keep the text box focused (see MenuBar), so the text commands reach it.
import { copySelection, cutSelection, duplicateSelection, pasteFromMenu } from './clipboard.svelte';
import { commit, deleteSelection, editor, redo, undo } from './editor.svelte';
import { selectAll } from './elements';
import { status } from './status.svelte';

export const editingText = () => editor.editingBoxId !== null;

export function editUndo() {
  if (editingText()) document.execCommand('undo');
  else undo();
}

export function editRedo() {
  if (editingText()) document.execCommand('redo');
  else redo();
}

export function editCut() {
  if (editingText()) document.execCommand('cut');
  else cutSelection();
}

export function editCopy() {
  if (editingText()) document.execCommand('copy');
  else copySelection();
}

export async function editPaste() {
  if (!editingText()) {
    pasteFromMenu();
    return;
  }
  try {
    document.execCommand('insertText', false, await navigator.clipboard.readText());
  } catch {
    status.message = { text: 'Use Ctrl+V to paste from other apps.', error: true };
  }
}

export function editDuplicate() {
  duplicateSelection();
}

export function editDelete() {
  if (editingText()) {
    document.execCommand('delete');
  } else {
    deleteSelection();
    commit();
  }
}

export function editSelectAll() {
  if (editingText()) document.execCommand('selectAll');
  else selectAll();
}
