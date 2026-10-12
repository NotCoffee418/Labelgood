<script lang="ts">
  import { canvas, setZoom, zoomFromSlider, zoomToFit } from '$lib/state/canvas.svelte';
</script>

<div class="zoom-bar">
  <button class="icon-btn" title="Zoom out" aria-label="Zoom out" onclick={() => setZoom(canvas.zoom / 1.25)}>−</button>
  <input
    type="range"
    class="zoom-slider"
    min="0"
    max="1000"
    aria-label="Zoom"
    value={canvas.zoomSlider}
    oninput={(e) => zoomFromSlider(Number(e.currentTarget.value))}
  />
  <button class="icon-btn" title="Zoom in" aria-label="Zoom in" onclick={() => setZoom(canvas.zoom * 1.25)}>+</button>
  <button class="text-btn zoom-value" title="Reset to 100%" onclick={() => setZoom(1)}>{Math.round(canvas.zoom * 100)}%</button>
  <button class="text-btn" title="Fit the label in view" onclick={zoomToFit}>Fit</button>
</div>

<style>
  .zoom-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }

  .zoom-bar .icon-btn,
  .zoom-bar .text-btn {
    height: 26px;
    border-radius: 4px;
  }

  .zoom-bar .icon-btn {
    width: 26px;
  }

  .zoom-slider {
    width: 180px;
    accent-color: var(--accent);
  }

  .zoom-value {
    min-width: 52px;
    font-variant-numeric: tabular-nums;
  }
</style>
