<!-- Print preview, printer and driver options. Shown while output.printDialog is set. -->
<script lang="ts">
  import { label } from '$lib/state/label.svelte';
  import {
    choiceFor, clampCopies, closePrintDialog, loadPrinterOptions, output, printFromDialog, refreshPrinters, setChoice,
  } from '$lib/state/output.svelte';

  let { preview }: { preview: string } = $props();

  // Friendlier names for common CUPS driver options and choices
  const PRINT_OPTION_LABELS: Record<string, string> = {
    CutMedia: 'Cut',
    cupsPrintQuality: 'Quality',
    MediaType: 'Media',
    ColorModel: 'Colour',
    OutputBin: 'Output tray',
    InputSlot: 'Paper source',
    Duplex: 'Two-sided',
  };
  const PRINT_CHOICE_LABELS: Record<string, Record<string, string>> = {
    CutMedia: { None: "Don't cut", Auto: 'Printer default', EndOfPage: 'After each label', EndOfJob: 'After the last label' },
    MediaType: { Labels: 'Die-cut labels', Roll: 'Continuous roll' },
    ColorModel: { Gray: 'Black & white', RGB: 'Colour' },
  };
</script>

<div class="modal-backdrop" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) closePrintDialog(); }}>
  <div class="print-dialog" role="dialog" aria-modal="true" aria-labelledby="print-title">
    <h2 id="print-title">Print</h2>
    <div class="print-body">
      <figure class="print-preview">
        <img src={preview} alt="Print preview" />
        <figcaption>{label.actualWidth} × {label.actualHeight} mm · shown as it comes out of the printer</figcaption>
      </figure>

      <div class="print-settings">
        <div class="field">
          <span>Printer</span>
          {#if output.printers.length > 0}
            <div class="printer-row">
              <select
                class="input printer-select"
                aria-label="Printer"
                bind:value={output.selectedPrinter}
                onchange={() => loadPrinterOptions(output.selectedPrinter)}
              >
                {#each output.printers as printer}
                  <option value={printer}>{printer}</option>
                {/each}
              </select>
              <button class="refresh-printers-btn" title="Refresh printer list" onclick={refreshPrinters}>↻</button>
            </div>
          {:else}
            <p class="no-printers-text">No printers found. Check that the printer is installed (on Linux, that CUPS is running).</p>
            <button class="refresh-printers-btn" onclick={refreshPrinters}>Refresh Printers</button>
          {/if}
        </div>

        <label class="field">
          <span>Copies</span>
          <input
            class="input"
            type="number"
            min="1"
            max="999"
            bind:value={output.copies}
            onchange={() => output.copies = clampCopies(output.copies)}
          />
        </label>

        {#if output.printerOptions === null}
          <p class="field-note">Loading printer options…</p>
        {:else if output.printerOptionsError}
          <p class="field-note">This printer doesn't report its options, so it will use its own defaults.</p>
        {:else}
          {#each output.visiblePrintOptions as option (option.key)}
            <label class="field">
              <span>{PRINT_OPTION_LABELS[option.key] ?? option.label}</span>
              <select class="input" value={choiceFor(option)} onchange={(e) => setChoice(option, e.currentTarget.value)}>
                {#each option.choices as choice, i}
                  <option value={choice}>{PRINT_CHOICE_LABELS[option.key]?.[choice] ?? option.choice_labels[i] ?? choice}</option>
                {/each}
              </select>
            </label>
          {/each}
        {/if}
      </div>
    </div>

    {#if output.printError}
      <p class="status error">{output.printError}</p>
    {/if}
    <div class="dialog-actions">
      <button class="secondary-button" onclick={closePrintDialog} disabled={output.printing}>Cancel</button>
      <button class="print-button" onclick={printFromDialog} disabled={output.printing || !output.selectedPrinter}>
        {output.printing ? 'Printing…' : 'Print'}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(0, 0, 0, 0.45);
  }

  .print-dialog {
    width: min(780px, 100%);
    max-height: 100%;
    overflow: auto;
    padding: 20px 24px;
    background: var(--surface);
    border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  }

  h2 {
    margin: 0 0 16px 0;
    font-size: 20px;
  }

  .print-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 20px;
  }

  @media (max-width: 680px) {
    .print-body {
      grid-template-columns: 1fr;
    }
  }

  .print-preview {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 260px;
    padding: 24px;
    background: var(--canvas-bg);
    border-radius: 8px;
  }

  .print-preview img {
    max-width: 100%;
    max-height: 340px;
    background: white;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.18);
  }

  .print-preview figcaption {
    font-size: 12px;
    color: var(--text-subtle);
    text-align: center;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }

  .field > span {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .field select,
  .field input {
    width: 100%;
    padding: 7px 8px;
  }

  .field-note {
    margin: 0 0 12px 0;
    font-size: 13px;
    color: var(--text-subtle);
  }

  .printer-row {
    display: flex;
    gap: 8px;
  }

  .printer-select {
    flex: 1;
    min-width: 0;
  }

  .refresh-printers-btn {
    padding: 6px 12px;
    background-color: var(--neutral);
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
    font-weight: 500;
  }

  .refresh-printers-btn:hover {
    background-color: var(--neutral-hover);
  }

  .no-printers-text {
    font-size: 14px;
    color: var(--danger);
    margin: 0 0 10px 0;
    line-height: 1.4;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 16px;
  }
</style>
