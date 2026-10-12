<!-- Wavy edge drawn just outside the label where a continuous label is cut off the roll -->
<script lang="ts">
  import { PX_PER_MM } from '$lib/constants';
  import { label } from '$lib/state/label.svelte';

  // One continuous path along the cut edge (a tiled pattern shows seams). Drawn
  // across x (0 = label edge) and along y; swapped for a bottom edge.
  const paths = $derived.by(() => {
    if (!label.resizeEdge) return null;
    const length = (label.resizeEdge === 'right' ? label.renderHeight : label.renderWidth) * PX_PER_MM;
    let wave = 'M4 0';
    let y = 0;
    for (let out = true; y + 6 <= length; out = !out, y += 6) {
      wave += ` Q${out ? 8 : 0} ${y + 3} 4 ${y + 6}`;
    }
    wave += ` L4 ${length}`;
    // The fill starts 1px inside the label so it covers the label's outline on that edge
    const fill = `M-1 0 L${wave.slice(1)} L-1 ${length} Z`;
    return { wave, fill };
  });
</script>

{#if label.resizeEdge && paths}
  <svg class="cut-edge cut-edge-{label.resizeEdge}" aria-hidden="true">
    <g transform={label.resizeEdge === 'bottom' ? 'matrix(0 1 1 0 0 0)' : undefined}>
      <path d={paths.fill} fill="white" />
      <path d={paths.wave} fill="none" stroke="#a9aeb6" stroke-width="1" vector-effect="non-scaling-stroke" />
    </g>
  </svg>
{/if}

<style>
  .cut-edge {
    position: absolute;
    pointer-events: none;
    overflow: visible;
  }

  .cut-edge-bottom {
    left: 0;
    top: 100%;
    width: 100%;
    height: 8px;
  }

  .cut-edge-right {
    top: 0;
    left: 100%;
    width: 8px;
    height: 100%;
  }
</style>
