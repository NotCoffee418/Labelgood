// Printing and saving as PDF
import { dirname, join } from '@tauri-apps/api/path';
import { save } from '@tauri-apps/plugin-dialog';
import { generatePdf, getPrinterOptions, listPrinters } from '$lib/commands';
import { renderLabelPng } from '$lib/render';
import type { PrinterOption } from '$lib/types';
import { canvas } from './canvas.svelte';
import { stopEditing } from './editor.svelte';
import { label } from './label.svelte';
import { status } from './status.svelte';

// Set from the label itself
const HIDDEN_PRINT_OPTIONS = ['PageSize'];

class Output {
  printers = $state<string[]>([]);
  selectedPrinter = $state<string>('');
  copies = $state(1);
  // Print option choices per printer, remembered between runs
  printChoices = $state<Record<string, Record<string, string>>>({});
  lastSaveDir = $state<string | null>(null);
  busy = $state(false);

  printDialog = $state<{ preview: string } | null>(null);
  printerOptions = $state<PrinterOption[] | null>(null); // null while loading
  printerOptionsError = $state<string | null>(null);
  printing = $state(false);
  printError = $state<string | null>(null);

  visiblePrintOptions = $derived(
    (this.printerOptions ?? []).filter(o => !HIDDEN_PRINT_OPTIONS.includes(o.key) && o.choices.length > 1)
  );
}

export const output = new Output();

export const clampCopies = (copies: number) => Math.min(999, Math.max(1, Math.round(copies) || 1));

export async function loadPrinters() {
  try {
    const printerList = await listPrinters();
    output.printers = printerList;
    // Keep the current selection if that printer is still available
    if (!printerList.includes(output.selectedPrinter)) {
      output.selectedPrinter = printerList[0] ?? '';
    }
  } catch (error) {
    console.error('Failed to load printers:', error);
    // Don't show an error to the user, just leave printers empty
  }
}

export async function loadPrinterOptions(printer: string) {
  output.printerOptions = null;
  output.printerOptionsError = null;
  if (!printer) {
    output.printerOptions = [];
    return;
  }
  try {
    const options = await getPrinterOptions(printer);
    if (printer === output.selectedPrinter) output.printerOptions = options;
  } catch (error) {
    if (printer === output.selectedPrinter) {
      output.printerOptions = [];
      output.printerOptionsError = String(error);
    }
  }
}

export async function refreshPrinters() {
  await loadPrinters();
  loadPrinterOptions(output.selectedPrinter);
}

// Media type is remembered separately for continuous and die-cut labels
function choiceKey(option: PrinterOption): string {
  return option.key === 'MediaType' ? `MediaType@${label.isContinuous ? 'continuous' : 'die-cut'}` : option.key;
}

// Option and choice names without their namespace (Windows keys are "uri|name")
const localName = (key: string) => key.slice(key.lastIndexOf('|') + 1);

// Sensible defaults: cut after each label, media type matching the label, and black
// only. Two-colour (black/red) needs a matching roll; on any other roll the printer
// rejects the job, whatever the label's colours.
function suggestedChoice(option: PrinterOption): string | undefined {
  const pick = (value: string) => option.choices.find(choice => localName(choice) === value);
  switch (localName(option.key)) {
    case 'CutMedia': return pick('EndOfPage');
    case 'MediaType': return pick(label.isContinuous ? 'Roll' : 'Labels');
    case 'PageOutputColor': return pick('Monochrome');
    case 'ColorModel': return pick('Gray');
  }
  return undefined;
}

export function choiceFor(option: PrinterOption): string {
  const saved = output.printChoices[output.selectedPrinter]?.[choiceKey(option)];
  if (saved && option.choices.includes(saved)) return saved;
  return suggestedChoice(option) ?? option.default ?? option.choices[0];
}

// Forgets the choices made for the selected printer, back to the defaults above
export function resetPrintChoices() {
  const { [output.selectedPrinter]: _, ...others } = output.printChoices;
  output.printChoices = others;
}

export const hasPrintChoices = () => Object.keys(output.printChoices[output.selectedPrinter] ?? {}).length > 0;

export function setChoice(option: PrinterOption, value: string) {
  const printer = output.selectedPrinter;
  output.printChoices = {
    ...output.printChoices,
    [printer]: { ...output.printChoices[printer], [choiceKey(option)]: value },
  };
}

function renderLabel(): Promise<string> {
  return renderLabelPng(canvas.labelEl, label.actualWidth, label.actualHeight, label.viewRotation === 'rotated');
}

function validateLabelSize(): boolean {
  if (label.actualWidth > 0 && label.actualHeight > 0) return true;
  status.message = { text: 'Enter a valid label width and height.', error: true };
  return false;
}

export async function savePdf() {
  if (output.busy || !canvas.labelEl) return;
  status.message = null;
  stopEditing();
  if (!validateLabelSize()) return;

  output.busy = true;
  try {
    const fileName = `label-${label.actualWidth}x${label.actualHeight}mm.pdf`;
    let outputPath = await save({
      defaultPath: output.lastSaveDir ? await join(output.lastSaveDir, fileName) : fileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!outputPath) return; // cancelled
    if (!outputPath.toLowerCase().endsWith('.pdf')) outputPath += '.pdf';
    output.lastSaveDir = await dirname(outputPath);

    const result = await generatePdf({
      image_data: await renderLabel(),
      width_mm: label.actualWidth,
      height_mm: label.actualHeight,
      printer_name: null,
      output_path: outputPath,
    });
    status.message = { text: result, error: false };
  } catch (error) {
    console.error('Saving PDF failed:', error);
    status.message = { text: String(error), error: true };
  } finally {
    output.busy = false;
  }
}

// Renders the label once; the preview is exactly the image that gets printed
export async function openPrintDialog() {
  if (output.busy || !canvas.labelEl) return;
  status.message = null;
  output.printError = null;
  stopEditing();
  if (!validateLabelSize()) return;

  output.busy = true;
  try {
    await loadPrinters();
    output.printDialog = { preview: await renderLabel() };
    loadPrinterOptions(output.selectedPrinter);
  } catch (error) {
    console.error('Preparing print failed:', error);
    status.message = { text: String(error), error: true };
  } finally {
    output.busy = false;
  }
}

export function closePrintDialog() {
  if (!output.printing) output.printDialog = null;
}

export async function printFromDialog() {
  if (!output.printDialog || !output.selectedPrinter || output.printing) return;
  output.printError = null;
  output.printing = true;
  try {
    const result = await generatePdf({
      image_data: output.printDialog.preview,
      width_mm: label.actualWidth,
      height_mm: label.actualHeight,
      continuous: label.isContinuous,
      printer_name: output.selectedPrinter,
      output_path: null,
      copies: clampCopies(output.copies),
      print_options: Object.fromEntries(output.visiblePrintOptions.map(o => [o.key, choiceFor(o)])),
    });
    status.message = { text: result, error: false };
    output.printDialog = null;
  } catch (error) {
    console.error('Printing failed:', error);
    output.printError = String(error);
  } finally {
    output.printing = false;
  }
}
