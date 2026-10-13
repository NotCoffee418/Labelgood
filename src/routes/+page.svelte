<script lang="ts">
  import { onMount } from 'svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import HelpDialog from '$lib/components/HelpDialog.svelte';
  import LabelCanvas from '$lib/components/LabelCanvas.svelte';
  import MenuBar from '$lib/components/MenuBar.svelte';
  import PrintDialog from '$lib/components/PrintDialog.svelte';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import Toolbar from '$lib/components/Toolbar.svelte';
  import { isEditableTarget } from '$lib/dom';
  import { handleDocumentPaste } from '$lib/state/clipboard.svelte';
  import { markStartingDocument, openStartupFile, trackDocumentWindow } from '$lib/state/document.svelte';
  import { history } from '$lib/state/editor.svelte';
  import { initSampleBox } from '$lib/state/elements';
  import { loadFonts } from '$lib/state/fonts.svelte';
  import { handleSelectionChange } from '$lib/state/formatting';
  import { listenForFileDrops } from '$lib/state/gestures';
  import { help } from '$lib/state/help.svelte';
  import { loadPrinters, output } from '$lib/state/output.svelte';
  import { applyTheme, loadSettings, persistSettings } from '$lib/state/settings.svelte';
  import { handleKeyDown, handleKeyUp } from '$lib/state/shortcuts';

  // Restore the last used settings before anything is recorded or saved
  loadSettings();
  initSampleBox();
  markStartingDocument();

  persistSettings();
  applyTheme();
  history.track();
  trackDocumentWindow();

  onMount(() => {
    loadPrinters();
    loadFonts();
    openStartupFile();
    return listenForFileDrops();
  });

  // Block the webview's own context menu outside text fields
  function handleDocumentContextMenu(event: MouseEvent) {
    if (!isEditableTarget(event.target)) event.preventDefault();
  }
</script>

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} />
<svelte:document
  onselectionchange={handleSelectionChange}
  onpaste={handleDocumentPaste}
  oncontextmenu={handleDocumentContextMenu}
/>

<div class="app">
  <MenuBar />
  <div class="app-container">
    <div class="main-section">
      <Toolbar />
      <LabelCanvas />
    </div>

    <ContextMenu />
    <SettingsPanel />
  </div>
</div>

{#if output.printDialog}
  <PrintDialog preview={output.printDialog.preview} />
{/if}
{#if help.open}
  <HelpDialog />
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .app-container {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  .main-section {
    flex: 1;
    min-width: 0;
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>
