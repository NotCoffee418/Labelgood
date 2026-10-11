<script lang="ts">
  import { tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { dirname, join } from '@tauri-apps/api/path';
  import { save } from '@tauri-apps/plugin-dialog';
  import html2canvas from 'html2canvas';

  type TextStyle = {
    fontFamily: string;
    fontSize: number; // pt
    color: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
  };

  type TextBox = {
    id: number;
    x: number; // px, relative to the label as displayed
    y: number;
    html: string;
    style: TextStyle;
  };

  const SETTINGS_KEY = 'labelgood-settings';
  const PX_PER_MM = 96 / 25.4;
  const PRINT_DPI = 300;

  const GENERIC_FONTS = [
    { value: 'sans-serif', label: 'Sans Serif (system default)' },
    { value: 'serif', label: 'Serif (system default)' },
    { value: 'monospace', label: 'Monospace (system default)' },
  ];
  // Used when the system font list can't be read (no fontconfig, e.g. Windows)
  const FALLBACK_FONTS = [
    'Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia',
    'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
  ];

  // State for label dimensions
  let width = $state(62);
  let height = $state(30);
  let continuousWidth = $state(false);
  let continuousHeight = $state(false);
  let orientation = $state<"landscape" | "portrait">("landscape");

  // Reference to the label element, which is what gets captured for printing
  let contentElement: HTMLDivElement;

  const INITIAL_STYLE: TextStyle = {
    fontFamily: 'sans-serif',
    fontSize: 12,
    color: '#000000',
    bold: false,
    italic: false,
    underline: false,
  };

  // Formatting applied to new text boxes
  let defaultStyle = $state<TextStyle>({ ...INITIAL_STYLE });

  let theme = $state<"system" | "light" | "dark">("system");
  let systemFonts = $state<string[]>([]);

  // State for output
  let printers = $state<string[]>([]);
  let selectedPrinter = $state<string>("");
  let printMode = $state<"pdf" | "print">("pdf"); // pdf = save to file, print = send to printer
  let lastSaveDir = $state<string | null>(null);
  let busy = $state(false);
  let status = $state<{ text: string; error: boolean } | null>(null);

  let textBoxes = $state<TextBox[]>([
    { id: 1, x: 10, y: 10, html: 'Sample Label Text', style: { ...INITIAL_STYLE } }
  ]);

  // Selection / editing state
  let selectedBoxId = $state<number | null>(null);
  let editingBoxId = $state<number | null>(null);
  let hasTextSelection = $state(false);
  let selectionMarks = $state({ bold: false, italic: false, underline: false });
  let selectionStyle = $state<Pick<TextStyle, 'fontFamily' | 'fontSize' | 'color'> | null>(null);
  let savedRange: Range | null = null;
  const editors = new Map<number, HTMLElement>();

  // Dragging state
  let draggingBox = $state<number | null>(null);
  let dragElement: HTMLElement | null = null;
  let dragOffset = { x: 0, y: 0 };
  let resizingLabel = $state(false);
  let resizeStartPos = { x: 0, y: 0 };
  let resizeStartDimension = 0;

  // Handle continuous checkbox mutual exclusion
  function handleContinuousWidth() {
    if (continuousWidth) {
      continuousHeight = false;
    }
  }

  function handleContinuousHeight() {
    if (continuousHeight) {
      continuousWidth = false;
    }
  }

  // Actual label dimensions (respecting continuous settings), used for printing
  const actualWidth = $derived(continuousWidth ? Math.max(width, 10) : width);
  const actualHeight = $derived(continuousHeight ? Math.max(height, 10) : height);

  // Whether the label's long edge (its length) is the width.
  // A continuous dimension is always the length, so dragging it never flips the view.
  const lengthIsWidth = $derived(
    continuousWidth || (!continuousHeight && actualWidth >= actualHeight)
  );

  // Landscape shows the long edge horizontally, portrait vertically.
  // The view is rotated when the label's natural shape doesn't match the orientation.
  const viewRotation = $derived<"normal" | "rotated">(
    (orientation === "landscape") === lengthIsWidth ? "normal" : "rotated"
  );

  // Dimensions of the label as displayed (swapped when the view is rotated)
  const renderWidth = $derived(viewRotation === "rotated" ? actualHeight : actualWidth);
  const renderHeight = $derived(viewRotation === "rotated" ? actualWidth : actualHeight);

  // Edge of the view that resizes the continuous dimension.
  // When the view is rotated, label width runs vertically and height horizontally.
  const resizeEdge = $derived(
    continuousWidth ? (viewRotation === "rotated" ? "bottom" : "right")
    : continuousHeight ? (viewRotation === "rotated" ? "right" : "bottom")
    : null
  );

  const selectedBox = $derived(textBoxes.find(b => b.id === selectedBoxId) ?? null);

  // What the formatting toolbar changes: the selected text, the selected box, or new boxes
  const formatScope = $derived<"selection" | "box" | "defaults">(
    hasTextSelection && editingBoxId !== null ? "selection" : selectedBox ? "box" : "defaults"
  );
  const activeStyle = $derived(selectedBox?.style ?? defaultStyle);
  const activeMarks = $derived(formatScope === "selection" ? selectionMarks : activeStyle);
  // What the toolbar shows: the selected text's formatting when there is a selection
  const displayStyle = $derived(
    formatScope === "selection" && selectionStyle ? { ...activeStyle, ...selectionStyle } : activeStyle
  );

  const fontOptions = $derived.by(() => {
    const fonts = systemFonts.length > 0 ? systemFonts : FALLBACK_FONTS;
    const current = displayStyle.fontFamily;
    const known = GENERIC_FONTS.some(f => f.value === current) || fonts.includes(current);
    return known ? fonts : [current, ...fonts];
  });

  // Reads the formatting at the start of a selection from the rendered text
  function styleAtRange(range: Range): Pick<TextStyle, 'fontFamily' | 'fontSize' | 'color'> | null {
    const node = range.startContainer;
    const el = node instanceof Element ? node : node.parentElement;
    if (!el) return null;
    const computed = getComputedStyle(el);
    const [r, g, b] = computed.color.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
    return {
      fontFamily: computed.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''),
      fontSize: Math.round(parseFloat(computed.fontSize) * 0.75 * 2) / 2, // px -> pt, nearest 0.5
      color: '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join(''),
    };
  }

  function cssFontFamily(family: string): string {
    if (GENERIC_FONTS.some(f => f.value === family)) return family;
    return `"${family.replace(/"/g, '')}", sans-serif`;
  }

  // Restore the last used settings
  function loadSettings() {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (!saved) return;
      const s = JSON.parse(saved);
      width = s.width ?? width;
      height = s.height ?? height;
      continuousWidth = s.continuousWidth ?? continuousWidth;
      continuousHeight = s.continuousHeight ?? continuousHeight;
      orientation = s.orientation ?? orientation;
      theme = s.theme ?? theme;
      defaultStyle = { ...defaultStyle, ...s.defaultStyle };
      printMode = s.printMode === "print" ? "print" : "pdf";
      selectedPrinter = s.selectedPrinter ?? selectedPrinter;
      lastSaveDir = s.lastSaveDir ?? lastSaveDir;
      textBoxes[0].style = { ...defaultStyle };
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  loadSettings();

  // Save settings whenever they change
  $effect(() => {
    const settings = {
      width, height, continuousWidth, continuousHeight, orientation, theme,
      defaultStyle, printMode, selectedPrinter, lastSaveDir
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  });

  // Apply the theme. "system" leaves it to prefers-color-scheme.
  $effect(() => {
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
    // Match the native window frame (getCurrentWindow throws outside Tauri)
    try {
      getCurrentWindow().setTheme(theme === "system" ? null : theme).catch(() => {});
    } catch {}
  });

  async function loadPrinters() {
    try {
      const printerList = await invoke<string[]>('list_printers');
      printers = printerList;
      // Keep the current selection if that printer is still available
      if (!printerList.includes(selectedPrinter)) {
        selectedPrinter = printerList[0] ?? "";
      }
    } catch (error) {
      console.error('Failed to load printers:', error);
      // Don't show an error to the user, just leave printers empty
    }
  }

  async function loadFonts() {
    try {
      systemFonts = await invoke<string[]>('list_fonts');
    } catch (error) {
      console.error('Failed to load fonts:', error);
    }
  }

  $effect(() => {
    loadPrinters();
    loadFonts();
  });

  // ---- Text editing & formatting ----

  // Registers a text box's editable element and fills in its initial content
  function editor(node: HTMLElement, box: TextBox) {
    node.innerHTML = box.html;
    editors.set(box.id, node);
    return {
      destroy() {
        editors.delete(box.id);
      }
    };
  }

  function caretRangeAt(x: number, y: number): Range | null {
    const doc = document as any;
    if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
    const pos = doc.caretPositionFromPoint?.(x, y);
    if (!pos) return null;
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  }

  async function startEditing(boxId: number, event?: MouseEvent) {
    selectedBoxId = boxId;
    editingBoxId = boxId;
    await tick();
    const el = editors.get(boxId);
    if (!el) return;
    el.focus();
    // Put the caret where the user double-clicked, or select everything
    let range = event ? caretRangeAt(event.clientX, event.clientY) : null;
    if (!range || !el.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
    }
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function stopEditing() {
    if (editingBoxId === null) return;
    const id = editingBoxId;
    const el = editors.get(id);
    editingBoxId = null;
    hasTextSelection = false;
    savedRange = null;
    if (el) {
      el.blur();
      // Drop boxes that were left empty
      if (!el.textContent?.trim()) {
        deleteTextBox(id);
      }
    }
  }

  function deselect() {
    stopEditing();
    selectedBoxId = null;
  }

  function handleSelectionChange() {
    if (editingBoxId === null) return;
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const node = sel.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    // Ignore selection moving elsewhere (e.g. into a toolbar input) so it can still be formatted
    if (!el || el.closest('.text-box-content') !== editors.get(editingBoxId)) return;

    if (sel.isCollapsed) {
      savedRange = null;
      hasTextSelection = false;
    } else {
      savedRange = sel.getRangeAt(0).cloneRange();
      hasTextSelection = true;
      selectionStyle = styleAtRange(savedRange);
      selectionMarks = {
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      };
    }
  }

  function handlePaste(event: ClipboardEvent) {
    // Paste as plain text so formatting from other apps doesn't leak in
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
  }

  const CSS_PROPERTY: Record<keyof TextStyle, string> = {
    fontFamily: 'font-family',
    fontSize: 'font-size',
    color: 'color',
    bold: 'font-weight',
    italic: 'font-style',
    underline: 'text-decoration',
  };
  const FORMAT_TAGS: Partial<Record<keyof TextStyle, string[]>> = {
    bold: ['B', 'STRONG'],
    italic: ['I', 'EM'],
    underline: ['U'],
  };
  const FONT_ATTRIBUTE: Partial<Record<keyof TextStyle, string>> = {
    fontFamily: 'face',
    fontSize: 'size',
    color: 'color',
  };

  function unwrap(el: Element) {
    el.replaceWith(...el.childNodes);
  }

  // Removes per-selection overrides of one property, so a box-wide change applies everywhere
  function clearInlineFormat(root: HTMLElement, key: keyof TextStyle) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      el.style.removeProperty(CSS_PROPERTY[key]);
      if (key === 'underline') el.style.removeProperty('text-decoration-line');
      const attr = FONT_ATTRIBUTE[key];
      if (attr && el.tagName === 'FONT') el.removeAttribute(attr);
      if (el.getAttribute('style') === '') el.removeAttribute('style');

      const isFormatTag = FORMAT_TAGS[key]?.includes(el.tagName);
      const isEmptyWrapper = (el.tagName === 'SPAN' || el.tagName === 'FONT') && el.attributes.length === 0;
      if (isFormatTag || isEmptyWrapper) unwrap(el);
    }
  }

  function applyToSelection(box: TextBox, key: keyof TextStyle, value: TextStyle[keyof TextStyle]) {
    const el = editors.get(box.id);
    if (!el || !savedRange) return;
    el.focus();
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(savedRange);

    document.execCommand('styleWithCSS', false, 'true');
    switch (key) {
      case 'bold':
      case 'italic':
      case 'underline':
        document.execCommand(key);
        break;
      case 'color':
        document.execCommand('foreColor', false, value as string);
        break;
      case 'fontFamily':
        document.execCommand('fontName', false, value as string);
        break;
      case 'fontSize': {
        // execCommand only knows sizes 1-7: mark the selection with size 7,
        // then swap those markers for spans with the real size
        document.execCommand('styleWithCSS', false, 'false');
        document.execCommand('fontSize', false, '7');
        const spans: HTMLSpanElement[] = [];
        for (const font of Array.from(el.querySelectorAll('font[size="7"]'))) {
          font.querySelectorAll<HTMLElement>('[style]').forEach(child => child.style.removeProperty('font-size'));
          const span = document.createElement('span');
          span.style.fontSize = `${value}pt`;
          span.append(...font.childNodes);
          font.replaceWith(span);
          spans.push(span);
        }
        if (spans.length > 0) {
          const range = document.createRange();
          range.setStartBefore(spans[0]);
          range.setEndAfter(spans[spans.length - 1]);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        break;
      }
    }

    box.html = el.innerHTML;
    handleSelectionChange();
  }

  function applyFormat<K extends keyof TextStyle>(key: K, value: TextStyle[K]) {
    const box = selectedBox;
    if (formatScope === "selection" && box) {
      applyToSelection(box, key, value);
    } else if (box) {
      box.style[key] = value;
      const el = editors.get(box.id);
      if (el) {
        clearInlineFormat(el, key);
        box.html = el.innerHTML;
      }
    } else {
      defaultStyle[key] = value;
    }
  }

  function toggleFormat(key: 'bold' | 'italic' | 'underline') {
    applyFormat(key, !activeMarks[key]);
  }

  function handleFontSizeChange(event: Event) {
    const size = parseFloat((event.currentTarget as HTMLInputElement).value);
    if (size > 0) {
      applyFormat('fontSize', Math.min(Math.max(size, 4), 200));
    }
  }

  // ---- Boxes: selection, dragging, keyboard ----

  function handleBoxMouseDown(event: MouseEvent, boxId: number) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('.delete-btn')) return;
    // Let the user select text inside the box being edited
    if (editingBoxId === boxId && target.closest('.text-box-content')) return;

    if (editingBoxId !== boxId) {
      stopEditing();
    }
    selectedBoxId = boxId;

    event.preventDefault();
    draggingBox = boxId;
    dragElement = event.currentTarget as HTMLElement;
    const rect = dragElement.getBoundingClientRect();
    dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handleCanvasMouseDown(event: MouseEvent) {
    // Clicking empty space deselects
    if (!(event.target as HTMLElement).closest('.text-box, .resize-handle')) {
      deselect();
    }
  }

  function handleMouseMove(event: MouseEvent) {
    if (draggingBox === null || !contentElement) return;
    const box = textBoxes.find(b => b.id === draggingBox);
    if (!box) return;
    const container = contentElement.getBoundingClientRect();
    const newX = event.clientX - container.left - dragOffset.x;
    const newY = event.clientY - container.top - dragOffset.y;
    // Keep the box inside the label
    const maxX = container.width - (dragElement?.offsetWidth ?? 0);
    const maxY = container.height - (dragElement?.offsetHeight ?? 0);
    box.x = Math.round(Math.max(0, Math.min(newX, maxX)));
    box.y = Math.round(Math.max(0, Math.min(newY, maxY)));
  }

  function handleKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (event.key === 'Escape') {
      if (editingBoxId !== null) stopEditing();
      else selectedBoxId = null;
      return;
    }
    // Other shortcuts only apply to a selected box that isn't being edited
    if (selectedBoxId === null || editingBoxId !== null) return;
    if (target.closest('input, select, textarea, [contenteditable="true"]')) return;

    const box = selectedBox;
    if (!box) return;
    const step = event.shiftKey ? 10 : 1;
    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        deleteTextBox(box.id);
        break;
      case 'Enter':
        startEditing(box.id);
        break;
      case 'ArrowLeft': box.x = Math.max(0, box.x - step); break;
      case 'ArrowRight': box.x += step; break;
      case 'ArrowUp': box.y = Math.max(0, box.y - step); break;
      case 'ArrowDown': box.y += step; break;
      default: return;
    }
    event.preventDefault();
  }

  function stopDrag() {
    draggingBox = null;
    dragElement = null;
    resizingLabel = false;
  }

  function addTextBox() {
    const newId = Math.max(...textBoxes.map(b => b.id), 0) + 1;
    const offset = (textBoxes.length % 5) * 12;
    textBoxes.push({ id: newId, x: 10 + offset, y: 10 + offset, html: 'New Text', style: { ...defaultStyle } });
    stopEditing();
    startEditing(newId);
  }

  function deleteTextBox(boxId: number) {
    textBoxes = textBoxes.filter(b => b.id !== boxId);
    if (selectedBoxId === boxId) selectedBoxId = null;
    if (editingBoxId === boxId) {
      editingBoxId = null;
      hasTextSelection = false;
      savedRange = null;
    }
  }

  // ---- Continuous label resizing ----

  function startResize(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    resizingLabel = true;
    resizeStartPos = { x: event.clientX, y: event.clientY };
    resizeStartDimension = continuousWidth ? width : height;
  }

  function handleGlobalMouseMove(event: MouseEvent) {
    if (resizingLabel) {
      // Change in pixels along the handle's axis, converted to whole millimetres
      const deltaPx = resizeEdge === "right"
        ? event.clientX - resizeStartPos.x
        : event.clientY - resizeStartPos.y;
      const newDimension = Math.max(10, Math.round(resizeStartDimension + deltaPx / PX_PER_MM));
      if (continuousWidth) {
        width = newDimension;
      } else if (continuousHeight) {
        height = newDimension;
      }
      return;
    }
    handleMouseMove(event);
  }

  // ---- Output ----

  async function renderLabelPng(): Promise<string> {
    // Pixel size of the label at print resolution
    const targetWidthPx = Math.round(actualWidth / 25.4 * PRINT_DPI);
    const targetHeightPx = Math.round(actualHeight / 25.4 * PRINT_DPI);

    // Capture straight at print resolution. The capture works on a clone of the
    // DOM, so editor chrome is hidden there without touching the live editor.
    const canvas = await html2canvas(contentElement, {
      backgroundColor: '#ffffff',
      scale: PRINT_DPI / 96,
      logging: false,
      ignoreElements: (el) => el.classList.contains('resize-handle') || el.classList.contains('delete-btn'),
      onclone: (_doc, el) => el.classList.add('capturing'),
    });

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = targetWidthPx;
    finalCanvas.height = targetHeightPx;
    const ctx = finalCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    if (viewRotation === "rotated") {
      // The capture is the label as displayed (height wide, width tall).
      // Rotate it 90° clockwise back to the label's real orientation; in the
      // rotated coordinate system the axes are swapped.
      ctx.translate(targetWidthPx / 2, targetHeightPx / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(canvas, -targetHeightPx / 2, -targetWidthPx / 2, targetHeightPx, targetWidthPx);
    } else {
      ctx.drawImage(canvas, 0, 0, targetWidthPx, targetHeightPx);
    }

    return finalCanvas.toDataURL('image/png');
  }

  async function handleOutput() {
    if (busy || !contentElement) return;
    status = null;

    if (!(actualWidth > 0) || !(actualHeight > 0)) {
      status = { text: 'Enter a valid label width and height.', error: true };
      return;
    }
    if (printMode === "print" && !selectedPrinter) {
      status = { text: 'Select a printer first.', error: true };
      return;
    }

    busy = true;
    try {
      let outputPath: string | null = null;
      if (printMode === "pdf") {
        const fileName = `label-${actualWidth}x${actualHeight}mm.pdf`;
        outputPath = await save({
          defaultPath: lastSaveDir ? await join(lastSaveDir, fileName) : fileName,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (!outputPath) return; // cancelled
        if (!outputPath.toLowerCase().endsWith('.pdf')) outputPath += '.pdf';
        lastSaveDir = await dirname(outputPath);
      }

      const result = await invoke<string>('generate_pdf', {
        options: {
          image_data: await renderLabelPng(),
          width_mm: actualWidth,
          height_mm: actualHeight,
          printer_name: printMode === "print" ? selectedPrinter : null,
          output_path: outputPath,
        }
      });
      status = { text: result, error: false };
    } catch (error) {
      console.error('Output failed:', error);
      status = { text: String(error), error: true };
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onmouseup={stopDrag} onmousemove={handleGlobalMouseMove} onkeydown={handleKeyDown} />
<svelte:document onselectionchange={handleSelectionChange} />

<div class="app-container">
  <div class="main-section">
    <header class="app-header">
      <h1>Label Editor</h1>
      <div class="theme-switch" role="radiogroup" aria-label="Theme">
        {#each [["system", "System"], ["light", "Light"], ["dark", "Dark"]] as [value, label]}
          <label class:active={theme === value}>
            <input type="radio" name="theme" {value} bind:group={theme} />
            {label}
          </label>
        {/each}
      </div>
    </header>

    <!-- Formatting toolbar: applies to selected text, else the selected box, else new boxes -->
    <div class="font-controls">
      <div class="toolbar-row">
        <select
          class="font-select"
          aria-label="Font"
          value={displayStyle.fontFamily}
          onchange={(e) => applyFormat('fontFamily', e.currentTarget.value)}
        >
          {#each GENERIC_FONTS as font}
            <option value={font.value}>{font.label}</option>
          {/each}
          <option disabled>──────────</option>
          {#each fontOptions as font}
            <option value={font}>{font}</option>
          {/each}
        </select>

        <div class="size-control">
          <input
            type="number"
            aria-label="Font size"
            value={displayStyle.fontSize}
            min="4"
            max="200"
            step="1"
            onchange={handleFontSizeChange}
          />
          <span>pt</span>
        </div>

        <div class="toggle-group" role="group" aria-label="Text style">
          <button
            class="toggle-btn bold"
            class:active={activeMarks.bold}
            title="Bold"
            aria-pressed={activeMarks.bold}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => toggleFormat('bold')}
          >B</button>
          <button
            class="toggle-btn italic"
            class:active={activeMarks.italic}
            title="Italic"
            aria-pressed={activeMarks.italic}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => toggleFormat('italic')}
          >I</button>
          <button
            class="toggle-btn underline"
            class:active={activeMarks.underline}
            title="Underline"
            aria-pressed={activeMarks.underline}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => toggleFormat('underline')}
          >U</button>
        </div>

        <input
          type="color"
          title="Text color"
          aria-label="Text color"
          value={displayStyle.color}
          onchange={(e) => applyFormat('color', e.currentTarget.value)}
        />

        <button class="add-textbox-btn" onclick={addTextBox}>
          Add Text Box
        </button>
      </div>
      <p class="format-scope">
        {#if formatScope === "selection"}
          Formatting applies to the <strong>selected text</strong>
        {:else if formatScope === "box"}
          Formatting applies to the <strong>selected text box</strong> · double-click to edit text
        {:else}
          Formatting applies to <strong>new text boxes</strong> · click a box to select it
        {/if}
      </p>
    </div>

    <!-- Label Preview -->
    <div class="preview-container" role="presentation" onmousedown={handleCanvasMouseDown}>
      <div
        class="label-preview"
        style:width="{renderWidth}mm"
        style:height="{renderHeight}mm"
        bind:this={contentElement}
        role="region"
        aria-label="Label preview"
      >
        {#each textBoxes as box (box.id)}
          <div
            class="text-box"
            class:selected={selectedBoxId === box.id}
            class:editing={editingBoxId === box.id}
            class:dragging={draggingBox === box.id}
            style:left="{box.x}px"
            style:top="{box.y}px"
            onmousedown={(e) => handleBoxMouseDown(e, box.id)}
            ondblclick={(e) => { if (editingBoxId !== box.id) startEditing(box.id, e); }}
            role="button"
            tabindex="-1"
          >
            <button
              class="delete-btn"
              onclick={(e) => { e.stopPropagation(); deleteTextBox(box.id); }}
              title="Delete text box"
            >
              ×
            </button>
            <div
              class="text-box-content"
              contenteditable={editingBoxId === box.id ? "true" : "false"}
              role="textbox"
              tabindex="-1"
              aria-multiline="true"
              data-box-id={box.id}
              style:font-family={cssFontFamily(box.style.fontFamily)}
              style:font-size="{box.style.fontSize}pt"
              style:color={box.style.color}
              style:font-weight={box.style.bold ? 'bold' : 'normal'}
              style:font-style={box.style.italic ? 'italic' : 'normal'}
              style:text-decoration={box.style.underline ? 'underline' : 'none'}
              use:editor={box}
              oninput={(e) => box.html = e.currentTarget.innerHTML}
              onpaste={handlePaste}
            ></div>
          </div>
        {/each}

        <!-- Resize handles for continuous dimensions -->
        {#if resizeEdge === "right"}
          <div
            class="resize-handle resize-handle-right"
            onmousedown={startResize}
            title="Drag to resize {continuousWidth ? 'width' : 'height'}"
            role="button"
            tabindex="0"
          >
            <div class="resize-handle-indicator"></div>
          </div>
        {/if}

        {#if resizeEdge === "bottom"}
          <div
            class="resize-handle resize-handle-bottom"
            onmousedown={startResize}
            title="Drag to resize {continuousWidth ? 'width' : 'height'}"
            role="button"
            tabindex="0"
          >
            <div class="resize-handle-indicator"></div>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Settings Panel -->
  <aside class="settings-panel">
    <h2>Label Settings</h2>

    <div class="settings-group">
      <h3>Print Dimensions</h3>

      <div class="dimension-control">
        <label for="width">Width (mm)</label>
        <input
          id="width"
          type="number"
          bind:value={width}
          min="1"
          disabled={continuousWidth}
        />
        <label class="checkbox-label">
          <input
            type="checkbox"
            bind:checked={continuousWidth}
            onchange={handleContinuousWidth}
          />
          Continuous
        </label>
      </div>

      <div class="dimension-control">
        <label for="height">Height (mm)</label>
        <input
          id="height"
          type="number"
          bind:value={height}
          min="1"
          disabled={continuousHeight}
        />
        <label class="checkbox-label">
          <input
            type="checkbox"
            bind:checked={continuousHeight}
            onchange={handleContinuousHeight}
          />
          Continuous
        </label>
      </div>
    </div>

    <div class="settings-group">
      <h3>Orientation</h3>
      <div class="radio-group">
        <label class="radio-label">
          <input type="radio" name="orientation" value="landscape" bind:group={orientation} />
          Landscape
        </label>
        <label class="radio-label">
          <input type="radio" name="orientation" value="portrait" bind:group={orientation} />
          Portrait
        </label>
      </div>
    </div>

    <div class="settings-group">
      <h3>Output</h3>
      <div class="radio-group">
        <label class="radio-label">
          <input type="radio" name="printMode" value="pdf" bind:group={printMode} />
          Save as PDF
        </label>
        <label class="radio-label">
          <input type="radio" name="printMode" value="print" bind:group={printMode} />
          Send to Printer
        </label>
      </div>
    </div>

    {#if printMode === "print"}
      <div class="settings-group">
        <h3>Printer</h3>
        {#if printers.length > 0}
          <div class="printer-row">
            <select bind:value={selectedPrinter} class="printer-select" aria-label="Printer">
              {#each printers as printer}
                <option value={printer}>{printer}</option>
              {/each}
            </select>
            <button class="refresh-printers-btn" onclick={loadPrinters} title="Refresh printer list">
              ↻
            </button>
          </div>
        {:else}
          <p class="no-printers-text">No printers found. Make sure CUPS is running.</p>
          <button class="refresh-printers-btn" onclick={loadPrinters}>
            Refresh Printers
          </button>
        {/if}
      </div>
    {/if}

    <div class="output-footer">
      {#if status}
        <p class="status" class:error={status.error}>{status.text}</p>
      {/if}
      <button class="print-button" onclick={handleOutput} disabled={busy}>
        {#if busy}
          Working…
        {:else}
          {printMode === "pdf" ? "Save PDF…" : "Print"}
        {/if}
      </button>
    </div>
  </aside>
</div>

<style>
  /* Theme tokens: light by default, dark via system preference or explicit choice */
  :global(:root) {
    color-scheme: light;
    --bg: #f5f5f5;
    --surface: #ffffff;
    --surface-muted: #f0f0f0;
    --border: #dddddd;
    --text: #333333;
    --text-muted: #555555;
    --text-subtle: #777777;
    --accent: #007bff;
    --accent-hover: #0056b3;
    --accent-active: #004494;
    --accent-soft: rgba(0, 123, 255, 0.08);
    --success: #28a745;
    --success-hover: #218838;
    --danger: #dc3545;
    --danger-hover: #c82333;
    --neutral: #6c757d;
    --neutral-hover: #5a6268;
    --shadow: rgba(0, 0, 0, 0.1);
    --canvas-bg: #ffffff;
    --label-outline: #333333;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) {
      color-scheme: dark;
      --bg: #1b1d21;
      --surface: #25282d;
      --surface-muted: #2f3238;
      --border: #3c4047;
      --text: #e6e6e6;
      --text-muted: #b8bcc4;
      --text-subtle: #8b9099;
      --accent: #3b8eff;
      --accent-hover: #2f7ae6;
      --accent-active: #2566c2;
      --accent-soft: rgba(59, 142, 255, 0.15);
      --success: #2fa84f;
      --success-hover: #278d42;
      --danger: #e5484d;
      --danger-hover: #c93a3f;
      --neutral: #5a6069;
      --neutral-hover: #4a4f57;
      --shadow: rgba(0, 0, 0, 0.4);
      --canvas-bg: #1f2125;
      --label-outline: #8b9099;
    }
  }

  :global(:root[data-theme="dark"]) {
    color-scheme: dark;
    --bg: #1b1d21;
    --surface: #25282d;
    --surface-muted: #2f3238;
    --border: #3c4047;
    --text: #e6e6e6;
    --text-muted: #b8bcc4;
    --text-subtle: #8b9099;
    --accent: #3b8eff;
    --accent-hover: #2f7ae6;
    --accent-active: #2566c2;
    --accent-soft: rgba(59, 142, 255, 0.15);
    --success: #2fa84f;
    --success-hover: #278d42;
    --danger: #e5484d;
    --danger-hover: #c93a3f;
    --neutral: #5a6069;
    --neutral-hover: #4a4f57;
    --shadow: rgba(0, 0, 0, 0.4);
    --canvas-bg: #1f2125;
    --label-outline: #8b9099;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  :global(html, body) {
    height: 100%;
    overflow: hidden;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background-color: var(--bg);
    color: var(--text);
  }

  /* Thin scrollbars that only take space when content actually overflows */
  :global(*) {
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .app-container {
    display: flex;
    height: 100vh;
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

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }

  h1 {
    margin: 0;
    color: var(--text);
    font-size: 24px;
  }

  .theme-switch {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface);
  }

  .theme-switch label {
    padding: 4px 10px;
    font-size: 13px;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
  }

  .theme-switch label + label {
    border-left: 1px solid var(--border);
  }

  .theme-switch label.active {
    background: var(--accent);
    color: white;
  }

  .theme-switch input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .font-controls {
    padding: 12px 15px;
    background: var(--surface);
    border-radius: 8px;
    box-shadow: 0 2px 4px var(--shadow);
    margin-bottom: 20px;
  }

  .toolbar-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .font-select,
  .size-control input {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 14px;
    background-color: var(--surface);
    color: var(--text);
  }

  .font-select {
    width: 200px;
  }

  .size-control {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--text-muted);
  }

  .size-control input {
    width: 64px;
  }

  .toggle-group {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .toggle-btn {
    width: 32px;
    height: 32px;
    border: none;
    background: var(--surface);
    color: var(--text);
    font-size: 15px;
    font-family: Georgia, serif;
    cursor: pointer;
  }

  .toggle-btn + .toggle-btn {
    border-left: 1px solid var(--border);
  }

  .toggle-btn:hover {
    background: var(--surface-muted);
  }

  .toggle-btn.active {
    background: var(--accent);
    color: white;
  }

  .toggle-btn.bold { font-weight: bold; }
  .toggle-btn.italic { font-style: italic; }
  .toggle-btn.underline { text-decoration: underline; }

  .font-controls input[type="color"] {
    width: 40px;
    height: 32px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
  }

  .format-scope {
    margin: 10px 0 0 0;
    font-size: 12px;
    color: var(--text-subtle);
  }

  .format-scope strong {
    color: var(--text-muted);
  }

  .add-textbox-btn {
    margin-left: auto;
    padding: 7px 12px;
    background-color: var(--success);
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
    font-weight: 500;
  }

  .add-textbox-btn:hover {
    background-color: var(--success-hover);
  }

  .preview-container {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 40px;
    background: var(--canvas-bg);
    border-radius: 8px;
    box-shadow: 0 2px 4px var(--shadow);
    overflow: auto;
    min-height: 0;
  }

  /* The label itself is paper, so it stays white in every theme */
  .label-preview {
    flex-shrink: 0;
    background: white;
    position: relative;
    min-height: 1em;
    box-shadow: 0 0 0 2px var(--label-outline);
  }

  .resize-handle {
    position: absolute;
    background-color: var(--accent);
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .resize-handle-right {
    right: -6px;
    top: 50%;
    transform: translateY(-50%);
    width: 12px;
    height: 60px;
    cursor: ew-resize;
    border-radius: 6px;
  }

  .resize-handle-bottom {
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: 60px;
    height: 12px;
    cursor: ns-resize;
    border-radius: 6px;
  }

  .resize-handle:hover {
    background-color: var(--accent-hover);
  }

  .resize-handle-indicator {
    background-color: white;
    border-radius: 2px;
  }

  .resize-handle-right .resize-handle-indicator {
    width: 3px;
    height: 20px;
  }

  .resize-handle-bottom .resize-handle-indicator {
    width: 20px;
    height: 3px;
  }

  .text-box {
    position: absolute;
    cursor: move;
    padding: 4px;
    border: 1px dashed transparent;
    min-width: 20px;
    user-select: none;
  }

  .text-box:hover {
    border-color: #9cc6ff;
  }

  .text-box.selected {
    border-color: #007bff;
    border-style: solid;
    background-color: rgba(0, 123, 255, 0.05);
  }

  .text-box.editing {
    border-style: dashed;
    cursor: default;
  }

  .text-box.dragging {
    opacity: 0.8;
    cursor: grabbing;
  }

  .delete-btn {
    position: absolute;
    top: -10px;
    right: -10px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background-color: #dc3545;
    color: white;
    border: 2px solid white;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    display: none;
    padding: 0;
    align-items: center;
    justify-content: center;
    z-index: 5;
  }

  .text-box:hover .delete-btn,
  .text-box.selected .delete-btn {
    display: flex;
  }

  .delete-btn:hover {
    background-color: #c82333;
  }

  .text-box-content {
    outline: none;
    min-height: 1em;
    white-space: pre;
    line-height: 1.2;
  }

  .text-box.editing .text-box-content {
    cursor: text;
    user-select: text;
  }

  /* Applied to the cloned label when capturing for output */
  .label-preview:global(.capturing) .text-box {
    border-color: transparent;
    background: transparent;
  }

  .settings-panel {
    width: 340px;
    flex-shrink: 0;
    background: var(--surface);
    padding: 20px;
    box-shadow: -2px 0 8px var(--shadow);
    overflow-x: hidden;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .settings-panel h2 {
    margin: 0 0 16px 0;
    font-size: 20px;
    color: var(--text);
  }

  .settings-panel h3 {
    margin: 0 0 10px 0;
    font-size: 15px;
    color: var(--text-muted);
  }

  .settings-group {
    margin-bottom: 20px;
  }

  .dimension-control {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .dimension-control label[for] {
    width: 84px;
    flex-shrink: 0;
    white-space: nowrap;
    font-size: 14px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .dimension-control input[type="number"] {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 14px;
    background-color: var(--surface);
    color: var(--text);
  }

  .dimension-control input[type="number"]:disabled {
    background-color: var(--surface-muted);
    color: var(--text-subtle);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }

  .checkbox-label input[type="checkbox"] {
    cursor: pointer;
    width: 16px;
    height: 16px;
    margin: 0;
  }

  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
  }

  .radio-label input[type="radio"] {
    cursor: pointer;
    width: 16px;
    height: 16px;
    margin: 0;
  }

  .printer-row {
    display: flex;
    gap: 8px;
  }

  .printer-select {
    flex: 1;
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 14px;
    background-color: var(--surface);
    color: var(--text);
  }

  .refresh-printers-btn {
    padding: 6px 12px;
    background-color: var(--neutral);
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
    font-weight: 500;
  }

  .refresh-printers-btn:hover {
    background-color: var(--neutral-hover);
  }

  .no-printers-text {
    font-size: 14px;
    color: var(--danger);
    margin: 0 0 10px 0;
    line-height: 1.4;
  }

  .output-footer {
    margin-top: auto;
    flex-shrink: 0;
  }

  .status {
    margin: 0 0 10px 0;
    font-size: 13px;
    line-height: 1.4;
    color: var(--success);
    overflow-wrap: anywhere;
  }

  .status.error {
    color: var(--danger);
    white-space: pre-line;
  }

  .print-button {
    width: 100%;
    padding: 12px 24px;
    background-color: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .print-button:hover {
    background-color: var(--accent-hover);
  }

  .print-button:active {
    background-color: var(--accent-active);
  }

  .print-button:disabled {
    opacity: 0.6;
    cursor: progress;
  }
</style>
