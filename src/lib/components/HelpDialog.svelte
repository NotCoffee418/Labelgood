<!-- Mouse and keyboard reference. Shown while help.open is set. -->
<script lang="ts">
  import { help } from '#lib/state/help.svelte.ts';

  const SECTIONS: { title: string; rows: [keys: string, action: string][] }[] = [
    {
      title: 'Selecting',
      rows: [
        ['Click', 'Select an element'],
        ['Shift / Ctrl + click', 'Add to or remove from the selection'],
        ['Drag on empty space', 'Select everything the rectangle touches'],
        ['Click the selected element, or Alt + click', 'Select the element beneath it'],
        ['Ctrl + A', 'Select all'],
        ['Esc', 'Deselect'],
      ],
    },
    {
      title: 'Moving and resizing',
      rows: [
        ['Drag', 'Move'],
        ['Arrow keys', 'Nudge 1 px (Shift: 10 px)'],
        ['Drag a handle', 'Resize freely'],
        ['Shift + drag a handle', 'Resize keeping the proportions'],
        ['Ctrl + drag a handle', 'Resize to a square'],
        ['Drag a line end', 'Snaps to horizontal or vertical (Shift: free)'],
        ['Ctrl + R', 'Rotate right (Shift: left)'],
      ],
    },
    {
      title: 'Editing',
      rows: [
        ['Double-click, or Enter', 'Edit a text box'],
        ['Esc', 'Stop editing'],
        ['Ctrl + C / X / V', 'Copy, cut, paste'],
        ['Ctrl + D', 'Duplicate'],
        ['Delete', 'Delete the selection'],
        ['Ctrl + Z', 'Undo'],
        ['Ctrl + Shift + Z, or Ctrl + Y', 'Redo'],
        ['Right-click', 'Context menu'],
      ],
    },
    {
      title: 'View',
      rows: [
        ['Ctrl + wheel', 'Zoom'],
        ['Wheel', 'Scroll along the longer direction (Shift: the other)'],
        ['Middle-drag', 'Pan'],
        ['F1', 'This help'],
      ],
    },
    {
      title: 'Files and output',
      rows: [
        ['Ctrl + N', 'New label'],
        ['Ctrl + O', 'Open a label'],
        ['Ctrl + S', 'Save (Shift: save as)'],
        ['Ctrl + P', 'Print'],
      ],
    },
  ];
</script>

<div class="modal-backdrop" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) help.open = false; }}>
  <div class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
    <h2 id="help-title">Shortcuts</h2>
    <div class="help-body">
      {#each SECTIONS as section (section.title)}
        <section>
          <h3>{section.title}</h3>
          <dl>
            {#each section.rows as [keys, action] (keys)}
              <dt>{keys}</dt>
              <dd>{action}</dd>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
    <div class="dialog-actions">
      <button class="secondary-button" onclick={() => help.open = false}>Close</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(0, 0, 0, 0.45);
  }

  .help-dialog {
    width: min(820px, 100%);
    max-height: 100%;
    overflow: auto;
    padding: 20px 24px;
    background: var(--surface);
    border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  }

  h2 {
    margin: 0 0 16px 0;
    font-size: 20px;
  }

  .help-body {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px 32px;
  }

  @media (max-width: 700px) {
    .help-body {
      grid-template-columns: 1fr;
    }
  }

  h3 {
    margin: 0 0 8px 0;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-subtle);
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 0;
    font-size: 13px;
  }

  dt {
    color: var(--text);
    font-weight: 500;
  }

  dd {
    margin: 0;
    color: var(--text-muted);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }
</style>
