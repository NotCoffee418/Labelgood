<!-- A row of mutually exclusive options (radio buttons styled as a button bar) -->
<script lang="ts" generics="T extends string">
  let {
    options,
    value = $bindable(),
    name,
    label,
    stretch = false, // fill the available width
    onchange,
  }: {
    options: { value: T; label: string }[];
    value: T;
    name: string;
    label: string;
    stretch?: boolean;
    onchange?: (value: T) => void;
  } = $props();

  function select(option: T) {
    value = option;
    onchange?.(option);
  }
</script>

<div class="segmented" class:stretch role="radiogroup" aria-label={label}>
  {#each options as option (option.value)}
    <label class:active={value === option.value}>
      <input type="radio" {name} value={option.value} checked={value === option.value} onchange={() => select(option.value)} />
      {option.label}
    </label>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface);
  }

  label {
    padding: 4px 10px;
    font-size: 13px;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    text-align: center;
  }

  label + label {
    border-left: 1px solid var(--border);
  }

  label:not(.active):hover {
    background: var(--surface-muted);
  }

  label.active {
    background: var(--accent);
    color: white;
  }

  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .stretch {
    display: flex;
  }

  .stretch label {
    flex: 1;
    padding: 6px 8px;
  }
</style>
