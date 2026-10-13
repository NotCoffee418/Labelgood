// The open label file: new, open, save, and keeping unsaved changes from being lost.
//
// A .labelgood file is JSON:
//   { format: "labelgood", version: FILE_VERSION, label: { size, orientation, margins },
//     elements: [...], images: { [imageId]: { src (data URL), width, height } } }
// Element positions and sizes are px (96 per inch) on the label as displayed, as in the editor.
import { dirname, join } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message, open, save } from '@tauri-apps/plugin-dialog';
import { openDocument, openedFile, saveDocument } from '#lib/commands.ts';
import type { LabelElement } from '#lib/types.ts';
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
const ORIENTATIONS = ['landscape', 'portrait'];
const MARGIN_MODES = ['default', 'none', 'custom'];
const MAX_RECENT = 8;
const AUTO_SAVE_DELAY = 2000; // ms after the last change

type ImageInfo = { src: string; width: number; height: number };

class LabelDocument {
  path = $state<string | null>(null);
  // The document as last saved, opened or started; anything else is unsaved
  savedJson = $state<string | null>(null);
  lastDir = $state<string | null>(null); // where labels were last opened or saved, remembered between runs
  recent = $state<string[]>([]); // recently opened or saved labels, newest first, remembered between runs
  // Save labels that have a file shortly after each change (remembered between runs). Labels
  // without a file yet are covered by crash recovery instead (see recovery.svelte.ts).
  autoSave = $state(true);

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

export function fileContents(): string {
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

  const fileImages: Record<string, ImageInfo> = {};
  for (const [id, info] of Object.entries(file.images ?? {}) as [string, ImageInfo][]) {
    if (typeof info?.src === 'string' && isNumber(info.width) && isNumber(info.height)) fileImages[id] = info;
  }
  const elements = readElements(file.elements, fileImages);
  for (const [id, info] of Object.entries(fileImages)) images.set(id, info);

  // Anything the file doesn't say (or says wrong) keeps the current setting
  const l = file.label ?? {};
  const size = (value: unknown, current: number) => isNumber(value) && value > 0 ? value : current;
  const flag = (value: unknown, current: boolean) => typeof value === 'boolean' ? value : current;
  const margins = { ...label.customMargins };
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (isNumber(l.customMargins?.[side]) && l.customMargins[side] >= 0) margins[side] = l.customMargins[side];
  }
  replaceDocument(JSON.stringify({
    elements,
    labelFormat: typeof l.format === 'string' ? l.format : label.format,
    width: size(l.width, label.width),
    height: size(l.height, label.height),
    continuousWidth: flag(l.continuousWidth, label.continuousWidth),
    continuousHeight: flag(l.continuousHeight, label.continuousHeight),
    orientation: ORIENTATIONS.includes(l.orientation) ? l.orientation : label.orientation,
    marginMode: MARGIN_MODES.includes(l.marginMode) ? l.marginMode : label.marginMode,
    customMargins: margins,
  }));
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

// A file's elements, checked enough that a damaged or hand-edited file can't break the
// editor: incomplete elements are left out, missing styles fall back to the defaults, and
// ids are renumbered so they're unique
function readElements(raw: unknown[], fileImages: Record<string, ImageInfo>): LabelElement[] {
  const elements: LabelElement[] = [];
  for (const el of raw as any[]) {
    if (!el || typeof el !== 'object') continue;
    const id = elements.length + 1;
    const placed = isNumber(el.x) && isNumber(el.y);
    const sized = isNumber(el.w) && isNumber(el.h);
    const rotation = isNumber(el.rotation) ? { rotation: el.rotation } : {};
    const { stroke, color, fill } = editor.defaultShape;
    switch (el.kind) {
      case 'text':
        if (!placed || typeof el.html !== 'string') continue;
        elements.push({
          kind: 'text', id, x: el.x, y: el.y, w: isNumber(el.w) ? el.w : null, h: isNumber(el.h) ? el.h : null,
          html: el.html, style: { ...editor.defaultStyle, ...(typeof el.style === 'object' ? el.style : {}) }, ...rotation,
        });
        break;
      case 'rect':
        if (!placed || !sized) continue;
        elements.push({
          kind: 'rect', id, x: el.x, y: el.y, w: el.w, h: el.h,
          stroke: isNumber(el.stroke) ? el.stroke : stroke, color: typeof el.color === 'string' ? el.color : color,
          fill: typeof el.fill === 'boolean' ? el.fill : fill,
        });
        break;
      case 'image':
        if (!placed || !sized || !fileImages[el.imageId]) continue;
        elements.push({ kind: 'image', id, x: el.x, y: el.y, w: el.w, h: el.h, imageId: el.imageId, ...rotation });
        break;
      case 'line':
        if (![el.x1, el.y1, el.x2, el.y2].every(isNumber)) continue;
        elements.push({
          kind: 'line', id, x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
          stroke: isNumber(el.stroke) ? el.stroke : stroke, color: typeof el.color === 'string' ? el.color : color,
        });
        break;
    }
  }
  return elements;
}

// Before the label is closed or replaced: saves it if Auto Save covers it, else asks what
// to do with unsaved changes. False when the user cancels (or the save fails).
export async function settleUnsavedChanges(): Promise<boolean> {
  if (!labelDocument.dirty) return true;
  if (labelDocument.autoSave && labelDocument.path && await writeTo(labelDocument.path, true)) return true;
  const answer = await message(`Save changes to ${labelDocument.name}?`, {
    title: 'Unsaved changes',
    kind: 'warning',
    buttons: { yes: 'Save', no: "Don't Save", cancel: 'Cancel' },
  });
  if (answer === 'Save' || answer === 'Yes') return saveLabel();
  return answer === "Don't Save" || answer === 'No';
}

// Saves run one at a time, so an auto save and a manual one never write at once
let saving: Promise<unknown> = Promise.resolve();

// Saves the label to `path`. `quiet` (auto save) only reports failures.
function writeTo(path: string, quiet = false): Promise<boolean> {
  const result = saving.then(async () => {
    // An auto save that waited behind another save may be out of date: the label may
    // have been saved already, or saved as (or replaced by) another file
    if (quiet && (labelDocument.path !== path || !labelDocument.dirty)) return true;
    const json = editor.documentJson;
    try {
      await saveDocument(path, fileContents());
    } catch (error) {
      status.message = { text: quiet ? `Auto Save failed: ${error}` : String(error), error: true };
      return false;
    }
    labelDocument.path = path;
    labelDocument.savedJson = json;
    labelDocument.lastDir = await dirname(path);
    addRecent(path);
    if (!quiet) status.message = { text: `Saved ${labelDocument.name}`, error: false };
    return true;
  });
  saving = result;
  return result;
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

// Puts a recovered label (see recovery.svelte.ts) in the editor. It stays unsaved: it's
// newer than its file, if it has one, until that's saved again.
export function restoreDocument(text: string, path: string | null) {
  loadFile(text);
  labelDocument.path = path;
  labelDocument.savedJson = '';
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

// The window title shows the file name, with a dot for unsaved changes.
// Call during component initialisation.
export function trackDocumentWindow() {
  $effect(() => {
    const title = `${labelDocument.dirty ? '• ' : ''}${labelDocument.name} – Labelgood`;
    try {
      getCurrentWindow().setTitle(title).catch(() => {});
    } catch {} // getCurrentWindow throws outside Tauri
  });
}

// Auto Save: a label with a file is saved once changes have settled.
// Call during component initialisation.
export function trackAutoSave() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void editor.documentJson; // every change restarts the delay
    const due = labelDocument.autoSave && labelDocument.dirty && labelDocument.path !== null;
    clearTimeout(timer);
    if (due) {
      timer = setTimeout(() => {
        const { path } = labelDocument;
        if (labelDocument.autoSave && labelDocument.dirty && path) writeTo(path, true);
      }, AUTO_SAVE_DELAY);
    }
    return () => clearTimeout(timer);
  });
}
