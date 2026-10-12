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
  printer_name: string | null; // print to this printer...
  output_path: string | null; // ...or save the PDF here
  copies?: number;
  print_options?: Record<string, string>; // driver options, keyed as reported by getPrinterOptions
};

// Prints the label or saves it as a PDF; resolves to a message for the user
export const generatePdf = (options: PdfOptions) => invoke<string>('generate_pdf', { options });
