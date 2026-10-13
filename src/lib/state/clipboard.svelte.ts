// Copy, cut, paste and duplicate. Copied elements are kept here; their images are
// shared through `images`. Text is also put on the system clipboard.
import { readImage, readText } from '@tauri-apps/plugin-clipboard-manager';
import { tick } from 'svelte';
import { isEditableTarget } from '$lib/dom';
import type { LabelElement, Point, TextElement } from '$lib/types';
import { commit, deleteSelection, editor, editors, snapshot, stopEditing } from './editor.svelte';
import { addTextBox, nextId, readImageFile } from './elements';
import { clampSelection, groupOrigin, moveElement } from './geometry';
import { help } from './help.svelte';
import { output } from './output.svelte';

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

// The image on the system clipboard as a PNG file, or null if there's none. Read through
// Tauri: webviews only hand clipboard images to a paste event.
async function clipboardImage(): Promise<File | null> {
  let image;
  try {
    image = await readImage();
  } catch {
    return null; // no image on the clipboard
  }
  try {
    const [{ width, height }, rgba] = await Promise.all([image.size(), image.rgba()]);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    return blob && new File([blob], 'clipboard.png', { type: 'image/png' });
  } finally {
    image.close();
  }
}

// The text on the system clipboard ('' if there's none)
export async function clipboardText(): Promise<string> {
  try {
    return await readText();
  } catch {
    return '';
  }
}

// Menu paste has no clipboard event, so it reads the system clipboard itself, in the same
// order as Ctrl+V: an image, our own elements, then text. From the context menu, `at` is
// where on the label it goes.
export async function pasteFromMenu(at?: Point) {
  const image = await clipboardImage();
  if (image) {
    readImageFile(image, at);
    return;
  }
  const text = await clipboardText();
  if (copied.length > 0 && (text === copiedText || !text.trim())) {
    pasteElements(at);
  } else if (text.trim()) {
    addTextBox(text);
  }
}
