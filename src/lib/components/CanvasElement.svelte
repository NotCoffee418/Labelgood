<!-- One element on the label, with its selection handles -->
<script lang="ts">
  import { cssFontFamily } from '$lib/fonts';
  import { pastePlainText } from '$lib/richtext';
  import { canvas, pointer } from '$lib/state/canvas.svelte';
  import { editor, images, registerEditor, registerNode, updateTextHtml } from '$lib/state/editor.svelte';
  import { rotationOf } from '$lib/state/geometry';
  import { handleElementMouseDown, startElementResize, startEndpointDrag } from '$lib/state/gestures';
  import type { LabelElement } from '$lib/types';

  const LINE_HIT_AREA = 10; // px, clickable thickness of a line

  const RESIZE_HANDLES = [
    ['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0],
    ['se', 1, 1], ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0],
  ] as const;

  let { el }: { el: LabelElement } = $props();

  const isSelected = $derived(editor.selectedIds.includes(el.id));
  // Handles show when this is the only selected element
  const showHandles = $derived(editor.selected?.id === el.id);
  const isDragged = $derived(pointer.dragging && isSelected);
  const dragTranslate = $derived(isDragged ? `${pointer.dragOffset.x}px ${pointer.dragOffset.y}px` : null);
  const rotation = $derived(rotationOf(el));
</script>

{#if el.kind === 'line'}
  {@const length = Math.hypot(el.x2 - el.x1, el.y2 - el.y1)}
  {@const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1)}
  <div
    class="element line-element"
    class:selected={isSelected}
    class:dragging={isDragged}
    style:translate={dragTranslate}
    data-element-id={el.id}
    style:left="{el.x1}px"
    style:top="{el.y1 - LINE_HIT_AREA / canvas.zoom / 2}px"
    style:width="{Math.max(length, 1)}px"
    style:height="{LINE_HIT_AREA / canvas.zoom}px"
    style:transform="rotate({angle}rad)"
    onmousedown={(e) => handleElementMouseDown(e, el)}
    role="button"
    tabindex="-1"
    aria-label="Line"
  >
    <div class="line-bar" style:height="{el.stroke}pt" style:background={el.color}></div>
  </div>
  {#if showHandles}
    <div class="handle endpoint" style:left="{el.x1}px" style:top="{el.y1}px" style:translate={dragTranslate}
      onmousedown={(e) => startEndpointDrag(e, el, 1)} role="button" tabindex="-1" aria-label="Move line start"></div>
    <div class="handle endpoint" style:left="{el.x2}px" style:top="{el.y2}px" style:translate={dragTranslate}
      onmousedown={(e) => startEndpointDrag(e, el, 2)} role="button" tabindex="-1" aria-label="Move line end"></div>
  {/if}
{:else}
  <div
    class="element"
    class:text-box={el.kind === 'text'}
    class:selected={isSelected}
    class:editing={editor.editingBoxId === el.id}
    class:dragging={isDragged}
    style:translate={dragTranslate}
    class:quarter-turn={rotation % 180 !== 0}
    class:hollow={el.kind === 'rect' && !el.fill}
    style:--stroke={el.kind === 'rect' ? `${el.stroke}pt` : null}
    data-element-id={el.id}
    style:transform={rotation ? `rotate(${rotation}deg)` : null}
    style:left="{el.x}px"
    style:top="{el.y}px"
    style:width={el.w !== null ? `${el.w}px` : null}
    style:height={el.kind !== 'text' ? `${el.h}px` : null}
    style:min-height={el.kind === 'text' && el.h !== null ? `${el.h}px` : null}
    use:registerNode={el.id}
    onmousedown={(e) => handleElementMouseDown(e, el)}
    role="button"
    tabindex="-1"
  >
    {#if el.kind === 'text'}
      <div
        class="text-box-content"
        contenteditable={editor.editingBoxId === el.id ? 'true' : 'false'}
        role="textbox"
        tabindex="-1"
        aria-multiline="true"
        data-box-id={el.id}
        style:font-family={cssFontFamily(el.style.fontFamily)}
        style:font-size="{el.style.fontSize}pt"
        style:color={el.style.color}
        style:font-weight={el.style.bold ? 'bold' : 'normal'}
        style:font-style={el.style.italic ? 'italic' : 'normal'}
        style:text-decoration={el.style.underline ? 'underline' : 'none'}
        style:text-align={el.style.align}
        style:white-space={el.w !== null ? 'pre-wrap' : 'pre'}
        use:registerEditor={el}
        oninput={(e) => updateTextHtml(el, e.currentTarget.innerHTML)}
        onpaste={pastePlainText}
      ></div>
    {:else if el.kind === 'rect'}
      <div
        class="rect-shape"
        style:border="{el.stroke}pt solid {el.color}"
        style:background={el.fill ? el.color : 'transparent'}
      ></div>
      {#if !el.fill}
        <!-- An unfilled rectangle is only grabbed by its outline, so things inside stay clickable -->
        {#each ['top', 'right', 'bottom', 'left'] as side}
          <div class="rect-hit rect-hit-{side}"></div>
        {/each}
      {/if}
    {:else}
      <img class="image-element" src={images.get(el.imageId)?.src} alt="" draggable="false" />
    {/if}

    {#if showHandles}
      {#each RESIZE_HANDLES as [name, sx, sy]}
        <div
          class="handle handle-{name}"
          onmousedown={(e) => startElementResize(e, el, sx, sy)}
          role="button"
          tabindex="-1"
          aria-label="Resize"
        ></div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  /* Sizes in screen px are multiplied by --hz (1/zoom, set on the label) to stay constant */

  .element {
    position: absolute;
    cursor: move;
  }

  /* Dragged elements move on their own compositor layer */
  .element.dragging {
    opacity: 0.85;
    will-change: translate;
  }

  .element.selected:not(.text-box):not(.line-element) {
    outline: calc(1px * var(--hz)) solid var(--accent);
    outline-offset: calc(1px * var(--hz));
  }

  .text-box {
    padding: 4px;
    border: 1px dashed transparent;
    min-width: 20px;
    user-select: none;
  }

  .text-box:hover {
    border-color: #9cc6ff;
  }

  .text-box.selected {
    border-color: var(--accent);
    border-style: solid;
    background-color: rgba(0, 123, 255, 0.05);
  }

  .text-box.editing {
    border-style: dashed;
    cursor: default;
  }

  .text-box-content {
    outline: none;
    min-height: 1em;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .text-box.editing .text-box-content {
    cursor: text;
    user-select: text;
  }

  .rect-shape {
    width: 100%;
    height: 100%;
  }

  .element.hollow {
    pointer-events: none;
  }

  .element.hollow .rect-hit,
  .element.hollow .handle {
    pointer-events: auto;
  }

  /* Grab strips along each side of an unfilled rectangle: the outline plus a few screen px */
  .rect-hit {
    --grab: calc(var(--stroke) + 8px * var(--hz));
    position: absolute;
  }

  .rect-hit-top { left: 0; right: 0; top: calc(-4px * var(--hz)); height: var(--grab); }
  .rect-hit-bottom { left: 0; right: 0; bottom: calc(-4px * var(--hz)); height: var(--grab); }
  .rect-hit-left { top: 0; bottom: 0; left: calc(-4px * var(--hz)); width: var(--grab); }
  .rect-hit-right { top: 0; bottom: 0; right: calc(-4px * var(--hz)); width: var(--grab); }

  .image-element {
    display: block;
    width: 100%;
    height: 100%;
    max-width: none;
    user-select: none;
    pointer-events: none;
  }

  /* Lines are a rotated strip; the strip is the click target, the bar is the line */
  .line-element {
    transform-origin: 0 50%;
  }

  .line-bar {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    min-height: 1px;
    transform: translateY(-50%);
  }

  .line-element.selected .line-bar {
    box-shadow: 0 0 0 calc(1px * var(--hz)) var(--accent);
  }

  .handle {
    --size: calc(9px * var(--hz));
    --edge: calc(-6px * var(--hz));
    position: absolute;
    width: var(--size);
    height: var(--size);
    background: white;
    border: calc(1.5px * var(--hz)) solid var(--accent);
    border-radius: calc(2px * var(--hz));
    z-index: 20;
  }

  .handle-nw { left: var(--edge); top: var(--edge); cursor: nwse-resize; }
  .handle-n { left: calc(50% - var(--size) / 2); top: var(--edge); cursor: ns-resize; }
  .handle-ne { right: var(--edge); top: var(--edge); cursor: nesw-resize; }
  .handle-e { right: var(--edge); top: calc(50% - var(--size) / 2); cursor: ew-resize; }
  .handle-se { right: var(--edge); bottom: var(--edge); cursor: nwse-resize; }
  .handle-s { left: calc(50% - var(--size) / 2); bottom: var(--edge); cursor: ns-resize; }
  .handle-sw { left: var(--edge); bottom: var(--edge); cursor: nesw-resize; }
  .handle-w { left: var(--edge); top: calc(50% - var(--size) / 2); cursor: ew-resize; }

  /* Handles rotate with a quarter-turned box, so swap their cursors to match */
  .quarter-turn .handle-n, .quarter-turn .handle-s { cursor: ew-resize; }
  .quarter-turn .handle-e, .quarter-turn .handle-w { cursor: ns-resize; }
  .quarter-turn .handle-nw, .quarter-turn .handle-se { cursor: nesw-resize; }
  .quarter-turn .handle-ne, .quarter-turn .handle-sw { cursor: nwse-resize; }

  .handle.endpoint {
    border-radius: 50%;
    transform: translate(-50%, -50%);
    cursor: crosshair;
  }

  /* Applied to the cloned label when capturing for output (see render.ts) */
  :global(.label-preview.capturing) .text-box {
    border-color: transparent;
    background: transparent;
  }

  :global(.label-preview.capturing) .element {
    opacity: 1;
  }

  :global(.label-preview.capturing) .line-bar {
    box-shadow: none;
  }
</style>
