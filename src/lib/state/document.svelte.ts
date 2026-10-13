// The open label file: new, open, save, and keeping unsaved changes from being lost.
//
// A .labelgood file is JSON:
//   { format: "labelgood", version: FILE_VERSION, label: { size, orientation, margins },
//     elements: [...], images: { [imageId]: { src (data URL), width, height } } }
// Element positions and sizes are px (96 per inch) on the label as displayed, as in the editor.
import { dirname, join } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message, open, save } from '@tauri-apps/plugin-dialog';
import { openDocument, openedFile, saveDocument } from '$lib/commands';
import type { LabelElement } from '$lib/types';
import { editor, images, replaceDocument } from './editor.svelte';
import { label } from './label.svelte';
import { status } from './status.svelte';

const FILE_FORMAT = 'labelgood';

// Version of the file format this app writes, saved in every file as `version`.
// It's unrelated to the app's version (that comes from the release tag): it only
// changes when the file format itself does, by hand, in this file.
//
// Files with a higher version than this are refused (see loadFile): they come from a
// newer Labelgood, and reading them here could silently lose or misplace things, and
// saving would then overwrite the newer file with the damage.
//
// When to raise it: when a change means an older Labelgood would misread files written
// by this one, e.g. a field changes meaning or unit, or there's a new element kind or
// setting that changes how the label prints. Purely additive fields that older versions
// can safely ignore don't need a new version.
//
// When raising it, keep reading every older version: upgrade older files to the
// current shape in loadFile, right after the version check.
//
// Still version 1: everything so far is part of the first format.
const FILE_VERSION = 1;
const EXTENSION = 'labelgood';
const FILTERS = [{ name: 'Labelgood label', extensions: [EXTENSION] }];
const ELEMENT_KINDS = ['text', 'rect', 'image', 'line'];
const MAX_RECENT = 8;

type ImageInfo = { src: string; width: number; height: number };

class LabelDocument {
  path = $state<string | null>(null);
  // The document as last saved, opened or started; anything else is unsaved
  savedJson = $state<string | null>(null);
  lastDir = $state<string | null>(null); // where labels were last opened or saved, remembered between runs
  recent = $state<string[]>([]); // recently opened or saved labels, newest first, remembered between runs

  name = $derived(this.path ? fileName(this.path) : 'Untitled');
  dirty = $derived(this.savedJson !== null && editor.documentJson !== this.savedJson);
}

export const labelDocument = new LabelDocument();

export const fileName = (path: string) => path.split(/[\\/]/).pop()!;
export const folderName = (path: string) => path.split(/[\\/]/).slice(-2, -1)[0] ?? '';

// Paths compare without case: Windows paths are case-insensitive, and on Linux two labels
// differing only in case is rare enough not to matter for this list
const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function addRecent(path: string) {
  labelDocument.recent = [path, ...labelDocument.recent.filter(p => !samePath(p, path))].slice(0, MAX_RECENT);
}

function forgetRecent(path: string) {
  labelDocument.recent = labelDocument.recent.filter(p => !samePath(p, path));
}

export function clearRecent() {
  labelDocument.recent = [];
}

// The current document counts as saved. Run once at startup, after settings are restored.
export function markStartingDocument() {
  if (labelDocument.savedJson === null) labelDocument.savedJson = editor.documentJson;
}

function fileContents(): string {
  const used: Record<string, ImageInfo> = {};
  for (const el of editor.elements) {
    const info = el.kind === 'image' ? images.get(el.imageId) : undefined;
    if (el.kind === 'image' && info) used[el.imageId] = info;
  }
  return JSON.stringify({
    format: FILE_FORMAT,
    version: FILE_VERSION,
    label: {
      format: label.format,
      width: label.width,
      height: label.height,
      continuousWidth: label.continuousWidth,
      continuousHeight: label.continuousHeight,
      orientation: label.orientation,
      marginMode: label.marginMode,
      customMargins: label.customMargins,
    },
    elements: editor.elements,
    images: used,
  });
}

// Loads a label file's contents into the editor
function loadFile(text: string) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("This isn't a Labelgood label file.");
  }
  if (file?.format !== FILE_FORMAT || !Array.isArray(file.elements)) {
    throw new Error("This isn't a Labelgood label file.");
  }
  // Every file has a whole-number format version from 1 up (see FILE_VERSION)
  if (!Number.isInteger(file.version) || file.version < 1) {
    throw new Error('This label file is damaged: it has no valid format version.');
  }
  // A newer format can't be read safely by this app: refuse rather than guess
  if (file.version > FILE_VERSION) {
    throw new Error(
      `This label was saved by a newer version of Labelgood (file format ${file.version}; ` +
      `this version reads up to ${FILE_VERSION}). Update Labelgood to open it.`
    );
  }
  // Upgrades from older format versions go here, once there are any
  const fileImages: Record<string, ImageInfo> = file.images ?? {};
  const elements = (file.elements as LabelElement[]).filter(el =>
    ELEMENT_KINDS.includes(el?.kind) && (el.kind !== 'image' || fileImages[el.imageId]?.src)
  );
  for (const [id, info] of Object.entries(fileImages)) images.set(id, info);

  // Anything the file doesn't say keeps the current setting
  const l = file.label ?? {};
  replaceDocument(JSON.stringify({
    elements,
    labelFormat: l.format ?? label.format,
    width: l.width ?? label.width,
    height: l.height ?? label.height,
    continuousWidth: l.continuousWidth ?? label.continuousWidth,
    continuousHeight: l.continuousHeight ?? label.continuousHeight,
    orientation: l.orientation ?? label.orientation,
    marginMode: l.marginMode ?? label.marginMode,
    customMargins: { ...label.customMargins, ...l.customMargins },
  }));
}

// Asks what to do with unsaved changes; false when the user cancels
async function settleUnsavedChanges(): Promise<boolean> {
  if (!labelDocument.dirty) return true;
  const answer = await message(`Save changes to ${labelDocument.name}?`, {
    title: 'Unsaved changes',
    kind: 'warning',
    buttons: { yes: 'Save', no: "Don't Save", cancel: 'Cancel' },
  });
  if (answer === 'Save' || answer === 'Yes') return saveLabel();
  return answer === "Don't Save" || answer === 'No';
}

async function writeTo(path: string): Promise<boolean> {
  const json = editor.documentJson;
  try {
    await saveDocument(path, fileContents());
  } catch (error) {
    status.message = { text: String(error), error: true };
    return false;
  }
  labelDocument.path = path;
  labelDocument.savedJson = json;
  labelDocument.lastDir = await dirname(path);
  addRecent(path);
  status.message = { text: `Saved ${labelDocument.name}`, error: false };
  return true;
}

export async function saveLabel(): Promise<boolean> {
  return labelDocument.path ? writeTo(labelDocument.path) : saveLabelAs();
}

export async function saveLabelAs(): Promise<boolean> {
  const defaultName = labelDocument.path ? labelDocument.name : `label.${EXTENSION}`;
  const dir = labelDocument.path ? await dirname(labelDocument.path) : labelDocument.lastDir;
  let path = await save({ defaultPath: dir ? await join(dir, defaultName) : defaultName, filters: FILTERS });
  if (!path) return false; // cancelled
  if (!path.toLowerCase().endsWith(`.${EXTENSION}`)) path += `.${EXTENSION}`;
  return writeTo(path);
}

// Opens a label: `path`, or a file the user picks
export async function openLabel(path?: string) {
  if (!(await settleUnsavedChanges())) return;
  path ??= await open({ multiple: false, directory: false, filters: FILTERS, defaultPath: labelDocument.lastDir ?? undefined }) ?? undefined;
  if (typeof path !== 'string') return; // cancelled
  let text;
  try {
    text = await openDocument(path);
  } catch (error) {
    forgetRecent(path); // moved or deleted
    status.message = { text: String(error), error: true };
    return;
  }
  try {
    loadFile(text);
  } catch (error) {
    status.message = { text: error instanceof Error ? error.message : String(error), error: true };
    return;
  }
  labelDocument.path = path;
  labelDocument.savedJson = editor.documentJson;
  labelDocument.lastDir = await dirname(path);
  addRecent(path);
  status.message = null;
}

// Opens the file the app was started with (double-clicked or "Open with"), if any
export async function openStartupFile() {
  try {
    const path = await openedFile();
    if (path) await openLabel(path);
  } catch {} // not running in Tauri
}

// An empty label, keeping the current label size, orientation and margins
export async function newLabel() {
  if (!(await settleUnsavedChanges())) return;
  replaceDocument(JSON.stringify({ ...JSON.parse(editor.documentJson), elements: [] }));
  labelDocument.path = null;
  labelDocument.savedJson = editor.documentJson;
  status.message = null;
}

// Window title with the file name, and a save prompt when closing with unsaved changes.
// Call during component initialisation.
export function trackDocumentWindow() {
  $effect(() => {
    const title = `${labelDocument.dirty ? '• ' : ''}${labelDocument.name} – Labelgood`;
    try {
      getCurrentWindow().setTitle(title).catch(() => {});
    } catch {} // getCurrentWindow throws outside Tauri
  });
  $effect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    try {
      getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (!(await settleUnsavedChanges())) event.preventDefault();
        })
        .then(fn => cancelled ? fn() : unlisten = fn)
        .catch(() => {});
    } catch {}
    return () => {
      cancelled = true;
      unlisten?.();
    };
  });
}
