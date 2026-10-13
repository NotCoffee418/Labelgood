<!-- Toolbar: history, inserts and actions on the selection, then formatting -->
<script lang="ts">
  import { keepTextFocus } from '#lib/dom.ts';
  import { commit, deleteSelection, editor, history, redo, undo } from '#lib/state/editor.svelte.ts';
  import { addLine, addRect, addTextBox, readImageFile, rotateSelection } from '#lib/state/elements.ts';
  import FormatControls from './FormatControls.svelte';

  let imageInput: HTMLInputElement;

  function chooseImage() {
    imageInput.value = '';
    imageInput.click();
  }

  function handleImageFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) readImageFile(file);
  }
</script>

<div class="toolbar">
  <div class="toolbar-row">
    <div class="button-group" role="group" aria-label="History">
      <button class="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!history.canUndo}
        onmousedown={keepTextFocus} onclick={undo}>↶</button>
      <button class="icon-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!history.canRedo}
        onmousedown={keepTextFocus} onclick={redo}>↷</button>
    </div>

    <div class="button-group" role="group" aria-label="Insert">
      <button class="text-btn" onclick={() => addTextBox()} title="Insert text box">+ Text</button>
      <button class="text-btn" onclick={addLine} title="Insert line">Line</button>
      <button class="text-btn" onclick={addRect} title="Insert rectangle">Rectangle</button>
      <button class="text-btn" onclick={chooseImage} title="Insert image">Image</button>
    </div>
    <input type="file" accept="image/*" hidden bind:this={imageInput} onchange={handleImageFile} />

    <div class="toolbar-spacer"></div>

    {#if editor.selectedIds.length > 0}
      <div class="button-group" role="group" aria-label="Rotate">
        <button class="icon-btn" title="Rotate left (Ctrl+Shift+R)" aria-label="Rotate left" onclick={() => rotateSelection(-1)}>⟲</button>
        <button class="icon-btn" title="Rotate right (Ctrl+R)" aria-label="Rotate right" onclick={() => rotateSelection(1)}>⟳</button>
      </div>

      <button class="icon-btn danger" title="Delete (Del)" aria-label="Delete"
        onclick={() => { deleteSelection(); commit(); }}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
        </svg>
      </button>
    {/if}
  </div>

  <!-- Formatting for the selection, or the defaults for new elements. Fixed height so the canvas doesn't jump. -->
  <div class="toolbar-row format-row">
    <FormatControls />
  </div>
</div>

<style>
  .toolbar {
    padding: 12px 15px;
    background: var(--surface);
    border-radius: 8px;
    box-shadow: 0 2px 4px var(--shadow);
    margin-bottom: 20px;
  }

  /* Rows never wrap, so the toolbar height stays the same whatever is selected */
  .toolbar-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: nowrap;
    height: 34px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .toolbar-row > :global(*) {
    flex-shrink: 0;
  }

  /* Standalone buttons get their own border */
  .toolbar-row > :global(.icon-btn),
  .toolbar-row > :global(.text-btn) {
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .toolbar-spacer {
    flex: 1;
  }

  .format-row {
    box-sizing: content-box;
    margin-top: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
</style>
