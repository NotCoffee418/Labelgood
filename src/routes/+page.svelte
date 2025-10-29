<script lang="ts">
  // State for label dimensions
  let width = $state(100);
  let height = $state(50);
  let continuousWidth = $state(false);
  let continuousHeight = $state(false);

  // State for font settings
  let fontSize = $state(16);
  let fontFamily = $state("Arial");
  let fontColor = $state("#000000");
  let fontWeight = $state("normal");
  let fontStyle = $state("normal");

  // State for settings
  let rememberSettings = $state(false);

  // Handle continuous checkbox logic
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

  // Get the display width/height (shows 0 when continuous)
  const displayWidth = $derived(continuousWidth ? 0 : width);
  const displayHeight = $derived(continuousHeight ? 0 : height);

  // Get actual rendering dimensions (minimum for continuous)
  const renderWidth = $derived(continuousWidth ? 100 : width);
  const renderHeight = $derived(continuousHeight ? Math.max(height, fontSize * 1.5) : height);

  function handlePrint() {
    alert('Print functionality not yet implemented');
  }
</script>

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
    </div>

    <!-- Label Preview -->
    <div class="preview-container">
      <div 
        class="label-preview" 
        style="
          width: {renderWidth}mm; 
          height: {renderHeight}mm;
          font-family: {fontFamily};
          font-size: {fontSize}px;
          color: {fontColor};
          font-weight: {fontWeight};
          font-style: {fontStyle};
        "
      >
        <div class="label-content" contenteditable="true">
          Sample Label Text
        </div>
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
  }

  .control-group input[type="color"] {
    width: 50px;
    height: 32px;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
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
  }

  .label-preview {
    border: 2px solid #333;
    background: white;
    padding: 10px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    min-height: 1em;
    position: relative;
  }

  .label-content {
    outline: none;
    cursor: text;
    min-height: 1em;
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

  @media (prefers-color-scheme: dark) {
    :global(body) {
      background-color: #1a1a1a;
    }

    .main-section,
    .font-controls,
    .preview-container,
    .settings-panel {
      background-color: #2a2a2a;
    }

    h1, h2, h3 {
      color: #f0f0f0;
    }

    .control-group label,
    .dimension-control label,
    .checkbox-label {
      color: #d0d0d0;
    }

    .control-group select,
    .control-group input[type="number"],
    .dimension-control input[type="number"],
    .control-group input[type="color"] {
      background-color: #3a3a3a;
      color: #f0f0f0;
      border-color: #4a4a4a;
    }

    .dimension-control input[type="number"]:disabled,
    .dimension-control input[type="number"].grayed-out {
      background-color: #444;
      color: #888;
    }

    .label-preview {
      background: white;
      border-color: #555;
    }
  }
</style>
