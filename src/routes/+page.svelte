<script lang="ts">
  // State for label dimensions
  let width = $state(100);
  let height = $state(50);
  let continuousWidth = $state(false);
  let continuousHeight = $state(false);
  let orientation = $state<"portrait" | "landscape">("landscape");
  
  // Reference to content for measuring
  let contentElement: HTMLDivElement;

  // State for font settings
  let fontSize = $state(16);
  let fontFamily = $state("Arial");
  let fontColor = $state("#000000");
  let fontWeight = $state("normal");
  let fontStyle = $state("normal");

  // State for settings
  let rememberSettings = $state(false);

  // State for text boxes
  let textBoxes = $state([
    { id: 1, x: 10, y: 10, text: "Sample Label Text" }
  ]);

  // Dragging state
  let draggingBox = $state<number | null>(null);
  let dragOffset = $state({ x: 0, y: 0 });
  let resizingLabel = $state(false);
  let resizeStartPos = $state({ x: 0, y: 0 });
  let resizeStartDimension = $state(0);

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

  // Calculate dimensions
  const renderWidth = $derived(() => {
    if (continuousWidth) {
      // Auto-size width based on content
      return Math.max(width, 100);
    }
    return width;
  });

  const renderHeight = $derived(() => {
    if (continuousHeight) {
      // Auto-size height based on content
      return Math.max(height, 50);
    }
    return height;
  });

  function handlePrint() {
    // Use the browser's native print dialog
    // This works cross-platform (Linux, Windows, macOS) and provides print preview
    window.print();
  }

  // Resize handle handlers
  function startResize(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    resizingLabel = true;
    resizeStartPos = { x: event.clientX, y: event.clientY };
    
    if (continuousWidth) {
      resizeStartDimension = width;
    } else if (continuousHeight) {
      resizeStartDimension = height;
    }
  }

  function handleGlobalMouseMove(event: MouseEvent) {
    if (resizingLabel) {
      if (continuousWidth) {
        // Calculate change in pixels and convert to mm (approx 3.78 px per mm at 96 DPI)
        const deltaX = event.clientX - resizeStartPos.x;
        const deltaMm = deltaX / 3.78;
        width = Math.max(50, resizeStartDimension + deltaMm);
      } else if (continuousHeight) {
        const deltaY = event.clientY - resizeStartPos.y;
        const deltaMm = deltaY / 3.78;
        height = Math.max(20, resizeStartDimension + deltaMm);
      }
      return;
    }
  }

  function stopResize() {
    resizingLabel = false;
  }

  // Drag handlers
  function startDrag(event: MouseEvent, boxId: number) {
    // Don't start dragging if clicking on the editable text content
    const target = event.target as HTMLElement;
    if (target.classList.contains('text-box-content') || target.isContentEditable) {
      return;
    }
    
    event.preventDefault();
    draggingBox = boxId;
    const box = textBoxes.find(b => b.id === boxId);
    if (box) {
      const previewRect = contentElement.getBoundingClientRect();
      const targetElement = event.currentTarget as HTMLElement;
      const targetRect = targetElement.getBoundingClientRect();
      dragOffset.x = event.clientX - targetRect.left;
      dragOffset.y = event.clientY - targetRect.top;
    }
  }

  function handleMouseMove(event: MouseEvent) {
    if (draggingBox !== null) {
      const box = textBoxes.find(b => b.id === draggingBox);
      if (box && contentElement) {
        const container = contentElement.getBoundingClientRect();
        const newX = event.clientX - container.left - dragOffset.x;
        const newY = event.clientY - container.top - dragOffset.y;
        
        // Constrain to label bounds
        box.x = Math.max(0, Math.min(newX, container.width - 50));
        box.y = Math.max(0, Math.min(newY, container.height - 20));
        textBoxes = [...textBoxes]; // Trigger reactivity
      }
    }
  }

  function stopDrag() {
    draggingBox = null;
    stopResize();
  }

  function addTextBox() {
    const newId = Math.max(...textBoxes.map(b => b.id), 0) + 1;
    textBoxes = [...textBoxes, { id: newId, x: 20 + (newId * 10), y: 20 + (newId * 10), text: "New Text" }];
  }

  function deleteTextBox(boxId: number) {
    textBoxes = textBoxes.filter(b => b.id !== boxId);
  }
</script>

<svelte:window onmouseup={stopDrag} onmousemove={handleGlobalMouseMove} />

<div class="app-container">
  <div class="main-section">
    <h1>Label Editor</h1>
    
    <!-- Font Controls -->
    <div class="font-controls">
      <div class="control-group">
        <label for="font-family">Font:</label>
        <select id="font-family" bind:value={fontFamily}>
          <option value="Arial">Arial</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="Georgia">Georgia</option>
          <option value="Verdana">Verdana</option>
          <option value="Helvetica">Helvetica</option>
          <option value="Comic Sans MS">Comic Sans MS</option>
        </select>
      </div>

      <div class="control-group">
        <label for="font-size">Size:</label>
        <input 
          id="font-size" 
          type="number" 
          bind:value={fontSize} 
          min="8" 
          max="72"
        />
      </div>

      <div class="control-group">
        <label for="font-weight">Weight:</label>
        <select id="font-weight" bind:value={fontWeight}>
          <option value="normal">Normal</option>
          <option value="bold">Bold</option>
        </select>
      </div>

      <div class="control-group">
        <label for="font-style">Style:</label>
        <select id="font-style" bind:value={fontStyle}>
          <option value="normal">Normal</option>
          <option value="italic">Italic</option>
        </select>
      </div>

      <div class="control-group">
        <label for="font-color">Color:</label>
        <input 
          id="font-color" 
          type="color" 
          bind:value={fontColor}
        />
      </div>

      <button class="add-textbox-btn" onclick={addTextBox}>
        Add Text Box
      </button>
    </div>

    <!-- Label Preview -->
    <div class="preview-container">
      <div 
        class="label-preview" 
        style="
          width: {renderWidth()}mm; 
          height: {renderHeight()}mm;
        "
        bind:this={contentElement}
        onmousemove={handleMouseMove}
        role="region"
        aria-label="Label preview"
      >
        {#each textBoxes as box (box.id)}
          <div 
            class="text-box"
            class:dragging={draggingBox === box.id}
            style="
              left: {box.x}px;
              top: {box.y}px;
              font-family: {fontFamily};
              font-size: {fontSize}px;
              color: {fontColor};
              font-weight: {fontWeight};
              font-style: {fontStyle};
            "
            onmousedown={(e) => startDrag(e, box.id)}
            role="button"
            tabindex="0"
          >
            <button 
              class="delete-btn" 
              onclick={(e) => {e.stopPropagation(); deleteTextBox(box.id);}}
              title="Delete text box"
            >
              ×
            </button>
            <div class="text-box-content" contenteditable="true" bind:textContent={box.text}>
            </div>
          </div>
        {/each}
        
        <!-- Resize handles for continuous dimensions -->
        {#if continuousWidth}
          <div 
            class="resize-handle resize-handle-right"
            onmousedown={startResize}
            title="Drag to resize width"
            role="button"
            tabindex="0"
          >
            <div class="resize-handle-indicator"></div>
          </div>
        {/if}
        
        {#if continuousHeight}
          <div 
            class="resize-handle resize-handle-bottom"
            onmousedown={startResize}
            title="Drag to resize height"
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
      <h3>Dimensions</h3>
      
      <div class="dimension-control">
        <label for="width">Width (mm):</label>
        <input 
          id="width" 
          type="number" 
          bind:value={width} 
          min="1" 
          disabled={continuousWidth}
          class:grayed-out={continuousWidth}
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
        <label for="height">Height (mm):</label>
        <input 
          id="height" 
          type="number" 
          bind:value={height} 
          min="1" 
          disabled={continuousHeight}
          class:grayed-out={continuousHeight}
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
          <input 
            type="radio" 
            name="orientation"
            value="landscape"
            bind:group={orientation}
          />
          Landscape
        </label>
        <label class="radio-label">
          <input 
            type="radio" 
            name="orientation"
            value="portrait"
            bind:group={orientation}
          />
          Portrait
        </label>
      </div>
    </div>

    <div class="settings-group">
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={rememberSettings} />
        Remember Settings
      </label>
    </div>

    <button class="print-button" onclick={handlePrint}>
      Print
    </button>
  </aside>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background-color: #f5f5f5;
    color-scheme: light;
  }

  .app-container {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  .main-section {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  h1 {
    margin: 0 0 20px 0;
    color: #333;
    font-size: 24px;
  }

  .font-controls {
    display: flex;
    gap: 15px;
    flex-wrap: wrap;
    padding: 15px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    margin-bottom: 20px;
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .control-group label {
    font-size: 14px;
    font-weight: 500;
    color: #555;
  }

  .control-group select,
  .control-group input[type="number"] {
    padding: 6px 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
    background-color: white;
    color: #333;
  }

  .control-group input[type="color"] {
    width: 50px;
    height: 32px;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
  }

  .add-textbox-btn {
    padding: 6px 12px;
    background-color: #28a745;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
    font-weight: 500;
  }

  .add-textbox-btn:hover {
    background-color: #218838;
  }

  .preview-container {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 40px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    overflow: auto;
    min-height: 0;
  }

  .label-preview {
    border: 2px solid #333;
    background: white;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    position: relative;
    min-height: 1em;
  }

  .resize-handle {
    position: absolute;
    background-color: #007bff;
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
    background-color: #0056b3;
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
    min-width: 50px;
    min-height: 20px;
    user-select: none;
  }

  .text-box:hover {
    border-color: #007bff;
    background-color: rgba(0, 123, 255, 0.05);
  }

  .text-box.dragging {
    border-color: #007bff;
    background-color: rgba(0, 123, 255, 0.1);
    opacity: 0.8;
    cursor: grabbing;
  }

  .delete-btn {
    position: absolute;
    top: -8px;
    right: -8px;
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
  }

  .text-box:hover .delete-btn {
    display: flex;
  }

  .delete-btn:hover {
    background-color: #c82333;
  }

  .text-box-content {
    outline: none;
    cursor: text;
    min-height: 1em;
    white-space: nowrap;
    user-select: text;
  }

  .text-box-content:focus {
    outline: 2px solid #007bff;
    outline-offset: 2px;
    border-radius: 2px;
  }

  .settings-panel {
    width: 300px;
    background: white;
    padding: 20px;
    box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .settings-panel h2 {
    margin: 0 0 20px 0;
    font-size: 20px;
    color: #333;
  }

  .settings-panel h3 {
    margin: 0 0 15px 0;
    font-size: 16px;
    color: #555;
  }

  .settings-group {
    margin-bottom: 25px;
  }

  .dimension-control {
    margin-bottom: 15px;
  }

  .dimension-control label {
    display: block;
    margin-bottom: 5px;
    font-size: 14px;
    color: #555;
    font-weight: 500;
  }

  .dimension-control input[type="number"] {
    width: 100%;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
    margin-bottom: 8px;
    background-color: white;
    color: #333;
  }

  .dimension-control input[type="number"]:disabled {
    background-color: #f0f0f0;
    color: #999;
  }

  .dimension-control input[type="number"].grayed-out {
    background-color: #f0f0f0;
    color: #999;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: #555;
    cursor: pointer;
    user-select: none;
  }

  .checkbox-label input[type="checkbox"] {
    cursor: pointer;
    width: 18px;
    height: 18px;
  }

  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: #555;
    cursor: pointer;
    user-select: none;
  }

  .radio-label input[type="radio"] {
    cursor: pointer;
    width: 18px;
    height: 18px;
  }

  .print-button {
    margin-top: auto;
    padding: 12px 24px;
    background-color: #007bff;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .print-button:hover {
    background-color: #0056b3;
  }

  .print-button:active {
    background-color: #004494;
  }

  /* Print styles - hide everything except the label */
  @media print {
    /* Hide all UI controls */
    h1,
    .font-controls,
    .settings-panel {
      display: none !important;
    }

    /* Reset body and container for print */
    :global(body) {
      background-color: white;
    }

    .app-container {
      display: block;
      height: auto;
    }

    .main-section {
      padding: 0;
      overflow: visible;
    }

    .preview-container {
      padding: 0;
      background: white;
      box-shadow: none;
      border-radius: 0;
      overflow: visible;
      display: block;
    }

    /* Optimize label for printing */
    .label-preview {
      border: 1px solid #000;
      box-shadow: none;
      page-break-inside: avoid;
      margin: 0;
      position: relative;
    }

    /* Hide interactive elements in print */
    .resize-handle,
    .delete-btn {
      display: none !important;
    }

    /* Remove hover effects and interactions */
    .text-box {
      border: none !important;
      background: transparent !important;
      cursor: default;
      padding: 4px;
    }

    .text-box:hover {
      border: none !important;
      background: transparent !important;
    }

    /* Ensure text boxes are not editable in print */
    .text-box-content {
      cursor: default;
      -moz-user-select: none;
      -webkit-user-select: none;
      user-select: none;
    }
  }
</style>
