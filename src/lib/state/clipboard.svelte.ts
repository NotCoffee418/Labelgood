// Copy, cut, paste and duplicate. Copied elements are kept here; their images are
// shared through `images`. Text is also put on the system clipboard.
import { tick } from 'svelte';
import { isEditableTarget } from '$lib/dom';
import type { LabelElement, Point, TextElement } from '$lib/types';
import { commit, deleteSelection, editor, editors, snapshot, stopEditing } from './editor.svelte';
import { addTextBox, nextId, readImageFile } from './elements';
import { clampSelection, groupOrigin, moveElement } from './geometry';
import { help } from './help.svelte';
import { output } from './output.svelte';
import { status } from './status.svelte';

const PASTE_OFFSET = 10; // px between repeated pastes

let copied: LabelElement[] = [];
let copiedText = ''; // what we put on the system clipboard, to recognise our own pastes
let pasteCount = 0;

function plainText(el: TextElement): string {
  return editors.get(el.id)?.innerText ?? el.html.replace(/<[^>]*>/g, '');
}

async function writeClipboardText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for webviews without the async clipboard API
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

// Copies the selected elements; text boxes also put their text on the system clipboard
export function copySelection() {
  if (editor.selectedElements.length === 0) return;
  copied = snapshot(editor.selectedElements);
  pasteCount = 0;
  copiedText = editor.selectedTexts.map(plainText).join('\n');
  writeClipboardText(copiedText);
}

export function cutSelection() {
  copySelection();
  deleteSelection();
  commit();
}

// Inserts copies of `sources`, moved by (dx, dy) and kept inside the margins
function insertCopies(sources: LabelElement[], dx: number, dy: number) {
  stopEditing();
  let id = nextId();
  const copies = sources.map(src => {
    const copy = structuredClone($state.snapshot(src)) as LabelElement;
    copy.id = id++;
    moveElement(copy, src, dx, dy);
    return copy;
  });
  editor.elements.push(...copies);
  editor.selectedIds = copies.map(c => c.id);
  tick().then(() => {
    clampSelection();
    commit();
  });
}

// Pastes copied elements, at a label position (context menu) or offset from the originals
function pasteElements(at?: Point) {
  if (copied.length === 0) return;
  pasteCount++;
  if (at) {
    const origin = groupOrigin(copied);
    insertCopies(copied, Math.round(at.x - origin.x), Math.round(at.y - origin.y));
  } else {
    insertCopies(copied, PASTE_OFFSET * pasteCount, PASTE_OFFSET * pasteCount);
  }
}

export function duplicateSelection() {
  if (editor.selectedElements.length === 0) return;
  insertCopies(snapshot(editor.selectedElements), PASTE_OFFSET, PASTE_OFFSET);
}

// Ctrl+V outside text fields: our own elements, an image, or text as a new text box
export function handleDocumentPaste(event: ClipboardEvent) {
  if (output.printDialog || help.open) return;
  if (isEditableTarget(event.target)) return;
  event.preventDefault();
  const data = event.clipboardData;
  const image = Array.from(data?.files ?? []).find(f => f.type.startsWith('image/'));
  if (image) {
    readImageFile(image);
    return;
  }
  const text = data?.getData('text/plain') ?? '';
  if (copied.length > 0 && text === copiedText) {
    pasteElements();
  } else if (text.trim()) {
    addTextBox(text);
  } else {
    pasteElements();
  }
}

// Context menu paste has no clipboard event: use our elements, else try the system text
export async function pasteFromMenu(at: Point) {
  if (copied.length > 0) {
    pasteElements(at);
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (text.trim()) addTextBox(text);
  } catch {
    status.message = { text: 'Use Ctrl+V to paste from other apps.', error: true };
  }
}
