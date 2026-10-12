<!-- Sidebar: label size, margins, orientation, and the output buttons -->
<script lang="ts">
  import { tick } from 'svelte';
  import { LABEL_FORMATS, MAX_LENGTH_MM, MIN_LENGTH_MM, clampLength } from '$lib/formats';
  import {
    handleContinuousHeight, handleContinuousWidth, label, selectLabelFormat, setMarginMode,
  } from '$lib/state/label.svelte';
  import { openPrintDialog, output, savePdf } from '$lib/state/output.svelte';
  import { status } from '$lib/state/status.svelte';
  import type { MarginMode, Orientation } from '$lib/types';
  import Segmented from './Segmented.svelte';

  const MARGIN_MODES: { value: MarginMode; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'none', label: 'None' },
    { value: 'custom', label: 'Custom' },
  ];
  const MARGIN_SIDES = [['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']] as const;
  const ORIENTATIONS: { value: Orientation; label: string }[] = [
    { value: 'landscape', label: 'Landscape' },
    { value: 'portrait', label: 'Portrait' },
  ];

  // Applies a typed continuous length as the user's length, then shows the effective
  // length again (it can stay longer if the content needs it)
  function commitLength(input: HTMLInputElement, axis: 'width' | 'height') {
    const value = clampLength(Number(input.value));
    if (axis === 'width') label.width = value;
    else label.height = value;
    tick().then(() => input.value = String(axis === 'width' ? label.actualWidth : label.actualHeight));
  }
</script>

<aside class="settings-panel">
  <h2>Label Settings</h2>

  <div class="settings-group">
    <h3>Label</h3>
    <select
      class="input format-select"
      aria-label="Label format"
      value={label.format}
      onchange={(e) => selectLabelFormat(e.currentTarget.value)}
    >
      {#each LABEL_FORMATS as group}
        <optgroup label={group.group}>
          {#each group.formats as format}
            <option value={format.id}>{format.name}</option>
          {/each}
        </optgroup>
      {/each}
      <option value="custom">Custom size…</option>
    </select>

    {#if label.format === 'custom'}
      <div class="dimension-control">
        <label for="width">Width (mm)</label>
        <input
          class="input"
          id="width"
          type="number"
          value={label.continuousWidth ? label.actualWidth : label.width}
          min={label.continuousWidth ? MIN_LENGTH_MM : 1}
          max={label.continuousWidth ? MAX_LENGTH_MM : undefined}
          step="any"
          oninput={(e) => { if (!label.continuousWidth) label.width = Number(e.currentTarget.value); }}
          onchange={(e) => { if (label.continuousWidth) commitLength(e.currentTarget, 'width'); }}
        />
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={label.continuousWidth} onchange={handleContinuousWidth} />
          Continuous
        </label>
      </div>

      <div class="dimension-control">
        <label for="height">Height (mm)</label>
        <input
          class="input"
          id="height"
          type="number"
          value={label.continuousHeight ? label.actualHeight : label.height}
          min={label.continuousHeight ? MIN_LENGTH_MM : 1}
          max={label.continuousHeight ? MAX_LENGTH_MM : undefined}
          step="any"
          oninput={(e) => { if (!label.continuousHeight) label.height = Number(e.currentTarget.value); }}
          onchange={(e) => { if (label.continuousHeight) commitLength(e.currentTarget, 'height'); }}
        />
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={label.continuousHeight} onchange={handleContinuousHeight} />
          Continuous
        </label>
      </div>
    {:else if label.currentFormat?.height === null}
      <div class="dimension-control">
        <label for="length">Length (mm)</label>
        <input
          class="input"
          id="length"
          type="number"
          value={label.actualHeight}
          min={MIN_LENGTH_MM}
          max={MAX_LENGTH_MM}
          step="any"
          title="{MIN_LENGTH_MM}–{MAX_LENGTH_MM} mm"
          onchange={(e) => commitLength(e.currentTarget, 'height')}
        />
      </div>
    {/if}
  </div>

  <div class="settings-group">
    <h3>Margins</h3>
    <Segmented name="marginMode" label="Margins" options={MARGIN_MODES} value={label.marginMode} onchange={setMarginMode} stretch />
    {#if label.marginMode === 'custom'}
      <div class="margin-grid">
        {#each MARGIN_SIDES as [side, sideLabel]}
          <label>
            <span>{sideLabel}</span>
            <input class="input" type="number" min="0" step="0.5" bind:value={label.customMargins[side]} />
            <span class="unit">mm</span>
          </label>
        {/each}
      </div>
    {/if}
  </div>

  <div class="settings-group">
    <h3>Orientation</h3>
    <Segmented name="orientation" label="Orientation" options={ORIENTATIONS} bind:value={label.orientation} stretch />
  </div>

  <div class="output-footer">
    {#if status.message}
      <p class="status" class:error={status.message.error}>{status.message.text}</p>
    {/if}
    <div class="output-buttons">
      <button class="secondary-button" onclick={savePdf} disabled={output.busy}>Save PDF</button>
      <button class="print-button" onclick={openPrintDialog} disabled={output.busy} title="Print (Ctrl+P)">
        {output.busy ? 'Working…' : 'Print'}
      </button>
    </div>
  </div>
</aside>

<style>
  .settings-panel {
    width: 340px;
    flex-shrink: 0;
    background: var(--surface);
    padding: 20px;
    box-shadow: -2px 0 8px var(--shadow);
    overflow-x: hidden;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  h2 {
    margin: 0 0 16px 0;
    font-size: 20px;
    color: var(--text);
  }

  h3 {
    margin: 0 0 10px 0;
    font-size: 15px;
    color: var(--text-muted);
  }

  .settings-group {
    margin-bottom: 20px;
  }

  .format-select {
    width: 100%;
    padding: 7px 8px;
    margin-bottom: 10px;
  }

  .margin-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
    margin-top: 10px;
  }

  .margin-grid label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-muted);
  }

  .margin-grid label span:first-child {
    width: 46px;
    flex-shrink: 0;
  }

  .margin-grid input {
    flex: 1;
    width: 100%;
    min-width: 0;
    padding: 5px 6px;
    font-size: 13px;
  }

  .margin-grid .unit {
    font-size: 12px;
    color: var(--text-subtle);
  }

  .dimension-control {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .dimension-control label[for] {
    width: 84px;
    flex-shrink: 0;
    white-space: nowrap;
    font-size: 14px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .dimension-control input[type="number"] {
    flex: 1;
    min-width: 0;
  }

  .output-footer {
    margin-top: auto;
    flex-shrink: 0;
  }

  .output-buttons {
    display: flex;
    gap: 10px;
  }

  .output-buttons > button {
    flex: 1;
  }
</style>
