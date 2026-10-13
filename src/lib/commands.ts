// Typed wrappers for the Rust commands in src-tauri/src/lib.rs
import { invoke } from '@tauri-apps/api/core';
import type { PrinterOption } from './types';

export const listPrinters = () => invoke<string[]>('list_printers');

// A printer's driver options (cutting, quality, media type, ...)
export const getPrinterOptions = (printer: string) => invoke<PrinterOption[]>('printer_options', { printer });

export const listFonts = () => invoke<string[]>('list_fonts');

// What the generic font families resolve to on this system
export const getDefaultFonts = () =>
  invoke<{ sans_serif: string | null; serif: string | null; monospace: string | null }>('default_fonts');

export type PdfOptions = {
  image_data: string; // PNG data URL at print resolution, in print orientation
  width_mm: number;
  height_mm: number;
  continuous?: boolean; // on a continuous roll rather than die-cut
  printer_name: string | null; // print to this printer...
  output_path: string | null; // ...or save the PDF here
  copies?: number;
  print_options?: Record<string, string>; // driver options, keyed as reported by getPrinterOptions
};

// Label files (.labelgood): the document as JSON
export const saveDocument = (path: string, contents: string) => invoke<void>('save_document', { path, contents });
export const openDocument = (path: string) => invoke<string>('open_document', { path });
// An image file dropped onto the window, as raw bytes
export const readImageBytes = (path: string) => invoke<ArrayBuffer>('read_image_file', { path });

// The label file the app was started with, if any (only reported once)
export const openedFile = () => invoke<string | null>('opened_file');

// Crash recovery copies of unsaved labels (see src-tauri/src/recovery.rs)
export type RecoveryEntry = {
  id: string;
  path: string | null; // the label's file, if it had been saved before
  saved_at: number; // ms since the Unix epoch
};
export const recoveryWrite = (contents: string, path: string | null) => invoke<void>('recovery_write', { contents, path });
export const recoveryClear = () => invoke<void>('recovery_clear');
// Unsaved work from Labelgood windows that have ended, most recent first
export const recoveryList = () => invoke<RecoveryEntry[]>('recovery_list');
export const recoveryRead = (id: string) => invoke<string>('recovery_read', { id });
export const recoveryDiscard = (id: string) => invoke<void>('recovery_discard', { id });
export const recoveryDiscardAll = () => invoke<void>('recovery_discard_all');

// Prints the label or saves it as a PDF; resolves to a message for the user
export const generatePdf = (options: PdfOptions) => invoke<string>('generate_pdf', { options });
