<script lang="ts">
  import { help } from '$lib/state/help.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import type { Theme } from '$lib/types';
  import Segmented from './Segmented.svelte';

  const THEMES: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
</script>

<header class="app-header">
  <h1><img class="app-logo" src="/logo.svg" alt="" />Labelgood</h1>
  <div class="header-controls">
    <Segmented name="theme" label="Theme" options={THEMES} bind:value={settings.theme} />
    <button class="icon-btn help-btn" title="Shortcuts (F1)" aria-label="Shortcuts" onclick={() => help.open = true}>?</button>
  </div>
</header>

<style>
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .help-btn {
    border: 1px solid var(--border);
    border-radius: 50%;
    font-weight: 600;
  }

  h1 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    color: var(--text);
    font-size: 24px;
  }

  .app-logo {
    width: 34px;
    height: 34px;
  }
</style>
