<!-- Right-click menu on the canvas, opened by handleContextMenu in gestures.ts -->
<script lang="ts">
  import { canvas } from '#lib/state/canvas.svelte.ts';
  import { copySelection, cutSelection, duplicateSelection, pasteFromMenu } from '#lib/state/clipboard.svelte.ts';
  import { commit, deleteSelection, editor } from '#lib/state/editor.svelte.ts';
  import { bringToFront, rotateSelection, selectAll, sendToBack } from '#lib/state/elements.ts';
  import type { Point } from '#lib/types.ts';

  // Runs a menu item, passing the label position the menu was opened at
  function menuAction(action: (at: Point) => void) {
    if (!canvas.contextMenu) return;
    const at = { x: canvas.contextMenu.labelX, y: canvas.contextMenu.labelY };
    canvas.contextMenu = null;
    action(at);
    commit();
  }

  // The menu's own size, so it can be kept fully on screen whatever it contains
  let windowWidth = $state(0);
  let windowHeight = $state(0);
  let menuWidth = $state(0);
  let menuHeight = $state(0);

  // Clicking anywhere else closes the menu
  function handleWindowMouseDown(event: MouseEvent) {
    if (canvas.contextMenu && !(event.target as HTMLElement).closest('.context-menu')) {
      canvas.contextMenu = null;
    }
  }
</script>

<svelte:window onmousedown={handleWindowMouseDown} bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} />

{#if canvas.contextMenu}
  {@const hasSelection = editor.selectedIds.length > 0}
  {@const onlyText = editor.selectedTexts.length > 0 && editor.selectedTexts.length === editor.selectedIds.length}
  <div class="context-menu" role="menu"
    bind:clientWidth={menuWidth} bind:clientHeight={menuHeight}
    style:left="{Math.max(0, Math.min(canvas.contextMenu.x, windowWidth - menuWidth))}px"
    style:top="{Math.max(0, Math.min(canvas.contextMenu.y, windowHeight - menuHeight))}px">
    <button role="menuitem" disabled={!hasSelection} onclick={() => menuAction(cutSelection)}>Cut<span>Ctrl+X</span></button>
    <button role="menuitem" disabled={!hasSelection} onclick={() => menuAction(copySelection)}>
      {onlyText ? 'Copy text' : 'Copy'}<span>Ctrl+C</span>
    </button>
    <button role="menuitem" onclick={() => menuAction(pasteFromMenu)}>Paste<span>Ctrl+V</span></button>
    <button role="menuitem" disabled={!hasSelection} onclick={() => menuAction(duplicateSelection)}>Duplicate<span>Ctrl+D</span></button>
    <button role="menuitem" disabled={!hasSelection} onclick={() => menuAction(deleteSelection)}>Delete<span>Del</span></button>
    {#if hasSelection}
      <hr />
      <button role="menuitem" onclick={() => menuAction(() => rotateSelection(-1))}>Rotate left<span>Ctrl+Shift+R</span></button>
      <button role="menuitem" onclick={() => menuAction(() => rotateSelection(1))}>Rotate right<span>Ctrl+R</span></button>
    {/if}
    <hr />
    <button role="menuitem" disabled={!hasSelection} onclick={() => menuAction(bringToFront)}>Bring to front</button>
    <button role="menuitem" disabled={!hasSelection} onclick={() => menuAction(sendToBack)}>Send to back</button>
    <hr />
    <button role="menuitem" disabled={editor.elements.length === 0} onclick={() => menuAction(selectAll)}>Select all<span>Ctrl+A</span></button>
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 1001;
    min-width: 200px;
    padding: 4px 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 20px var(--shadow);
  }

  button {
    display: flex;
    justify-content: space-between;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  button span {
    margin-left: 24px;
    color: var(--text-subtle);
    font-size: 12px;
  }

  button:hover:not(:disabled) {
    background: var(--accent);
    color: white;
  }

  button:hover:not(:disabled) span {
    color: rgba(255, 255, 255, 0.8);
  }

  button:disabled {
    color: var(--text-subtle);
    cursor: default;
  }

  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }
</style>
