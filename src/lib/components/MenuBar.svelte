<!-- The menu bar: file commands, view settings and help, and the open file's name -->
<script lang="ts">
  import { keepTextFocus } from '#lib/dom.ts';
  import { LINKS, checkForUpdates, openLink, showAbout } from '#lib/state/about.ts';
  import { setZoom, zoomToFit } from '#lib/state/canvas.svelte.ts';
  import {
    clearRecent, fileName, folderName, labelDocument, newLabel, openLabel, saveLabel, saveLabelAs,
  } from '#lib/state/document.svelte.ts';
  import {
    discardAllRecovery, entryName, entryTime, recovery, refreshRecovery, restoreRecovery,
  } from '#lib/state/recovery.svelte.ts';
  import {
    editCopy, editCut, editDelete, editDuplicate, editPaste, editRedo, editSelectAll, editUndo, editingText,
  } from '#lib/state/edit.ts';
  import { editor, history } from '#lib/state/editor.svelte.ts';
  import { help } from '#lib/state/help.svelte.ts';
  import { openPrintDialog, output, savePdf } from '#lib/state/output.svelte.ts';
  import { settings } from '#lib/state/settings.svelte.ts';
  import type { Theme } from '#lib/types.ts';

  type Item = {
    label: string;
    shortcut?: string; // or a note, shown on the right
    hint?: string; // tooltip
    checked?: boolean;
    disabled?: boolean;
    action?: () => unknown;
    submenu?: Item[]; // opens to the side instead of running an action
  } | 'separator';

  const THEMES: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System theme' },
    { value: 'light', label: 'Light theme' },
    { value: 'dark', label: 'Dark theme' },
  ];

  const menus = $derived.by<{ title: string; items: Item[] }[]>(() => {
    const inText = editingText();
    const nothingSelected = !inText && editor.selectedIds.length === 0;
    return [
      {
        title: 'File',
        items: [
          { label: 'New', shortcut: 'Ctrl+N', action: newLabel },
          { label: 'Open…', shortcut: 'Ctrl+O', action: openLabel },
          {
            label: 'Open Recent',
            submenu: labelDocument.recent.length === 0
              ? [{ label: 'No recent labels', disabled: true }]
              : [
                ...labelDocument.recent.map((path): Item => ({
                  label: fileName(path), shortcut: folderName(path), hint: path, action: () => openLabel(path),
                })),
                'separator',
                { label: 'Clear Recent Files', action: clearRecent },
              ],
          },
          'separator',
          { label: 'Save', shortcut: 'Ctrl+S', action: saveLabel },
          { label: 'Save As…', shortcut: 'Ctrl+Shift+S', action: saveLabelAs },
          {
            label: 'Auto Save', checked: labelDocument.autoSave,
            hint: 'Save labels that have a file shortly after each change',
            action: () => labelDocument.autoSave = !labelDocument.autoSave,
          },
          {
            label: 'Recover Unsaved Labels',
            submenu: recovery.entries.length === 0
              ? [{ label: 'Nothing to recover', disabled: true }]
              : [
                ...recovery.entries.map((entry): Item => ({
                  label: entryName(entry), shortcut: entryTime(entry), hint: entry.path ?? 'Never saved',
                  action: () => restoreRecovery(entry),
                })),
                'separator',
                { label: 'Discard All…', action: discardAllRecovery },
              ],
          },
          'separator',
          { label: 'Save PDF…', disabled: output.busy, action: savePdf },
          { label: 'Print…', shortcut: 'Ctrl+P', disabled: output.busy, action: openPrintDialog },
        ],
      },
      {
        title: 'Edit',
        items: [
          { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !inText && !history.canUndo, action: editUndo },
          { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !inText && !history.canRedo, action: editRedo },
          'separator',
          { label: 'Cut', shortcut: 'Ctrl+X', disabled: nothingSelected, action: editCut },
          { label: 'Copy', shortcut: 'Ctrl+C', disabled: nothingSelected, action: editCopy },
          { label: 'Paste', shortcut: 'Ctrl+V', action: editPaste },
          { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: inText || nothingSelected, action: editDuplicate },
          { label: 'Delete', shortcut: 'Del', disabled: nothingSelected, action: editDelete },
          'separator',
          { label: 'Select All', shortcut: 'Ctrl+A', action: editSelectAll },
        ],
      },
      {
        title: 'View',
        items: [
          ...THEMES.map(theme => ({
            label: theme.label, checked: settings.theme === theme.value, action: () => settings.theme = theme.value,
          })),
          'separator',
          { label: 'Zoom to fit', action: zoomToFit },
          { label: 'Actual size', action: () => setZoom(1) },
        ],
      },
      {
        title: 'Help',
        items: [
          { label: 'Shortcuts', shortcut: 'F1', action: () => help.open = true },
          { label: 'Supported Printers', action: () => openLink(LINKS.supportedPrinters) },
          'separator',
          { label: 'Report a Problem…', action: () => openLink(LINKS.newIssue) },
          { label: 'Labelgood on GitHub', action: () => openLink(LINKS.repo) },
          'separator',
          { label: 'Check for Updates…', action: checkForUpdates },
          { label: 'About Labelgood', action: showAbout },
        ],
      },
    ];
  });

  let openMenu = $state<string | null>(null);
  let openSubmenu = $state<string | null>(null);

  function showMenu(title: string | null) {
    openMenu = title;
    openSubmenu = null;
    if (title === 'File') refreshRecovery(); // another window may have ended since
  }

  function run(item: Exclude<Item, 'separator'>) {
    showMenu(null);
    item.action?.();
  }

  // Clicking anywhere else closes the menu
  function handleWindowMouseDown(event: MouseEvent) {
    if (openMenu && !(event.target as HTMLElement).closest('.menu-bar')) showMenu(null);
  }
</script>

<svelte:window onmousedown={handleWindowMouseDown} onkeydown={(e) => { if (openMenu && e.key === 'Escape') showMenu(null); }} />

<!-- A menu's items; `nested` for a submenu's -->
{#snippet entries(items: Item[], nested: boolean)}
  {#each items as item}
    {#if item === 'separator'}
      <hr />
    {:else if item.submenu}
      <div class="submenu-anchor" role="none" onmouseenter={() => openSubmenu = item.label}>
        <button
          role="menuitem"
          class:active={openSubmenu === item.label}
          aria-haspopup="menu"
          aria-expanded={openSubmenu === item.label}
          onmousedown={keepTextFocus}
          onclick={() => openSubmenu = item.label}
        >
          <span class="check"></span>
          <span class="item-label">{item.label}</span>
          <span class="shortcut">›</span>
        </button>
        {#if openSubmenu === item.label}
          <div class="menu-items submenu" role="menu">
            {@render entries(item.submenu, true)}
          </div>
        {/if}
      </div>
    {:else}
      <button
        role="menuitem"
        title={item.hint}
        disabled={item.disabled}
        onmousedown={keepTextFocus}
        onmouseenter={() => { if (!nested) openSubmenu = null; }}
        onclick={() => run(item)}
      >
        <span class="check">{item.checked ? '✓' : ''}</span>
        <span class="item-label">{item.label}</span>
        <span class="shortcut">{item.shortcut ?? ''}</span>
      </button>
    {/if}
  {/each}
{/snippet}

<nav class="menu-bar" aria-label="Menu">
  <img class="app-logo" src="/logo.svg" alt="Labelgood" />
  {#each menus as menu (menu.title)}
    <div class="menu">
      <button
        class="menu-title"
        class:open={openMenu === menu.title}
        aria-haspopup="menu"
        aria-expanded={openMenu === menu.title}
        onmousedown={(e) => { e.preventDefault(); showMenu(openMenu === menu.title ? null : menu.title); }}
        onmouseenter={() => { if (openMenu && openMenu !== menu.title) showMenu(menu.title); }}
      >{menu.title}</button>
      {#if openMenu === menu.title}
        <div class="menu-items" role="menu">
          {@render entries(menu.items, false)}
        </div>
      {/if}
    </div>
  {/each}

  <div class="document-name" title={labelDocument.path ?? 'Not saved yet'}>
    {labelDocument.name}{#if labelDocument.dirty}<span class="dirty" title="Unsaved changes"> •</span>{/if}
  </div>
</nav>

<style>
  .menu-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 8px;
    height: 32px;
    flex-shrink: 0;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    user-select: none;
  }

  .app-logo {
    width: 18px;
    height: 18px;
    margin-right: 6px;
  }

  .menu {
    position: relative;
  }

  .menu-title {
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text);
    font-size: 13px;
    cursor: default;
  }

  .menu-title:hover,
  .menu-title.open {
    background: var(--surface-muted);
  }

  .menu-items {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    z-index: 1500;
    min-width: 230px;
    padding: 4px 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 20px var(--shadow);
  }

  .menu-items button {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 12px 6px 4px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .menu-items button:hover:not(:disabled),
  .menu-items button.active {
    background: var(--accent);
    color: white;
  }

  .menu-items button:hover:not(:disabled) .shortcut,
  .menu-items button.active .shortcut {
    color: rgba(255, 255, 255, 0.8);
  }

  .menu-items button:disabled {
    color: var(--text-subtle);
    cursor: default;
  }

  .check {
    width: 20px;
    text-align: center;
    flex-shrink: 0;
  }

  .item-label {
    flex: 1;
  }

  .shortcut {
    margin-left: 24px;
    color: var(--text-subtle);
  }

  .submenu-anchor {
    position: relative;
  }

  .menu-items.submenu {
    top: -5px;
    left: calc(100% - 2px);
  }

  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }

  .document-name {
    margin-left: auto;
    padding-right: 4px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dirty {
    color: var(--accent);
  }
</style>
