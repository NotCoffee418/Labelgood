// Crash recovery. While the label has unsaved changes, a copy is kept in the app's data
// folder (see src-tauri/src/recovery.rs), a few seconds after the last change. Saving,
// opening, starting a new label, or discarding changes removes it. If Labelgood ends
// without either (a crash, power loss, a killed process), the next start offers it back.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import {
  type RecoveryEntry, recoveryClear, recoveryDiscard, recoveryDiscardAll, recoveryList, recoveryRead, recoveryWrite,
} from '$lib/commands';
import { fileContents, fileName, labelDocument, restoreDocument, settleUnsavedChanges } from './document.svelte';
import { editor } from './editor.svelte';
import { status } from './status.svelte';

const COPY_DELAY = 3000; // ms after the last change

class Recovery {
  entries = $state<RecoveryEntry[]>([]); // what can be recovered, most recent first
}

export const recovery = new Recovery();

export const entryName = (entry: RecoveryEntry) => entry.path ? fileName(entry.path) : 'Untitled';
export const entryTime = (entry: RecoveryEntry) =>
  new Date(entry.saved_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// Writes and removals of this window's copy run in order, so a removal can't be
// overtaken by a write that started before it
let queue: Promise<unknown> = Promise.resolve();
let hasCopy = false;
let closing = false;

function updateCopy() {
  queue = queue.then(async () => {
    if (closing) return;
    try {
      if (labelDocument.dirty) {
        await recoveryWrite(fileContents(), labelDocument.path);
        hasCopy = true;
      } else if (hasCopy) {
        await recoveryClear();
        hasCopy = false;
      }
    } catch (error) {
      console.error('Updating the recovery copy failed:', error);
    }
  });
}

// Keeps the copy up to date with unsaved changes. Call during component initialisation.
export function trackRecovery() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void editor.documentJson; // every change restarts the delay
    const dirty = labelDocument.dirty;
    clearTimeout(timer);
    if (dirty) timer = setTimeout(updateCopy, COPY_DELAY);
    else updateCopy(); // saved or discarded: remove the copy straight away
    return () => clearTimeout(timer);
  });

  // Closing the window: Auto Save or the save prompt settles unsaved changes first.
  // Once they're saved or deliberately discarded, the copy goes too.
  $effect(() => {
    let unlisten: (() => void) | undefined;
    let stopped = false;
    try {
      getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (!(await settleUnsavedChanges())) {
            event.preventDefault();
            return;
          }
          closing = true;
          clearTimeout(timer);
          await queue;
          await recoveryClear().catch(() => {});
        })
        .then(fn => stopped ? fn() : unlisten = fn)
        .catch(() => {});
    } catch {} // getCurrentWindow throws outside Tauri
    return () => {
      stopped = true;
      unlisten?.();
    };
  });
}

export async function refreshRecovery() {
  try {
    recovery.entries = await recoveryList();
  } catch {
    recovery.entries = [];
  }
}

// Opens a recovered label in this window
export async function restoreRecovery(entry: RecoveryEntry) {
  if (!(await settleUnsavedChanges())) return;
  try {
    restoreDocument(await recoveryRead(entry.id), entry.path);
  } catch (error) {
    status.message = { text: error instanceof Error ? error.message : String(error), error: true };
    await refreshRecovery();
    return;
  }
  // It's this window's unsaved label now, with its own copy
  await recoveryDiscard(entry.id).catch(() => {});
  await refreshRecovery();
  const saving = labelDocument.autoSave && entry.path ? '' : ' Save it to keep them.';
  status.message = { text: `Restored unsaved changes to ${entryName(entry)}.${saving}`, error: false };
}

export async function discardAllRecovery() {
  const count = recovery.entries.length;
  const answer = await message(
    `Throw away the unsaved changes in ${count === 1 ? entryName(recovery.entries[0]) : `${count} labels`}? This can't be undone.`,
    { title: 'Discard Recovered Labels', kind: 'warning', buttons: { ok: 'Discard', cancel: 'Cancel' } },
  );
  if (answer !== 'Discard' && answer !== 'Ok') return;
  try {
    await recoveryDiscardAll();
  } catch (error) {
    status.message = { text: String(error), error: true };
  }
  await refreshRecovery();
}

// At startup: offers back unsaved work from Labelgood windows that ended without saving it
export async function offerRecovery() {
  await refreshRecovery();
  const [latest, ...others] = recovery.entries;
  if (!latest) return;
  const what = others.length === 0
    ? `${entryName(latest)} (${entryTime(latest)})`
    : `${others.length + 1} labels. The most recent is ${entryName(latest)} (${entryTime(latest)})`;
  const answer = await message(
    `Labelgood closed without saving changes to ${what}.\n\n` +
    `Restore opens it here. Later keeps it under File > Recover Unsaved Labels.` +
    (others.length > 0 ? ' Discard throws all of them away.' : ''),
    { title: 'Recover Unsaved Labels', kind: 'warning', buttons: { yes: 'Restore', no: 'Discard', cancel: 'Later' } },
  );
  if (answer === 'Restore' || answer === 'Yes') {
    await restoreRecovery(latest);
  } else if (answer === 'Discard' || answer === 'No') {
    await recoveryDiscardAll().catch(error => status.message = { text: String(error), error: true });
    await refreshRecovery();
  }
}
