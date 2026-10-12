<!-- The scrollable, zoomable area showing the label being edited -->
<script lang="ts">
  import { tick } from 'svelte';
  import { canvas, pointer, setZoom } from '$lib/state/canvas.svelte';
  import { editor } from '$lib/state/editor.svelte';
  import { measureContentLength } from '$lib/state/geometry';
  import {
    handleCanvasDblClick, handleCanvasMouseDown, handleContextMenu, handleGlobalMouseMove, handleMouseUp, startLabelResize,
  } from '$lib/state/gestures';
  import { label } from '$lib/state/label.svelte';
  import CanvasElement from './CanvasElement.svelte';
  import CutEdge from './CutEdge.svelte';
  import ZoomBar from './ZoomBar.svelte';

  // Re-measure the continuous length after anything that can move or resize elements has rendered
  $effect(() => {
    JSON.stringify(editor.elements);
    void label.displayMargins;
    void label.resizeEdge;
    tick().then(() => label.contentLength = measureContentLength());
  });

  // Ctrl+wheel (also pinch on a trackpad) zooms around the cursor. A plain wheel scrolls along
  // whichever axis has more to scroll, Shift picks the other one. Needs a non-passive listener
  // to stop the default scroll and the browser's own page zoom.
  function wheelZoom(node: HTMLElement) {
    const onWheel = (event: WheelEvent) => {
      canvas.contextMenu = null;
      const scale = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? node.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        setZoom(canvas.zoom * Math.exp(-event.deltaY * scale * 0.0015), event.clientX, event.clientY);
        return;
      }
      if (event.deltaX !== 0) return; // trackpads already scroll in both directions
      event.preventDefault();
      const horizontal = (node.scrollWidth - node.clientWidth > node.scrollHeight - node.clientHeight) !== event.shiftKey;
      if (horizontal) node.scrollLeft += event.deltaY * scale;
      else node.scrollTop += event.deltaY * scale;
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return {
      destroy() {
        node.removeEventListener('wheel', onWheel);
      }
    };
  }
</script>

<!-- Gestures continue when the mouse leaves the canvas -->
<svelte:window onmouseup={handleMouseUp} onmousemove={handleGlobalMouseMove} />

<div class="canvas-area">
  <div
    class="preview-container"
    class:panning={pointer.pan !== null}
    role="presentation"
    bind:this={canvas.viewport}
    use:wheelZoom
    onmousedown={handleCanvasMouseDown}
    ondblclick={handleCanvasDblClick}
    oncontextmenu={handleContextMenu}
  >
    <!-- Takes up the zoomed size so scrolling works; the label inside is scaled -->
    <div
      class="label-sizer"
      class:grows-down={label.resizeEdge === 'bottom'}
      class:grows-right={label.resizeEdge === 'right'}
      style:width="{label.renderWidth * canvas.zoom}mm"
      style:height="{label.renderHeight * canvas.zoom}mm"
    >
      <div
        class="label-preview"
        class:die-cut={label.currentFormat !== null && label.currentFormat.height !== null}
        style:width="{label.renderWidth}mm"
        style:height="{label.renderHeight}mm"
        style:transform="scale({canvas.zoom})"
        style:--hz={1 / canvas.zoom}
        bind:this={canvas.labelEl}
        role="region"
        aria-label="Label preview"
      >
        <!-- First, so everything paints over it -->
        <CutEdge />

        {#if label.marginMode !== 'none'}
          <div
            class="margin-guide"
            style:top="{label.displayMargins.top}mm"
            style:right="{label.displayMargins.right}mm"
            style:bottom="{label.displayMargins.bottom}mm"
            style:left="{label.displayMargins.left}mm"
          ></div>
        {/if}

        {#each editor.elements as el (el.id)}
          <CanvasElement {el} />
        {/each}

        <!-- Drag handle for the length of a continuous label -->
        {#if label.resizeEdge}
          <div
            class="resize-handle resize-handle-{label.resizeEdge}"
            onmousedown={startLabelResize}
            title="Drag to change the label length"
            role="button"
            tabindex="0"
          >
            <div class="resize-handle-indicator"></div>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <ZoomBar />
</div>

{#if pointer.marquee}
  {@const m = pointer.marquee}
  <div
    class="marquee"
    style:left="{Math.min(m.x0, m.x1)}px"
    style:top="{Math.min(m.y0, m.y1)}px"
    style:width="{Math.abs(m.x1 - m.x0)}px"
    style:height="{Math.abs(m.y1 - m.y0)}px"
  ></div>
{/if}

<style>
  .canvas-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--canvas-bg);
    border-radius: 8px;
    box-shadow: 0 2px 4px var(--shadow);
    overflow: hidden;
  }

  .preview-container {
    flex: 1;
    display: flex;
    padding: 48px;
    overflow: auto;
    min-height: 0;
  }

  .preview-container.panning {
    cursor: grabbing;
  }

  /* margin: auto centres the label but still lets it scroll fully when zoomed in */
  .label-sizer {
    position: relative;
    flex-shrink: 0;
    margin: auto;
  }

  /* A continuous label keeps its start in place so only the cut end moves when it
     grows (centring would move both ends, half as far as the mouse) */
  .label-sizer.grows-down {
    margin-top: 0;
  }

  .label-sizer.grows-right {
    margin-left: 0;
  }

  /* The label itself is paper, so it stays white in every theme */
  /* Scaled by the zoom from its top-left corner; --hz (1/zoom) keeps editor chrome a constant size */
  .label-preview {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    background: white;
    min-height: 1em;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.18);
  }

  .label-preview.die-cut {
    border-radius: 1.5mm;
  }

  /* Applied to the cloned label when capturing for output (see render.ts) */
  .label-preview:global(.capturing) {
    border-radius: 0;
    box-shadow: none;
  }

  /* Printable area guide; not part of the output */
  .margin-guide {
    position: absolute;
    border: calc(1px * var(--hz)) dashed #b4b9c0;
    pointer-events: none;
  }

  .resize-handle {
    position: absolute;
    background-color: var(--accent);
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: calc(6px * var(--hz));
  }

  .resize-handle-right {
    right: calc(-10px * var(--hz));
    top: 50%;
    transform: translateY(-50%);
    width: calc(12px * var(--hz));
    height: calc(60px * var(--hz));
    cursor: ew-resize;
  }

  .resize-handle-bottom {
    bottom: calc(-10px * var(--hz));
    left: 50%;
    transform: translateX(-50%);
    width: calc(60px * var(--hz));
    height: calc(12px * var(--hz));
    cursor: ns-resize;
  }

  .resize-handle:hover {
    background-color: var(--accent-hover);
  }

  .resize-handle-indicator {
    background-color: white;
    border-radius: calc(2px * var(--hz));
  }

  .resize-handle-right .resize-handle-indicator {
    width: calc(3px * var(--hz));
    height: calc(20px * var(--hz));
  }

  .resize-handle-bottom .resize-handle-indicator {
    width: calc(20px * var(--hz));
    height: calc(3px * var(--hz));
  }

  .marquee {
    position: fixed;
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    pointer-events: none;
    z-index: 1000;
  }
</style>
