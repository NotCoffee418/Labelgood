<!-- The second toolbar row: shape, image or text formatting, depending on the selection -->
<script lang="ts">
  import { keepTextFocus } from '#lib/dom.ts';
  import { FALLBACK_FONTS, GENERIC_FONTS } from '#lib/fonts.ts';
  import { editor } from '#lib/state/editor.svelte.ts';
  import { resetImageRatio } from '#lib/state/elements.ts';
  import { fonts, genericFontLabel } from '#lib/state/fonts.svelte.ts';
  import { applyFormat, applyShape, toggleFormat } from '#lib/state/formatting.ts';

  const MARKS = [['bold', 'Bold'], ['italic', 'Italic'], ['underline', 'Underline']] as const;
  const ALIGNMENTS =[['left', 'Align left'], ['center', 'Center'], ['right', 'Align right']] as const;

  const fontOptions = $derived.by(() => {
    const available = fonts.system.length > 0 ? fonts.system : FALLBACK_FONTS;
    const current = editor.displayStyle.fontFamily;
    const known = GENERIC_FONTS.some(f => f.value === current) || available.includes(current);
    return known ? available : [current, ...available];
  });

  function handleFontSizeChange(event: Event) {
    const size = parseFloat((event.currentTarget as HTMLInputElement).value);
    if (size > 0) {
      applyFormat('fontSize', Math.min(Math.max(size, 4), 200));
    }
  }

  function handleStrokeChange(event: Event) {
    const stroke = parseFloat((event.currentTarget as HTMLInputElement).value);
    if (stroke > 0) {
      applyShape('stroke', Math.min(Math.max(stroke, 0.25), 50));
    }
  }
</script>

{#if editor.shapeToolbar}
  <div class="size-control">
    <span>Line</span>
    <input
      class="input"
      type="number"
      aria-label="Line thickness"
      value={editor.activeShape.stroke}
      min="0.25"
      max="50"
      step="0.25"
      onchange={handleStrokeChange}
    />
    <span>pt</span>
  </div>
  <input
    type="color"
    title="Line color"
    aria-label="Line color"
    value={editor.activeShape.color}
    onchange={(e) => applyShape('color', e.currentTarget.value)}
  />
  {#if editor.selectedShapes.some(el => el.kind === 'rect')}
    <label class="checkbox-label">
      <input type="checkbox" checked={editor.activeShape.fill} onchange={(e) => applyShape('fill', e.currentTarget.checked)} />
      Filled
    </label>
  {/if}
{:else if editor.selectedImage}
  <button class="text-btn" onclick={resetImageRatio} title="Restore the image's original proportions">
    Original proportions
  </button>
{:else}
  <select
    class="input font-select"
    aria-label="Font"
    value={editor.displayStyle.fontFamily}
    onchange={(e) => applyFormat('fontFamily', e.currentTarget.value)}
  >
    {#each GENERIC_FONTS as font}
      <option value={font.value}>{genericFontLabel(font)}</option>
    {/each}
    <option disabled>──────────</option>
    {#each fontOptions as font}
      <option value={font}>{font}</option>
    {/each}
  </select>

  <div class="size-control">
    <input
      class="input"
      type="number"
      aria-label="Font size"
      value={editor.displayStyle.fontSize}
      min="4"
      max="200"
      step="1"
      onchange={handleFontSizeChange}
    />
    <span>pt</span>
  </div>

  <div class="button-group" role="group" aria-label="Text style">
    {#each MARKS as [mark, title]}
      <button
        class="toggle-btn {mark}"
        class:active={editor.activeMarks[mark]}
        {title}
        aria-pressed={editor.activeMarks[mark]}
        onmousedown={keepTextFocus}
        onclick={() => toggleFormat(mark)}
      >{title[0]}</button>
    {/each}
  </div>

  <div class="button-group" role="group" aria-label="Alignment">
    {#each ALIGNMENTS as [align, title]}
      <button
        class="toggle-btn"
        class:active={editor.activeStyle.align === align}
        {title}
        aria-label={title}
        aria-pressed={editor.activeStyle.align === align}
        onmousedown={keepTextFocus}
        onclick={() => applyFormat('align', align)}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          {#each [[14, 0], [9, 1], [14, 2], [9, 3]] as [lineWidth, row]}
            {@const x = align === 'left' ? 1 : align === 'right' ? 15 - lineWidth : (16 - lineWidth) / 2}
            <rect {x} y={2.5 + row * 3.3} width={lineWidth} height="1.6" rx="0.5" fill="currentColor" />
          {/each}
        </svg>
      </button>
    {/each}
  </div>

  <input
    type="color"
    title="Text color"
    aria-label="Text color"
    value={editor.displayStyle.color}
    onchange={(e) => applyFormat('color', e.currentTarget.value)}
  />
{/if}

<style>
  .font-select {
    width: 250px;
  }

  .size-control {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--text-muted);
  }

  .size-control input {
    width: 64px;
  }

  .toggle-btn {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: var(--surface);
    color: var(--text);
    font-size: 15px;
    font-family: Georgia, serif;
    cursor: pointer;
  }

  .toggle-btn:hover {
    background: var(--surface-muted);
  }

  .toggle-btn.active {
    background: var(--accent);
    color: white;
  }

  .toggle-btn.bold { font-weight: bold; }
  .toggle-btn.italic { font-style: italic; }
  .toggle-btn.underline { text-decoration: underline; }

  input[type="color"] {
    width: 40px;
    height: 32px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
  }
</style>
