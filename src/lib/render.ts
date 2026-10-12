import html2canvas from 'html2canvas';

const PRINT_DPI = 300;

// Editor chrome that never appears in the output
const EDITOR_ONLY_CLASSES = ['resize-handle', 'handle', 'margin-guide', 'cut-edge'];

// Renders the label element to a PNG data URL at print resolution. The capture is the
// label as displayed; `rotated` turns it back to the label's real orientation.
export async function renderLabelPng(labelEl: HTMLElement, widthMm: number, heightMm: number, rotated: boolean): Promise<string> {
  // Pixel size of the label at print resolution
  const targetWidthPx = Math.round(widthMm / 25.4 * PRINT_DPI);
  const targetHeightPx = Math.round(heightMm / 25.4 * PRINT_DPI);

  // Capture straight at print resolution. The capture works on a clone of the
  // DOM, so editor chrome is hidden there without touching the live editor.
  const canvas = await html2canvas(labelEl, {
    backgroundColor: '#ffffff',
    scale: PRINT_DPI / 96,
    logging: false,
    ignoreElements: (el) => EDITOR_ONLY_CLASSES.some(c => el.classList.contains(c)),
    onclone: (_doc, el) => {
      el.classList.add('capturing');
      el.style.transform = 'none'; // capture at 100%, regardless of the editor zoom
    },
  });

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = targetWidthPx;
  finalCanvas.height = targetHeightPx;
  const ctx = finalCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  if (rotated) {
    // The capture is the label as displayed (height wide, width tall).
    // Rotate it 90° clockwise back to the label's real orientation; in the
    // rotated coordinate system the axes are swapped.
    ctx.translate(targetWidthPx / 2, targetHeightPx / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(canvas, -targetHeightPx / 2, -targetWidthPx / 2, targetHeightPx, targetWidthPx);
  } else {
    ctx.drawImage(canvas, 0, 0, targetWidthPx, targetHeightPx);
  }

  return finalCanvas.toDataURL('image/png');
}
