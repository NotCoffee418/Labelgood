<script lang="ts">
  import { tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { dirname, join } from '@tauri-apps/api/path';
  import { save } from '@tauri-apps/plugin-dialog';
  import html2canvas from 'html2canvas';

  type Align = 'left' | 'center' | 'right';

  type TextStyle = {
    fontFamily: string;
    fontSize: number; // pt
    color: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    align: Align; // applies to the whole box
  };

  type ShapeStyle = {
    stroke: number; // pt
    color: string;
    fill: boolean; // rectangles only
  };

  // Positions and sizes are in px, relative to the label as displayed
  type TextElement = {
    kind: 'text';
    id: number;
    x: number;
    y: number;
    w: number | null; // null = fit the text
    h: number | null; // minimum height; grows with the text
    html: string;
    style: TextStyle;
    rotation?: number; // degrees clockwise, multiples of 90
  };
  type RectElement = { kind: 'rect'; id: number; x: number; y: number; w: number; h: number } & ShapeStyle;
  type ImageElement = { kind: 'image'; id: number; x: number; y: number; w: number; h: number; imageId: string; rotation?: number };
  type LineElement = {
    kind: 'line';
    id: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    stroke: number;
    color: string;
  };
  type LabelElement = TextElement | RectElement | ImageElement | LineElement;

  type LabelFormat = {
    id: string;
    name: string;
    width: number; // mm across the roll
    height: number | null; // mm along the feed, null for continuous rolls
  };

  type Margins = { top: number; right: number; bottom: number; left: number };

  // A printer driver option, as reported by the print system (CUPS on Linux, Print Schema on Windows)
  type PrinterOption = { key: string; label: string; choices: string[]; choice_labels: string[]; default: string | null };

  const SETTINGS_KEY = 'labelgood-settings';
  const PX_PER_MM = 96 / 25.4;
  const PRINT_DPI = 300;

  // Common label printer media (62 mm wide label printers such as the Brother QL-800 series)
  const LABEL_FORMATS: { group: string; formats: LabelFormat[] }[] = [
    {
      group: 'Continuous roll',
      formats: [
        { id: 'c62', name: '62 mm continuous', width: 62, height: null },
        { id: 'c50', name: '50 mm continuous', width: 50, height: null },
        { id: 'c38', name: '38 mm continuous', width: 38, height: null },
        { id: 'c29', name: '29 mm continuous', width: 29, height: null },
        { id: 'c12', name: '12 mm continuous', width: 12, height: null },
      ],
    },
    {
      group: 'Die-cut labels',
      formats: [
        { id: 'd62x100', name: '62 × 100 mm – shipping', width: 62, height: 100 },
        { id: 'd62x29', name: '62 × 29 mm – small address', width: 62, height: 29 },
        { id: 'd29x90', name: '29 × 90 mm – address', width: 29, height: 90 },
        { id: 'd38x90', name: '38 × 90 mm – large address', width: 38, height: 90 },
        { id: 'd17x87', name: '17 × 87 mm – file folder', width: 17, height: 87 },
        { id: 'd17x54', name: '17 × 54 mm – multi-purpose', width: 17, height: 54 },
        { id: 'd23x23', name: '23 × 23 mm – square', width: 23, height: 23 },
      ],
    },
  ];
  const ALL_FORMATS = LABEL_FORMATS.flatMap(g => g.formats);

  // Continuous label length limits (Brother QL-800 series: 12.7 mm to 1 m)
  const MIN_LENGTH_MM = 12.7;
  const MAX_LENGTH_MM = 1000;

  // Label printers can't print right up to the media edge: typically ~1.5 mm on
  // each side across the roll and ~3 mm at each end along the feed.
  const DEFAULT_MARGIN_SIDES = 1.5;
  const DEFAULT_MARGIN_ENDS = 3;
  // Text box padding + border, so the text (not the box outline) lines up with the margins
  const BOX_INSET = 5;
  const MIN_ELEMENT_SIZE = 6; // px
  const LINE_HIT_AREA = 10; // px, clickable thickness of a line
  // Lines snap to horizontal/vertical within this angle unless Shift is held
  const LINE_SNAP_TOLERANCE = Math.tan(5 * Math.PI / 180);
  const HISTORY_LIMIT = 200;

  // Print dialog: friendlier names for common CUPS driver options and choices
  const PRINT_OPTION_LABELS: Record<string, string> = {
    CutMedia: 'Cut',
    cupsPrintQuality: 'Quality',
    MediaType: 'Media',
    ColorModel: 'Colour',
    OutputBin: 'Output tray',
    InputSlot: 'Paper source',
    Duplex: 'Two-sided',
  };
  const PRINT_CHOICE_LABELS: Record<string, Record<string, string>> = {
    CutMedia: { None: "Don't cut", Auto: 'Printer default', EndOfPage: 'After each label', EndOfJob: 'After the last label' },
    MediaType: { Labels: 'Die-cut labels', Roll: 'Continuous roll' },
    ColorModel: { Gray: 'Black & white', RGB: 'Colour' },
  };
  // Set from the label itself
  const HIDDEN_PRINT_OPTIONS = ['PageSize'];
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 6;
  const DEFAULT_ZOOM = 1.5;
  const PASTE_OFFSET = 10; // px between repeated pastes

  const RESIZE_HANDLES = [
    ['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0],
    ['se', 1, 1], ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0],
  ] as const;

  const GENERIC_FONTS = [
    { value: 'sans-serif', label: 'Sans Serif' },
    { value: 'serif', label: 'Serif' },
    { value: 'monospace', label: 'Monospace' },
  ];
  // Used if the system font list can't be read
  const FALLBACK_FONTS = [
    'Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia',
    'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
  ];

  // State for label dimensions (defaults match the 62 mm continuous format)
  let labelFormat = $state<string>('c62'); // a LABEL_FORMATS id or "custom"
  let width = $state(62);
  let height = $state(30);
  let continuousWidth = $state(false);
  let continuousHeight = $state(true);
  let orientation = $state<"landscape" | "portrait">("landscape");

  let marginMode = $state<"default" | "none" | "custom">("default");
  let customMargins = $state<Margins>({
    top: DEFAULT_MARGIN_ENDS, right: DEFAULT_MARGIN_SIDES, bottom: DEFAULT_MARGIN_ENDS, left: DEFAULT_MARGIN_SIDES
  });

  // Reference to the label element, which is what gets captured for printing
  let contentElement: HTMLDivElement;
  let imageInput: HTMLInputElement;

  const INITIAL_STYLE: TextStyle = {
    fontFamily: 'sans-serif',
    fontSize: 12,
    color: '#000000',
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
  };

  // Formatting applied to new text boxes and shapes
  let defaultStyle = $state<TextStyle>({ ...INITIAL_STYLE });
  let defaultShape = $state<ShapeStyle>({ stroke: 1, color: '#000000', fill: false });

  let theme = $state<"system" | "light" | "dark">("system");
  let systemFonts = $state<string[]>([]);
  // What the generic families resolve to on this system, e.g. sans-serif -> "Noto Sans"
  let defaultFonts = $state<Record<string, string | null>>({});

  // State for output
  let printers = $state<string[]>([]);
  let selectedPrinter = $state<string>("");
  let copies = $state(1);
  // Print option choices per printer, remembered between runs
  let printChoices = $state<Record<string, Record<string, string>>>({});
  let printDialog = $state<{ preview: string } | null>(null);
  let printerOptions = $state<PrinterOption[] | null>(null); // null while loading
  let printerOptionsError = $state<string | null>(null);
  let printing = $state(false);
  let printError = $state<string | null>(null);
  let lastSaveDir = $state<string | null>(null);
  let busy = $state(false);
  let status = $state<{ text: string; error: boolean } | null>(null);

  let elements = $state<LabelElement[]>([
    { kind: 'text', id: 1, x: 0, y: 0, w: null, h: null, html: 'Sample Label Text', style: { ...INITIAL_STYLE } }
  ]);
  // Inserted images by id. Elements only reference these, which keeps undo snapshots small.
  const images = new Map<string, { src: string; width: number; height: number }>();

  // Selection / editing state
  let selectedIds = $state<number[]>([]);
  let editingBoxId = $state<number | null>(null);
  let hasTextSelection = $state(false);
  let selectionMarks = $state({ bold: false, italic: false, underline: false });
  let selectionStyle = $state<Pick<TextStyle, 'fontFamily' | 'fontSize' | 'color'> | null>(null);
  let savedRange: Range | null = null;
  const editors = new Map<number, HTMLElement>(); // text box content elements
  const nodes = new Map<number, HTMLElement>(); // element wrappers

  // Pointer interactions
  let dragging = $state(false);
  type Bounds = { x: number; y: number; w: number; h: number };
  type Area = { minX: number; minY: number; maxX: number; maxY: number };
  // Sizes and limits are measured once when a drag starts, so moving needs no page measuring
  let drag: {
    startX: number;
    startY: number;
    origs: LabelElement[];
    bounds: Bounds[];
    areas: Area[];
    // every element, for the continuous label length while dragging
    all: { b: Bounds; inset: number; moving: boolean }[];
  } | null = null;
  // Visual offset of the dragged elements; their positions are updated on release
  let dragOffset = $state({ x: 0, y: 0 });
  // A click (no drag) on an already selected element selects the one beneath it
  let clickThrough: { id: number; x: number; y: number } | null = null;
  let marquee = $state<{ x0: number; y0: number; x1: number; y1: number; additive: boolean } | null>(null);
  let pan = $state<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  let previewContainer: HTMLDivElement;

  let zoom = $state(DEFAULT_ZOOM);

  // Context menu and clipboard (copied elements; images are shared through `images`)
  let contextMenu = $state<{ x: number; y: number; labelX: number; labelY: number } | null>(null);
  let clipboard = $state.raw<LabelElement[]>([]);
  let clipboardText = ''; // what we put on the system clipboard, to recognise our own pastes
  let pasteCount = 0;
  let resize: {
    id: number; sx: -1 | 0 | 1; sy: -1 | 0 | 1;
    startX: number; startY: number; x0: number; y0: number; w0: number; h0: number;
  } | null = null;
  let endpointDrag: { id: number; end: 1 | 2 } | null = null;
  let lastPointer: { x: number; y: number } | null = null;
  let resizingLabel = $state(false);
  let resizeStartPos = { x: 0, y: 0 };
  let resizeStartDimension = 0;

  // Undo history: JSON snapshots of the document (elements + label setup)
  let undoStack: string[] = [];
  let redoStack: string[] = [];
  let canUndo = $state(false);
  let canRedo = $state(false);
  let lastCommitted: string | null = null;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;

  const clampLength = (mm: number) => Math.min(MAX_LENGTH_MM, Math.max(MIN_LENGTH_MM, Number(mm) || MIN_LENGTH_MM));

  // Actual label dimensions (respecting continuous settings), used for printing
  // Length a continuous label needs to fit everything inside its margins (0 = no constraint).
  // The user's own length (width/height) is kept; the label is never shorter than this.
  let contentLength = $state(0);

  const actualWidth = $derived(continuousWidth ? clampLength(Math.max(width, contentLength)) : width);
  const actualHeight = $derived(continuousHeight ? clampLength(Math.max(height, contentLength)) : height);

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

  // Edge of the view where a continuous label is cut off the roll, which is also
  // where its length is adjusted. When the view is rotated, axes swap.
  const resizeEdge = $derived(
    continuousWidth ? (viewRotation === "rotated" ? "bottom" : "right")
    : continuousHeight ? (viewRotation === "rotated" ? "right" : "bottom")
    : null
  );

  const currentFormat = $derived(ALL_FORMATS.find(f => f.id === labelFormat) ?? null);

  // Wavy "cut here" edge as one continuous path along the cut edge (a tiled pattern
  // shows seams). Drawn across x (0 = label edge) and along y; swapped for a bottom edge.
  const cutEdgePaths = $derived.by(() => {
    if (!resizeEdge) return null;
    const length = (resizeEdge === "right" ? renderHeight : renderWidth) * PX_PER_MM;
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

  // Margins in mm for each edge of the label as displayed
  const displayMargins = $derived.by<Margins>(() => {
    if (marginMode === "none") return { top: 0, right: 0, bottom: 0, left: 0 };
    if (marginMode === "custom") {
      const mm = (v: number) => Math.max(0, Number(v) || 0);
      return {
        top: mm(customMargins.top), right: mm(customMargins.right),
        bottom: mm(customMargins.bottom), left: mm(customMargins.left)
      };
    }
    // Side margins go across the roll, end margins along the feed (the continuous
    // or length direction). Only which axis is horizontal on screen changes.
    const acrossIsHorizontal = (viewRotation === "normal") !== continuousWidth;
    const horizontal = acrossIsHorizontal ? DEFAULT_MARGIN_SIDES : DEFAULT_MARGIN_ENDS;
    const vertical = acrossIsHorizontal ? DEFAULT_MARGIN_ENDS : DEFAULT_MARGIN_SIDES;
    return { top: vertical, right: horizontal, bottom: vertical, left: horizontal };
  });

  const selectedElements = $derived(elements.filter(el => selectedIds.includes(el.id)));
  // The selected element when exactly one is selected (resize handles, editing)
  const selected = $derived(selectedElements.length === 1 ? selectedElements[0] : null);
  const selectedTexts = $derived(selectedElements.filter((el): el is TextElement => el.kind === 'text'));
  const selectedShapes = $derived(selectedElements.filter((el): el is RectElement | LineElement => el.kind === 'rect' || el.kind === 'line'));
  const selectedImage = $derived(selected?.kind === 'image' ? selected : null);
  // Toolbar shows shape controls when only shapes are selected
  const shapeToolbar = $derived(selectedShapes.length > 0 && selectedShapes.length === selectedElements.length);

  // What the formatting toolbar changes: the selected text, the selected boxes, or new boxes
  const formatScope = $derived<"selection" | "box" | "defaults">(
    hasTextSelection && editingBoxId !== null ? "selection" : selectedTexts.length > 0 ? "box" : "defaults"
  );
  const activeStyle = $derived(selectedTexts[0]?.style ?? defaultStyle);
  const activeMarks = $derived(formatScope === "selection" ? selectionMarks : activeStyle);
  // What the toolbar shows: the selected text's formatting when there is a selection
  const displayStyle = $derived(
    formatScope === "selection" && selectionStyle ? { ...activeStyle, ...selectionStyle } : activeStyle
  );
  const activeShape = $derived<ShapeStyle>(
    selectedShapes[0] ? { ...defaultShape, ...selectedShapes[0] } : defaultShape
  );

  const fontOptions = $derived.by(() => {
    const fonts = systemFonts.length > 0 ? systemFonts : FALLBACK_FONTS;
    const current = displayStyle.fontFamily;
    const known = GENERIC_FONTS.some(f => f.value === current) || fonts.includes(current);
    return known ? fonts : [current, ...fonts];
  });

  // The undoable document. Theme, output and default formatting aren't part of it.
  const documentJson = $derived(JSON.stringify({
    elements, labelFormat, width, height, continuousWidth, continuousHeight,
    orientation, marginMode, customMargins
  }));

  // ---- Label format, margins, positioning ----

  function selectLabelFormat(id: string) {
    labelFormat = id;
    const format = ALL_FORMATS.find(f => f.id === id);
    if (!format) return; // custom: keep the current dimensions
    width = format.width;
    continuousWidth = false;
    continuousHeight = format.height === null;
    height = format.height ?? clampLength(height);
  }

  // Finds the preset matching the given dimensions, for settings saved before formats existed
  function matchFormat(w: number, h: number, contW: boolean, contH: boolean): string {
    const match = !contW && ALL_FORMATS.find(f =>
      f.width === w && (contH ? f.height === null : f.height === h)
    );
    return match ? match.id : 'custom';
  }

  function setMarginMode(mode: typeof marginMode) {
    if (mode === "custom" && marginMode !== "custom") {
      // Start from what's currently shown
      customMargins = { ...displayMargins };
    }
    marginMode = mode;
  }

  // Handle continuous checkbox mutual exclusion
  function handleContinuousWidth() {
    if (continuousWidth) {
      continuousHeight = false;
      width = clampLength(width);
    }
  }

  function handleContinuousHeight() {
    if (continuousHeight) {
      continuousWidth = false;
      height = clampLength(height);
    }
  }

  // Printable area in px. Text boxes may extend past it by their padding, so
  // their text (not their outline) lines up with the margins. With `growable`, the
  // far end of a continuous label is open: the label lengthens to fit instead.
  function printableArea(inset: number, growable = false) {
    const m = displayMargins;
    return {
      minX: m.left * PX_PER_MM - inset,
      minY: m.top * PX_PER_MM - inset,
      maxX: growable && resizeEdge === "right" ? Infinity
        : (contentElement?.clientWidth ?? renderWidth * PX_PER_MM) - m.right * PX_PER_MM + inset,
      maxY: growable && resizeEdge === "bottom" ? Infinity
        : (contentElement?.clientHeight ?? renderHeight * PX_PER_MM) - m.bottom * PX_PER_MM + inset,
    };
  }

  // Length (mm) a continuous label needs so every element stays inside the end margin
  function measureContentLength(): number {
    // A text box's padding doesn't need to fit, only its text
    return lengthForBounds(elements.map(el => ({ b: elementBounds(el), inset: el.kind === 'text' ? BOX_INSET : 0, moving: false })), { x: 0, y: 0 });
  }

  // Continuous length needed for elements at `items` (moving ones shifted by `offset`)
  function lengthForBounds(items: { b: Bounds; inset: number; moving: boolean }[], offset: { x: number; y: number }): number {
    if (!resizeEdge || items.length === 0) return 0;
    const alongWidth = resizeEdge === "right";
    let farEdge = 0;
    for (const { b, inset, moving } of items) {
      const end = alongWidth ? b.x + b.w + (moving ? offset.x : 0) : b.y + b.h + (moving ? offset.y : 0);
      farEdge = Math.max(farEdge, end - inset);
    }
    const endMargin = alongWidth ? displayMargins.right : displayMargins.bottom;
    return Math.ceil(farEdge / PX_PER_MM + endMargin);
  }

  // Applies a typed continuous length as the user's length, then shows the effective
  // length again (it can stay longer if the content needs it)
  function commitLength(input: HTMLInputElement, axis: 'width' | 'height') {
    const value = clampLength(Number(input.value));
    if (axis === 'width') width = value;
    else height = value;
    tick().then(() => input.value = String(axis === 'width' ? actualWidth : actualHeight));
  }

  // Re-measure after anything that can move or resize elements has rendered
  $effect(() => {
    JSON.stringify(elements);
    void displayMargins;
    void resizeEdge;
    tick().then(() => contentLength = measureContentLength());
  });

  // How far to move something at `pos` with `size` to fit within [min, max] (to `min` if it can't)
  function shiftInto(pos: number, size: number, min: number, max: number): number {
    return Math.round(Math.max(min, Math.min(pos, max - size))) - pos;
  }

  // Bounding box of an element in label px
  function elementBounds(el: LabelElement) {
    if (el.kind === 'line') {
      return { x: Math.min(el.x1, el.x2), y: Math.min(el.y1, el.y2), w: Math.abs(el.x2 - el.x1), h: Math.abs(el.y2 - el.y1) };
    }
    const node = nodes.get(el.id);
    const w = node?.offsetWidth ?? el.w ?? 0;
    const h = node?.offsetHeight ?? el.h ?? 0;
    if (el.kind !== 'rect' && (el.rotation ?? 0) % 180 !== 0) {
      // Quarter turns swap width and height around the centre
      return { x: el.x + (w - h) / 2, y: el.y + (h - w) / 2, w: h, h: w };
    }
    return { x: el.x, y: el.y, w, h };
  }

  function rotationOf(el: LabelElement): number {
    return el.kind === 'text' || el.kind === 'image' ? el.rotation ?? 0 : 0;
  }

  // Moves elements together from their original positions, limiting the move so
  // the whole group stays inside the margins
  function moveGroup(origs: LabelElement[], dx: number, dy: number) {
    const { x, y } = groupDelta(origs.map(elementBounds), origs.map(dragArea), dx, dy);
    for (const orig of origs) {
      const el = elements.find(e => e.id === orig.id);
      if (el) moveElement(el, orig, x, y);
    }
  }

  // Where an element may go: its printable area, open at the far end of a continuous label
  function dragArea(el: LabelElement): Area {
    return printableArea(el.kind === 'text' ? BOX_INSET : 0, true);
  }

  // The move (dx, dy) limited so every element stays inside its area
  function groupDelta(bounds: Bounds[], areas: Area[], dx: number, dy: number) {
    let loX = -Infinity, hiX = Infinity, loY = -Infinity, hiY = Infinity;
    bounds.forEach((b, i) => {
      const area = areas[i];
      loX = Math.max(loX, area.minX - b.x); hiX = Math.min(hiX, area.maxX - b.x - b.w);
      loY = Math.max(loY, area.minY - b.y); hiY = Math.min(hiY, area.maxY - b.y - b.h);
    });
    // If the group doesn't fit, pin it to the top-left of the printable area
    return {
      x: Math.round(loX > hiX ? loX : Math.max(loX, Math.min(dx, hiX))),
      y: Math.round(loY > hiY ? loY : Math.max(loY, Math.min(dy, hiY))),
    };
  }

  // Keeps elements inside the margins
  function clampElements(els: LabelElement[]) {
    for (const el of els) moveGroup([$state.snapshot(el) as LabelElement], 0, 0);
  }

  function moveElement(el: LabelElement, orig: LabelElement, dx: number, dy: number) {
    if (el.kind === 'line' && orig.kind === 'line') {
      el.x1 = orig.x1 + dx; el.x2 = orig.x2 + dx;
      el.y1 = orig.y1 + dy; el.y2 = orig.y2 + dy;
    } else if (el.kind !== 'line' && orig.kind !== 'line') {
      el.x = orig.x + dx;
      el.y = orig.y + dy;
    }
  }

  // Where a new element goes: the margin corner, staggered so repeated inserts don't stack exactly
  function insertPosition(inset: number) {
    const area = printableArea(inset);
    const offset = (elements.length % 5) * 12;
    return { x: Math.round(area.minX) + offset, y: Math.round(area.minY) + offset };
  }

  function nextId() {
    return Math.max(0, ...elements.map(el => el.id)) + 1;
  }

  // ---- Settings ----

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
      labelFormat = s.labelFormat ?? matchFormat(width, height, continuousWidth, continuousHeight);
      orientation = s.orientation ?? orientation;
      if (["default", "none", "custom"].includes(s.marginMode)) marginMode = s.marginMode;
      customMargins = { ...customMargins, ...s.customMargins };
      theme = s.theme ?? theme;
      defaultStyle = { ...defaultStyle, ...s.defaultStyle };
      defaultShape = { ...defaultShape, ...s.defaultShape };
      selectedPrinter = s.selectedPrinter ?? selectedPrinter;
      copies = s.copies >= 1 ? s.copies : copies;
      printChoices = s.printChoices ?? printChoices;
      lastSaveDir = s.lastSaveDir ?? lastSaveDir;
      if (s.zoom >= MIN_ZOOM && s.zoom <= MAX_ZOOM) zoom = s.zoom;
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  // Start the sample box with the restored default formatting, at the margins
  function initSampleBox() {
    const sample = elements[0];
    if (sample.kind !== 'text') return;
    sample.style = { ...defaultStyle };
    Object.assign(sample, insertPosition(BOX_INSET));
  }

  loadSettings();
  initSampleBox();

  // Save settings once they've stopped changing (not on every step of a drag)
  let saveSettingsTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const json = JSON.stringify({
      labelFormat, width, height, continuousWidth, continuousHeight, orientation,
      marginMode, customMargins, theme, defaultStyle, defaultShape,
      selectedPrinter, copies, printChoices, lastSaveDir, zoom
    });
    clearTimeout(saveSettingsTimer);
    saveSettingsTimer = setTimeout(() => {
      try {
        localStorage.setItem(SETTINGS_KEY, json);
      } catch (error) {
        console.error('Failed to save settings:', error);
      }
    }, 300);
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
    try {
      const fonts = await invoke<{ sans_serif: string | null; serif: string | null; monospace: string | null }>('default_fonts');
      defaultFonts = { 'sans-serif': fonts?.sans_serif ?? null, serif: fonts?.serif ?? null, monospace: fonts?.monospace ?? null };
    } catch (error) {
      console.error('Failed to resolve default fonts:', error);
    }
  }

  // The system's default fonts are listed by what they resolve to
  function genericFontLabel(font: { value: string; label: string }): string {
    return defaultFonts[font.value] ?? font.label;
  }

  $effect(() => {
    loadPrinters();
    loadFonts();
  });

  // ---- Undo / redo ----

  // Record document changes once they settle, so a drag or a burst of typing is one step
  $effect(() => {
    const json = documentJson;
    if (lastCommitted === null) {
      lastCommitted = json;
      return;
    }
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, 400);
  });

  function commit() {
    clearTimeout(commitTimer);
    // Mid-gesture or mid-edit: committed when that finishes
    if (lastCommitted === null || drag || resize || endpointDrag || resizingLabel || editingBoxId !== null) return;
    const json = documentJson;
    if (json === lastCommitted) return;
    undoStack.push(lastCommitted);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    lastCommitted = json;
    canUndo = true;
    canRedo = false;
  }

  function undo() {
    if (editingBoxId !== null) stopEditing();
    commit();
    const previous = undoStack.pop();
    if (previous === undefined || lastCommitted === null) return;
    redoStack.push(lastCommitted);
    restore(previous);
  }

  function redo() {
    if (editingBoxId !== null) stopEditing();
    commit();
    const next = redoStack.pop();
    if (next === undefined || lastCommitted === null) return;
    undoStack.push(lastCommitted);
    restore(next);
  }

  function restore(json: string) {
    const doc = JSON.parse(json);
    lastCommitted = json;
    elements = doc.elements;
    labelFormat = doc.labelFormat;
    width = doc.width;
    height = doc.height;
    continuousWidth = doc.continuousWidth;
    continuousHeight = doc.continuousHeight;
    orientation = doc.orientation;
    marginMode = doc.marginMode;
    customMargins = doc.customMargins;
    selectedIds = selectedIds.filter(id => elements.some(el => el.id === id));
    canUndo = undoStack.length > 0;
    canRedo = redoStack.length > 0;

    // Text box content is only written to the DOM on creation, so sync it here
    tick().then(() => {
      for (const el of elements) {
        const editorNode = el.kind === 'text' ? editors.get(el.id) : undefined;
        if (el.kind === 'text' && editorNode && editorNode.innerHTML !== el.html) {
          editorNode.innerHTML = el.html;
        }
      }
    });
  }

  // ---- Text editing & formatting ----

  // Registers an element's wrapper so its rendered size can be measured
  function registerNode(node: HTMLElement, id: number) {
    nodes.set(id, node);
    return {
      destroy() {
        nodes.delete(id);
      }
    };
  }

  // Registers a text box's editable element and fills in its initial content
  function editor(node: HTMLElement, box: TextElement) {
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
    selectedIds = [boxId];
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
        deleteElement(id);
      }
    }
    commit();
  }

  function deselect() {
    stopEditing();
    selectedIds = [];
  }

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
    align: 'text-align',
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

  function applyToSelection(box: TextElement, key: keyof TextStyle, value: TextStyle[keyof TextStyle]) {
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
    // Alignment always applies to the whole box
    if (formatScope === "selection" && selected?.kind === 'text' && key !== 'align') {
      applyToSelection(selected, key, value);
    } else if (selectedTexts.length > 0) {
      for (const box of selectedTexts) {
        box.style[key] = value;
        const el = editors.get(box.id);
        if (el) {
          clearInlineFormat(el, key);
          box.html = el.innerHTML;
        }
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

  function applyShape<K extends keyof ShapeStyle>(key: K, value: ShapeStyle[K]) {
    defaultShape[key] = value;
    for (const el of selectedShapes) {
      if (key === 'fill' && el.kind !== 'rect') continue;
      (el as ShapeStyle)[key] = value;
    }
  }

  function handleStrokeChange(event: Event) {
    const stroke = parseFloat((event.currentTarget as HTMLInputElement).value);
    if (stroke > 0) {
      applyShape('stroke', Math.min(Math.max(stroke, 0.25), 50));
    }
  }

  // ---- Inserting & deleting elements ----

  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Adds a text box; with `text` (e.g. pasted) it's just placed, otherwise it opens for typing
  function addTextBox(text?: string) {
    const id = nextId();
    elements.push({
      kind: 'text', id, ...insertPosition(BOX_INSET), w: null, h: null,
      html: text !== undefined ? escapeHtml(text) : 'New Text', style: { ...defaultStyle },
    });
    stopEditing();
    if (text !== undefined) {
      selectedIds = [id];
      tick().then(() => clampElements(elements.filter(el => el.id === id)));
    } else {
      startEditing(id);
    }
  }

  function addLine() {
    stopEditing();
    const area = printableArea(0);
    const id = nextId();
    const length = Math.min(30 * PX_PER_MM, area.maxX - area.minX);
    const { x, y } = insertPosition(0);
    const midY = Math.round(Math.min(y + (area.maxY - area.minY) / 2, area.maxY));
    elements.push({ kind: 'line', id, x1: x, y1: midY, x2: Math.round(x + length), y2: midY, stroke: defaultShape.stroke, color: defaultShape.color });
    selectedIds = [id];
  }

  function addRect() {
    stopEditing();
    const area = printableArea(0);
    const id = nextId();
    const size = Math.round(Math.max(MIN_ELEMENT_SIZE, Math.min(10 * PX_PER_MM, area.maxX - area.minX, area.maxY - area.minY)));
    elements.push({ kind: 'rect', id, ...insertPosition(0), w: size, h: size, ...defaultShape });
    selectedIds = [id];
  }

  function chooseImage() {
    imageInput.value = '';
    imageInput.click();
  }

  function handleImageFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) readImageFile(file);
  }

  function readImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => insertImage(src, img.naturalWidth, img.naturalHeight);
      img.onerror = () => status = { text: `Couldn't read ${file.name} as an image.`, error: true };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function insertImage(src: string, naturalWidth: number, naturalHeight: number) {
    stopEditing();
    const imageId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    images.set(imageId, { src, width: naturalWidth, height: naturalHeight });
    // Fit inside the printable area, keeping the image's proportions
    const area = printableArea(0);
    const scale = Math.min(1, (area.maxX - area.minX) / naturalWidth, (area.maxY - area.minY) / naturalHeight);
    const id = nextId();
    elements.push({
      kind: 'image', id, ...insertPosition(0),
      w: Math.max(MIN_ELEMENT_SIZE, Math.round(naturalWidth * scale)),
      h: Math.max(MIN_ELEMENT_SIZE, Math.round(naturalHeight * scale)),
      imageId,
    });
    selectedIds = [id];
  }

  // Restores an image's original proportions, keeping its width
  function resetImageRatio() {
    const el = selectedImage;
    const info = el && images.get(el.imageId);
    if (!el || !info) return;
    el.h = Math.round(el.w * info.height / info.width);
  }

  function deleteElement(id: number) {
    deleteElements([id]);
  }

  function deleteElements(ids: number[]) {
    elements = elements.filter(el => !ids.includes(el.id));
    selectedIds = selectedIds.filter(id => !ids.includes(id));
    if (editingBoxId !== null && ids.includes(editingBoxId)) {
      editingBoxId = null;
      hasTextSelection = false;
      savedRange = null;
    }
  }

  // ---- Clipboard, ordering, rotation ----

  function plainText(el: TextElement): string {
    return editors.get(el.id)?.innerText ?? el.html.replace(/<[^>]*>/g, '');
  }

  async function writeClipboardText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for webviews without the async clipboard API
      const area = document.createElement('textarea');
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
  }

  // Copies the selected elements; text boxes also put their text on the system clipboard
  function copySelection() {
    if (selectedElements.length === 0) return;
    clipboard = selectedElements.map(el => $state.snapshot(el) as LabelElement);
    pasteCount = 0;
    clipboardText = selectedTexts.map(plainText).join('\n');
    writeClipboardText(clipboardText);
  }

  function cutSelection() {
    copySelection();
    deleteElements([...selectedIds]);
    commit();
  }

  // Inserts copies of `sources`, moved by (dx, dy) and kept inside the margins
  function insertCopies(sources: LabelElement[], dx: number, dy: number) {
    stopEditing();
    let id = nextId();
    const copies = sources.map(src => {
      const copy = structuredClone($state.snapshot(src)) as LabelElement;
      copy.id = id++;
      moveElement(copy, src, dx, dy);
      return copy;
    });
    elements.push(...copies);
    selectedIds = copies.map(c => c.id);
    tick().then(() => {
      moveGroup(selectedElements.map(e => $state.snapshot(e) as LabelElement), 0, 0);
      commit();
    });
  }

  function groupBounds(els: LabelElement[]) {
    const boxes = els.map(elementBounds);
    return { x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)) };
  }

  // Pastes copied elements, at a label position (context menu) or offset from the originals
  function pasteElements(at?: { x: number; y: number }) {
    if (clipboard.length === 0) return;
    pasteCount++;
    if (at) {
      const b = groupBounds(clipboard);
      insertCopies(clipboard, Math.round(at.x - b.x), Math.round(at.y - b.y));
    } else {
      insertCopies(clipboard, PASTE_OFFSET * pasteCount, PASTE_OFFSET * pasteCount);
    }
  }

  function duplicateSelection() {
    if (selectedElements.length === 0) return;
    insertCopies(selectedElements.map(el => $state.snapshot(el) as LabelElement), PASTE_OFFSET, PASTE_OFFSET);
  }

  // Ctrl+V outside text fields: our own elements, an image, or text as a new text box
  function handleDocumentPaste(event: ClipboardEvent) {
    if (printDialog) return;
    const target = event.target as HTMLElement;
    if (target.closest?.('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    const data = event.clipboardData;
    const image = Array.from(data?.files ?? []).find(f => f.type.startsWith('image/'));
    if (image) {
      readImageFile(image);
      return;
    }
    const text = data?.getData('text/plain') ?? '';
    if (clipboard.length > 0 && text === clipboardText) {
      pasteElements();
    } else if (text.trim()) {
      addTextBox(text);
    } else {
      pasteElements();
    }
  }

  // Context menu paste has no clipboard event: use our elements, else try the system text
  async function pasteFromMenu(at: { x: number; y: number }) {
    if (clipboard.length > 0) {
      pasteElements(at);
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) addTextBox(text);
    } catch {
      status = { text: 'Use Ctrl+V to paste from other apps.', error: true };
    }
  }

  function selectAll() {
    stopEditing();
    selectedIds = elements.map(el => el.id);
  }

  function bringToFront() {
    elements = [...elements.filter(el => !selectedIds.includes(el.id)), ...selectedElements];
  }

  function sendToBack() {
    elements = [...selectedElements, ...elements.filter(el => !selectedIds.includes(el.id))];
  }

  // Rotates the selection a quarter turn around its centre: positions turn with it,
  // text boxes and images turn, rectangles swap width/height, lines turn their ends
  function rotateSelection(direction: 1 | -1) {
    stopEditing();
    const els = selectedElements;
    if (els.length === 0) return;
    const boxes = els.map(elementBounds);
    const cx = (Math.min(...boxes.map(b => b.x)) + Math.max(...boxes.map(b => b.x + b.w))) / 2;
    const cy = (Math.min(...boxes.map(b => b.y)) + Math.max(...boxes.map(b => b.y + b.h))) / 2;
    // Clockwise in screen coordinates (y points down) for direction 1
    const turn = (x: number, y: number) => direction === 1
      ? { x: cx - (y - cy), y: cy + (x - cx) }
      : { x: cx + (y - cy), y: cy - (x - cx) };

    for (const el of els) {
      if (el.kind === 'line') {
        const a = turn(el.x1, el.y1);
        const b = turn(el.x2, el.y2);
        el.x1 = Math.round(a.x); el.y1 = Math.round(a.y);
        el.x2 = Math.round(b.x); el.y2 = Math.round(b.y);
        continue;
      }
      const node = nodes.get(el.id);
      const w = node?.offsetWidth ?? el.w ?? 0;
      const h = node?.offsetHeight ?? el.h ?? 0;
      const centre = turn(el.x + w / 2, el.y + h / 2);
      if (el.kind === 'rect') {
        [el.w, el.h] = [el.h, el.w];
        el.x = Math.round(centre.x - el.w / 2);
        el.y = Math.round(centre.y - el.h / 2);
      } else {
        // Rotated around their own centre, so the layout box keeps its size
        el.rotation = ((el.rotation ?? 0) + 90 * direction + 360) % 360;
        el.x = Math.round(centre.x - w / 2);
        el.y = Math.round(centre.y - h / 2);
      }
    }
    tick().then(() => moveGroup(selectedElements.map(e => $state.snapshot(e) as LabelElement), 0, 0));
  }

  function handleContextMenu(event: MouseEvent) {
    const target = event.target as HTMLElement;
    // Keep the normal text menu while editing text
    if (target.closest('[contenteditable="true"]')) return;
    event.preventDefault();
    const elementNode = target.closest<HTMLElement>('[data-element-id]');
    if (elementNode) {
      const id = Number(elementNode.dataset.elementId);
      if (!selectedIds.includes(id)) {
        stopEditing();
        selectedIds = [id];
      }
    } else {
      deselect();
    }
    const rect = contentElement.getBoundingClientRect();
    // Keep the menu on screen
    contextMenu = {
      x: Math.min(event.clientX, window.innerWidth - 210),
      y: Math.min(event.clientY, window.innerHeight - 330),
      labelX: (event.clientX - rect.left) / zoom,
      labelY: (event.clientY - rect.top) / zoom,
    };
  }

  // Block the webview's own context menu outside text fields
  function handleDocumentContextMenu(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest?.('input, textarea, [contenteditable="true"]')) event.preventDefault();
  }

  // Runs a menu item, passing the label position the menu was opened at
  function menuAction(action: (at: { x: number; y: number }) => void) {
    if (!contextMenu) return;
    const at = { x: contextMenu.labelX, y: contextMenu.labelY };
    contextMenu = null;
    action(at);
    commit();
  }

  function handleWindowMouseDown(event: MouseEvent) {
    if (contextMenu && !(event.target as HTMLElement).closest('.context-menu')) {
      contextMenu = null;
    }
  }

  // ---- Zoom ----

  // Zooms keeping the point under the cursor (or the view centre) in place
  function setZoom(value: number, clientX?: number, clientY?: number) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    if (next === zoom || !previewContainer || !contentElement) {
      zoom = next;
      return;
    }
    const view = previewContainer.getBoundingClientRect();
    const px = clientX ?? view.left + view.width / 2;
    const py = clientY ?? view.top + view.height / 2;
    const label = contentElement.getBoundingClientRect();
    const lx = (px - label.left) / zoom;
    const ly = (py - label.top) / zoom;
    zoom = next;
    tick().then(() => {
      const moved = contentElement.getBoundingClientRect();
      previewContainer.scrollLeft += moved.left + lx * next - px;
      previewContainer.scrollTop += moved.top + ly * next - py;
    });
  }

  function zoomToFit() {
    const padding = 48;
    const fit = Math.min(
      (previewContainer.clientWidth - padding * 2) / (renderWidth * PX_PER_MM),
      (previewContainer.clientHeight - padding * 2) / (renderHeight * PX_PER_MM),
    );
    setZoom(fit);
  }

  // Slider position (0-1000) on a logarithmic scale, so each step feels the same
  const zoomSlider = $derived(Math.round(1000 * Math.log(zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)));
  function zoomFromSlider(value: number) {
    setZoom(MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, value / 1000));
  }

  // Mouse wheel over the label zooms; elsewhere on the canvas, or with Shift held, it
  // scrolls vertically. Needs a non-passive listener to stop the default scroll.
  function wheelZoom(node: HTMLElement) {
    const onWheel = (event: WheelEvent) => {
      contextMenu = null;
      const scale = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? node.clientHeight : 1;
      if (event.shiftKey) {
        // Browsers turn Shift+wheel into horizontal scrolling; scroll down/up instead
        event.preventDefault();
        node.scrollTop += (event.deltaY || event.deltaX) * scale;
        return;
      }
      const label = contentElement?.getBoundingClientRect();
      const overLabel = label
        && event.clientX >= label.left && event.clientX <= label.right
        && event.clientY >= label.top && event.clientY <= label.bottom;
      if (!overLabel) return; // normal scrolling
      event.preventDefault();
      setZoom(zoom * Math.exp(-event.deltaY * scale * 0.0015), event.clientX, event.clientY);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return {
      destroy() {
        node.removeEventListener('wheel', onWheel);
      }
    };
  }

  // ---- Pointer interactions ----

  // Mousedown on the label is prevented (to stop native drag/selection), which also stops
  // focus moving. Release focus from sidebar/toolbar controls so keyboard shortcuts apply.
  function releaseControlFocus() {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && !contentElement?.contains(active)) {
      active.blur();
    }
  }

  function handleElementMouseDown(event: MouseEvent, el: LabelElement) {
    if (event.button !== 0) return;
    releaseControlFocus();
    const target = event.target as HTMLElement;
    if (target.closest('.handle')) return;
    // Let the user select text inside the box being edited
    if (editingBoxId === el.id && target.closest('.text-box-content')) return;

    if (editingBoxId !== el.id) {
      stopEditing();
    }
    event.preventDefault();

    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      // Toggle in/out of the selection; no drag
      selectedIds = selectedIds.includes(el.id) ? selectedIds.filter(id => id !== el.id) : [...selectedIds, el.id];
      return;
    }
    // Clicking the selected element again (or Alt+click) selects what's beneath it on release
    const soleSelected = selectedIds.length === 1 && selectedIds[0] === el.id;
    clickThrough = soleSelected || event.altKey ? { id: el.id, x: event.clientX, y: event.clientY } : null;
    // Clicking an element that's part of a multi-selection drags the whole group
    if (!selectedIds.includes(el.id)) {
      selectedIds = [el.id];
    }
    const origs = selectedElements.map(e => $state.snapshot(e) as LabelElement);
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      origs,
      bounds: origs.map(elementBounds),
      areas: origs.map(dragArea),
      all: elements.map(e => ({
        b: elementBounds(e),
        inset: e.kind === 'text' ? BOX_INSET : 0,
        moving: selectedIds.includes(e.id),
      })),
    };
    dragOffset = { x: 0, y: 0 };
    dragging = true;
  }

  function startElementResize(event: MouseEvent, el: LabelElement, sx: -1 | 0 | 1, sy: -1 | 0 | 1) {
    if (event.button !== 0 || el.kind === 'line') return;
    event.preventDefault();
    event.stopPropagation();
    const node = nodes.get(el.id);
    resize = {
      id: el.id, sx, sy,
      startX: event.clientX, startY: event.clientY,
      x0: el.x, y0: el.y,
      w0: node?.offsetWidth ?? el.w ?? MIN_ELEMENT_SIZE,
      h0: node?.offsetHeight ?? el.h ?? MIN_ELEMENT_SIZE,
    };
  }

  // Shapes and images keep their proportions unless Shift is held; text boxes resize freely
  function applyResize(clientX: number, clientY: number, free: boolean) {
    if (!resize) return;
    const r = resize;
    const el = elements.find(e => e.id === r.id);
    if (!el || el.kind === 'line') return;

    // Pointer movement in the element's own (unrotated) axes
    const angle = rotationOf(el) * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const sdx = (clientX - r.startX) / zoom;
    const sdy = (clientY - r.startY) / zoom;
    const ldx = sdx * cos + sdy * sin;
    const ldy = -sdx * sin + sdy * cos;

    let w = r.sx ? Math.max(MIN_ELEMENT_SIZE, r.w0 + r.sx * ldx) : r.w0;
    let h = r.sy ? Math.max(MIN_ELEMENT_SIZE, r.h0 + r.sy * ldy) : r.h0;
    if (el.kind !== 'text' && !free) {
      const scale = r.sx && r.sy ? Math.max(w / r.w0, h / r.h0) : r.sx ? w / r.w0 : h / r.h0;
      w = r.w0 * scale;
      h = r.h0 * scale;
    }

    // Anchor the opposite edge; an axis without a handle grows from the centre.
    // Work out the centre's shift in the element's axes, then rotate it onto the screen.
    const lcx = r.sx * (w - r.w0) / 2;
    const lcy = r.sy * (h - r.h0) / 2;
    const cx = r.x0 + r.w0 / 2 + lcx * cos - lcy * sin;
    const cy = r.y0 + r.h0 / 2 + lcx * sin + lcy * cos;
    el.x = Math.round(cx - w / 2);
    el.y = Math.round(cy - h / 2);
    if (el.kind === 'text') {
      // Only fix the dimensions actually being dragged, so auto width keeps working
      if (r.sx) el.w = Math.round(w);
      if (r.sy) el.h = Math.round(h);
    } else {
      el.w = Math.round(w);
      el.h = Math.round(h);
    }
  }

  function startEndpointDrag(event: MouseEvent, el: LineElement, end: 1 | 2) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    endpointDrag = { id: el.id, end };
  }

  // Moves one end of a line, snapping to horizontal/vertical unless Shift is held
  function applyEndpoint(clientX: number, clientY: number, free: boolean) {
    if (!endpointDrag || !contentElement) return;
    const { id, end } = endpointDrag;
    const el = elements.find(e => e.id === id);
    if (!el || el.kind !== 'line') return;
    const rect = contentElement.getBoundingClientRect();
    let x = (clientX - rect.left) / zoom;
    let y = (clientY - rect.top) / zoom;
    const ox = end === 1 ? el.x2 : el.x1;
    const oy = end === 1 ? el.y2 : el.y1;
    if (!free) {
      if (Math.abs(y - oy) <= Math.abs(x - ox) * LINE_SNAP_TOLERANCE) y = oy;
      else if (Math.abs(x - ox) <= Math.abs(y - oy) * LINE_SNAP_TOLERANCE) x = ox;
    }
    x = Math.round(Math.max(0, Math.min(x, contentElement.clientWidth)));
    y = Math.round(Math.max(0, Math.min(y, contentElement.clientHeight)));
    if (end === 1) {
      el.x1 = x; el.y1 = y;
    } else {
      el.x2 = x; el.y2 = y;
    }
  }

  function handleCanvasMouseDown(event: MouseEvent) {
    releaseControlFocus();
    contextMenu = null;
    if (event.button === 1) {
      // Middle mouse button pans
      event.preventDefault();
      pan = { startX: event.clientX, startY: event.clientY, scrollLeft: previewContainer.scrollLeft, scrollTop: previewContainer.scrollTop };
      return;
    }
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.element, .handle, .resize-handle')) return;
    // Empty space: deselect (unless adding) and start a selection rectangle
    event.preventDefault();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!additive) deselect();
    else stopEditing();
    marquee = { x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY, additive };
  }

  // Selects every element touching the selection rectangle
  function finishMarquee() {
    if (!marquee) return;
    const m = marquee;
    marquee = null;
    const left = Math.min(m.x0, m.x1), right = Math.max(m.x0, m.x1);
    const top = Math.min(m.y0, m.y1), bottom = Math.max(m.y0, m.y1);
    if (right - left < 3 && bottom - top < 3) return; // just a click
    const hits = elements.filter(el => {
      const node = el.kind === 'line'
        ? contentElement.querySelector<HTMLElement>(`[data-element-id="${el.id}"]`)
        : nodes.get(el.id);
      if (!node) return false;
      const r = node.getBoundingClientRect();
      return r.left <= right && r.right >= left && r.top <= bottom && r.bottom >= top;
    }).map(el => el.id);
    selectedIds = m.additive ? [...new Set([...selectedIds, ...hits])] : hits;
  }

  // Mice can report far more moves than the screen shows; apply at most one per frame
  let pendingMove: MouseEvent | null = null;

  function handleGlobalMouseMove(event: MouseEvent) {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (!(resizingLabel || resize || endpointDrag || drag || marquee || pan)) return;
    const scheduled = pendingMove !== null;
    pendingMove = event;
    if (!scheduled) {
      requestAnimationFrame(() => {
        const latest = pendingMove;
        pendingMove = null;
        if (latest) applyPointerMove(latest);
      });
    }
  }

  function applyPointerMove(event: MouseEvent) {
    if (resizingLabel) {
      // Change in pixels along the handle's axis, converted to whole millimetres
      const deltaPx = resizeEdge === "right"
        ? event.clientX - resizeStartPos.x
        : event.clientY - resizeStartPos.y;
      const newDimension = clampLength(Math.round(resizeStartDimension + deltaPx / zoom / PX_PER_MM));
      if (continuousWidth) {
        width = newDimension;
      } else if (continuousHeight) {
        height = newDimension;
      }
    } else if (resize) {
      applyResize(event.clientX, event.clientY, event.shiftKey);
    } else if (endpointDrag) {
      applyEndpoint(event.clientX, event.clientY, event.shiftKey);
    } else if (drag) {
      // Only the visual offset changes while dragging (no layout); positions update on release
      dragOffset = groupDelta(drag.bounds, drag.areas, (event.clientX - drag.startX) / zoom, (event.clientY - drag.startY) / zoom);
      if (resizeEdge) contentLength = lengthForBounds(drag.all, dragOffset);
    } else if (marquee) {
      marquee.x1 = event.clientX;
      marquee.y1 = event.clientY;
    } else if (pan) {
      previewContainer.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
      previewContainer.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
    }
  }

  // Elements under a screen point, topmost first (skips hollow shape interiors)
  function elementsAt(clientX: number, clientY: number): LabelElement[] {
    const ids = new Set<number>();
    for (const node of document.elementsFromPoint(clientX, clientY)) {
      const owner = (node as HTMLElement).closest?.<HTMLElement>('[data-element-id]');
      if (owner && contentElement.contains(owner)) ids.add(Number(owner.dataset.elementId));
    }
    return [...ids].map(id => elements.find(el => el.id === id)).filter((el): el is LabelElement => !!el);
  }

  // Selects the next element below `id` at a point, wrapping back to the top
  function selectBeneath(id: number, clientX: number, clientY: number) {
    const stack = elementsAt(clientX, clientY);
    if (stack.length < 2) return;
    const index = stack.findIndex(el => el.id === id);
    selectedIds = [stack[(index + 1) % stack.length].id];
  }

  // Double-click edits a text box under the cursor, even beneath other elements
  function handleCanvasDblClick(event: MouseEvent) {
    const inSelected = selected?.kind === 'text' && elementsAt(event.clientX, event.clientY).some(el => el.id === selected.id);
    const target = inSelected ? selected : elementsAt(event.clientX, event.clientY).find(el => el.kind === 'text');
    if (target && editingBoxId !== target.id) startEditing(target.id, event);
  }

  function handleMouseUp(event: MouseEvent) {
    // Apply a move still waiting for the next frame, so the drop lands where the mouse is
    if (pendingMove) {
      applyPointerMove(pendingMove);
      pendingMove = null;
    }
    // Whether Shift is held on release decides the final shape
    if (resize) applyResize(event.clientX, event.clientY, event.shiftKey);
    if (endpointDrag) applyEndpoint(event.clientX, event.clientY, event.shiftKey);
    const isClick = clickThrough !== null && Math.hypot(event.clientX - clickThrough.x, event.clientY - clickThrough.y) < 3;
    if (drag && !isClick && (dragOffset.x !== 0 || dragOffset.y !== 0)) {
      moveGroup(drag.origs, dragOffset.x, dragOffset.y);
    }
    dragOffset = { x: 0, y: 0 };
    if (isClick && clickThrough) {
      selectBeneath(clickThrough.id, event.clientX, event.clientY);
    }
    clickThrough = null;
    finishMarquee();
    pan = null;
    drag = null;
    dragging = false;
    resize = null;
    endpointDrag = null;
    resizingLabel = false;
    commit();
  }

  // Pressing or releasing Shift mid-resize updates the preview right away
  function refreshGestureForShift(free: boolean) {
    if (!lastPointer) return;
    if (resize) applyResize(lastPointer.x, lastPointer.y, free);
    if (endpointDrag) applyEndpoint(lastPointer.x, lastPointer.y, free);
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (event.key === 'Shift') refreshGestureForShift(false);
  }

  function handleKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    // The print dialog is modal
    if (printDialog) {
      if (event.key === 'Escape') closePrintDialog();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      openPrintDialog();
      return;
    }
    if (event.key === 'Shift' && (resize || endpointDrag)) {
      refreshGestureForShift(true);
      return;
    }

    // Text fields keep their own undo; everywhere else it's the document's
    const inTextField = !!target.closest('textarea, [contenteditable="true"], input[type="text"], input[type="search"]');
    if ((event.ctrlKey || event.metaKey) && !inTextField) {
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      // Clipboard shortcuts act on elements, except while a form field has focus
      if (!target.closest('input, select')) {
        if (key === 'c' && selectedIds.length > 0) { event.preventDefault(); copySelection(); return; }
        if (key === 'x' && selectedIds.length > 0) { event.preventDefault(); cutSelection(); return; }
        if (key === 'd' && selectedIds.length > 0) { event.preventDefault(); duplicateSelection(); return; }
        if (key === 'a') { event.preventDefault(); selectAll(); return; }
        // Ctrl+V is handled by the paste event, which carries the clipboard contents
      }
    }

    if (event.key === 'Escape') {
      if (contextMenu) contextMenu = null;
      else if (editingBoxId !== null) stopEditing();
      else selectedIds = [];
      return;
    }
    // Other shortcuts only apply to selected elements that aren't being edited
    if (selectedIds.length === 0 || editingBoxId !== null) return;
    if (target.closest('input, select, textarea, [contenteditable="true"]')) return;

    const step = event.shiftKey ? 10 : 1;
    const nudge = (dx: number, dy: number) => {
      moveGroup(selectedElements.map(e => $state.snapshot(e) as LabelElement), dx, dy);
    };
    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        deleteElements([...selectedIds]);
        break;
      case 'Enter':
        if (selected?.kind !== 'text') return;
        startEditing(selected.id);
        break;
      case 'r':
      case 'R':
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        rotateSelection(event.shiftKey ? -1 : 1);
        break;
      case 'ArrowLeft': nudge(-step, 0); break;
      case 'ArrowRight': nudge(step, 0); break;
      case 'ArrowUp': nudge(0, -step); break;
      case 'ArrowDown': nudge(0, step); break;
      default: return;
    }
    event.preventDefault();
  }

  // ---- Continuous label resizing ----

  function startResize(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    resizingLabel = true;
    resizeStartPos = { x: event.clientX, y: event.clientY };
    resizeStartDimension = continuousWidth ? actualWidth : actualHeight;
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
      ignoreElements: (el) => ['resize-handle', 'handle', 'margin-guide', 'cut-edge'].some(c => el.classList.contains(c)),
      onclone: (_doc, el) => {
        el.classList.add('capturing');
        el.style.transform = 'none'; // capture at 100%, regardless of the editor zoom
      },
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

  function validateLabelSize(): boolean {
    if (actualWidth > 0 && actualHeight > 0) return true;
    status = { text: 'Enter a valid label width and height.', error: true };
    return false;
  }

  async function savePdf() {
    if (busy || !contentElement) return;
    status = null;
    stopEditing();
    if (!validateLabelSize()) return;

    busy = true;
    try {
      const fileName = `label-${actualWidth}x${actualHeight}mm.pdf`;
      let outputPath = await save({
        defaultPath: lastSaveDir ? await join(lastSaveDir, fileName) : fileName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!outputPath) return; // cancelled
      if (!outputPath.toLowerCase().endsWith('.pdf')) outputPath += '.pdf';
      lastSaveDir = await dirname(outputPath);

      const result = await invoke<string>('generate_pdf', {
        options: {
          image_data: await renderLabelPng(),
          width_mm: actualWidth,
          height_mm: actualHeight,
          printer_name: null,
          output_path: outputPath,
        }
      });
      status = { text: result, error: false };
    } catch (error) {
      console.error('Saving PDF failed:', error);
      status = { text: String(error), error: true };
    } finally {
      busy = false;
    }
  }

  // ---- Print dialog ----

  const visiblePrintOptions = $derived(
    (printerOptions ?? []).filter(o => !HIDDEN_PRINT_OPTIONS.includes(o.key) && o.choices.length > 1)
  );
  const isContinuousLabel = $derived(continuousWidth || continuousHeight);

  // Media type is remembered separately for continuous and die-cut labels
  function choiceKey(option: PrinterOption): string {
    return option.key === 'MediaType' ? `MediaType@${isContinuousLabel ? 'continuous' : 'die-cut'}` : option.key;
  }

  // Sensible defaults: cut after each label, media type matching the label
  function suggestedChoice(option: PrinterOption): string | undefined {
    const pick = (value: string) => option.choices.includes(value) ? value : undefined;
    if (option.key === 'CutMedia') return pick('EndOfPage');
    if (option.key === 'MediaType') return pick(isContinuousLabel ? 'Roll' : 'Labels');
    return undefined;
  }

  function choiceFor(option: PrinterOption): string {
    const saved = printChoices[selectedPrinter]?.[choiceKey(option)];
    if (saved && option.choices.includes(saved)) return saved;
    return suggestedChoice(option) ?? option.default ?? option.choices[0];
  }

  function setChoice(option: PrinterOption, value: string) {
    printChoices = {
      ...printChoices,
      [selectedPrinter]: { ...printChoices[selectedPrinter], [choiceKey(option)]: value },
    };
  }

  async function loadPrinterOptions(printer: string) {
    printerOptions = null;
    printerOptionsError = null;
    if (!printer) {
      printerOptions = [];
      return;
    }
    try {
      const options = await invoke<PrinterOption[]>('printer_options', { printer });
      if (printer === selectedPrinter) printerOptions = options;
    } catch (error) {
      if (printer === selectedPrinter) {
        printerOptions = [];
        printerOptionsError = String(error);
      }
    }
  }

  // Renders the label once; the preview is exactly the image that gets printed
  async function openPrintDialog() {
    if (busy || !contentElement) return;
    status = null;
    printError = null;
    stopEditing();
    if (!validateLabelSize()) return;

    busy = true;
    try {
      await loadPrinters();
      printDialog = { preview: await renderLabelPng() };
      loadPrinterOptions(selectedPrinter);
    } catch (error) {
      console.error('Preparing print failed:', error);
      status = { text: String(error), error: true };
    } finally {
      busy = false;
    }
  }

  function closePrintDialog() {
    if (!printing) printDialog = null;
  }

  async function printFromDialog() {
    if (!printDialog || !selectedPrinter || printing) return;
    printError = null;
    printing = true;
    try {
      const result = await invoke<string>('generate_pdf', {
        options: {
          image_data: printDialog.preview,
          width_mm: actualWidth,
          height_mm: actualHeight,
          printer_name: selectedPrinter,
          output_path: null,
          copies: Math.min(999, Math.max(1, Math.round(copies) || 1)),
          print_options: Object.fromEntries(visiblePrintOptions.map(o => [o.key, choiceFor(o)])),
        }
      });
      status = { text: result, error: false };
      printDialog = null;
    } catch (error) {
      console.error('Printing failed:', error);
      printError = String(error);
    } finally {
      printing = false;
    }
  }
</script>

<svelte:window
  onmouseup={handleMouseUp}
  onmousemove={handleGlobalMouseMove}
  onkeydown={handleKeyDown}
  onkeyup={handleKeyUp}
  onmousedown={handleWindowMouseDown}
/>
<svelte:document
  onselectionchange={handleSelectionChange}
  onpaste={handleDocumentPaste}
  oncontextmenu={handleDocumentContextMenu}
/>

<div class="app-container">
  <div class="main-section">
    <header class="app-header">
      <h1><img class="app-logo" src="/logo.svg" alt="" />Labelgood</h1>
      <div class="segmented theme-switch" role="radiogroup" aria-label="Theme">
        {#each [["system", "System"], ["light", "Light"], ["dark", "Dark"]] as [value, label]}
          <label class:active={theme === value}>
            <input type="radio" name="theme" {value} bind:group={theme} />
            {label}
          </label>
        {/each}
      </div>
    </header>

    <!-- Toolbar: formatting for the selection (or defaults for new elements), then inserts -->
    <div class="font-controls">
      <div class="toolbar-row">
        <div class="button-group" role="group" aria-label="History">
          <button class="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo}
            onmousedown={(e) => e.preventDefault()} onclick={undo}>↶</button>
          <button class="icon-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo}
            onmousedown={(e) => e.preventDefault()} onclick={redo}>↷</button>
        </div>

        <div class="button-group insert-group" role="group" aria-label="Insert">
          <button class="text-btn" onclick={() => addTextBox()} title="Insert text box">+ Text</button>
          <button class="text-btn" onclick={addLine} title="Insert line">Line</button>
          <button class="text-btn" onclick={addRect} title="Insert rectangle">Rectangle</button>
          <button class="text-btn" onclick={chooseImage} title="Insert image">Image</button>
        </div>
        <input type="file" accept="image/*" hidden bind:this={imageInput} onchange={handleImageFile} />

        <div class="toolbar-spacer"></div>

        {#if selectedIds.length > 0}
          <div class="button-group" role="group" aria-label="Rotate">
            <button class="icon-btn" title="Rotate left (Shift+R)" aria-label="Rotate left" onclick={() => rotateSelection(-1)}>⟲</button>
            <button class="icon-btn" title="Rotate right (R)" aria-label="Rotate right" onclick={() => rotateSelection(1)}>⟳</button>
          </div>
        {/if}

        {#if selectedIds.length > 0}
          <button class="icon-btn danger" title="Delete (Del)" aria-label="Delete"
            onclick={() => { deleteElements([...selectedIds]); commit(); }}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
            </svg>
          </button>
        {/if}

      </div>

      <!-- Formatting for the selection, or the defaults for new elements. Fixed height so the canvas doesn't jump. -->
      <div class="toolbar-row format-row">
        {#if shapeToolbar}
          <div class="size-control">
            <span>Line</span>
            <input
              type="number"
              aria-label="Line thickness"
              value={activeShape.stroke}
              min="0.25"
              max="50"
              step="0.25"
              onchange={handleStrokeChange}
            />
            <span>pt</span>
          </div>
          <input
            type="color"
            title="Line color"
            aria-label="Line color"
            value={activeShape.color}
            onchange={(e) => applyShape('color', e.currentTarget.value)}
          />
          {#if selectedShapes.some(el => el.kind === 'rect')}
            <label class="checkbox-label">
              <input type="checkbox" checked={activeShape.fill} onchange={(e) => applyShape('fill', e.currentTarget.checked)} />
              Filled
            </label>
          {/if}
        {:else if selectedImage}
          <button class="text-btn" onclick={resetImageRatio} title="Restore the image's original proportions">
            Original proportions
          </button>
        {:else}
          <select
            class="font-select"
            aria-label="Font"
            value={displayStyle.fontFamily}
            onchange={(e) => applyFormat('fontFamily', e.currentTarget.value)}
          >
            {#each GENERIC_FONTS as font}
              <option value={font.value}>{genericFontLabel(font)}</option>
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

          <div class="button-group" role="group" aria-label="Text style">
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

          <div class="button-group" role="group" aria-label="Alignment">
            {#each [["left", "Align left"], ["center", "Center"], ["right", "Align right"]] as const as [align, label]}
              <button
                class="toggle-btn"
                class:active={activeStyle.align === align}
                title={label}
                aria-label={label}
                aria-pressed={activeStyle.align === align}
                onmousedown={(e) => e.preventDefault()}
                onclick={() => applyFormat('align', align)}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  {#each [[14, 0], [9, 1], [14, 2], [9, 3]] as [lineWidth, row]}
                    {@const x = align === 'left' ? 1 : align === 'right' ? 15 - lineWidth : (16 - lineWidth) / 2}
                    <rect {x} y={2.5 + row * 3.3} width={lineWidth} height="1.6" rx="0.5" fill="currentColor" />
                  {/each}
                </svg>
              </button>
            {/each}
          </div>

          <input
            type="color"
            title="Text color"
            aria-label="Text color"
            value={displayStyle.color}
            onchange={(e) => applyFormat('color', e.currentTarget.value)}
          />
        {/if}

      </div>
    </div>

    <!-- Label Preview -->
    <div class="canvas-area">
    <div
      class="preview-container"
      class:panning={pan !== null}
      role="presentation"
      bind:this={previewContainer}
      use:wheelZoom
      onmousedown={handleCanvasMouseDown}
      ondblclick={handleCanvasDblClick}
      oncontextmenu={handleContextMenu}
    >
     <!-- Takes up the zoomed size so scrolling works; the label inside is scaled -->
     <div
       class="label-sizer"
       class:grows-down={resizeEdge === "bottom"}
       class:grows-right={resizeEdge === "right"}
       style:width="{renderWidth * zoom}mm"
       style:height="{renderHeight * zoom}mm"
     >
      <div
        class="label-preview"
        class:die-cut={currentFormat !== null && currentFormat.height !== null}
        style:width="{renderWidth}mm"
        style:height="{renderHeight}mm"
        style:transform="scale({zoom})"
        style:--hz={1 / zoom}
        bind:this={contentElement}
        role="region"
        aria-label="Label preview"
      >
        <!-- Wavy edge where a continuous label is cut off the roll (first, so everything paints over it) -->
        {#if resizeEdge && cutEdgePaths}
          <svg class="cut-edge cut-edge-{resizeEdge}" aria-hidden="true">
            <g transform={resizeEdge === "bottom" ? "matrix(0 1 1 0 0 0)" : undefined}>
              <path d={cutEdgePaths.fill} fill="white" />
              <path d={cutEdgePaths.wave} fill="none" stroke="#a9aeb6" stroke-width="1" vector-effect="non-scaling-stroke" />
            </g>
          </svg>
        {/if}

        {#if marginMode !== "none"}
          <div
            class="margin-guide"
            style:top="{displayMargins.top}mm"
            style:right="{displayMargins.right}mm"
            style:bottom="{displayMargins.bottom}mm"
            style:left="{displayMargins.left}mm"
          ></div>
        {/if}

        {#each elements as el (el.id)}
          {#if el.kind === 'line'}
            {@const length = Math.hypot(el.x2 - el.x1, el.y2 - el.y1)}
            {@const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1)}
            <div
              class="element line-element"
              class:selected={selectedIds.includes(el.id)}
              class:dragging={dragging && selectedIds.includes(el.id)}
              style:translate={dragging && selectedIds.includes(el.id) ? `${dragOffset.x}px ${dragOffset.y}px` : null}
              data-element-id={el.id}
              style:left="{el.x1}px"
              style:top="{el.y1 - LINE_HIT_AREA / zoom / 2}px"
              style:width="{Math.max(length, 1)}px"
              style:height="{LINE_HIT_AREA / zoom}px"
              style:transform="rotate({angle}rad)"
              onmousedown={(e) => handleElementMouseDown(e, el)}
              role="button"
              tabindex="-1"
              aria-label="Line"
            >
              <div class="line-bar" style:height="{el.stroke}pt" style:background={el.color}></div>
            </div>
            {#if selected?.id === el.id}
              <div class="handle endpoint" style:left="{el.x1}px" style:top="{el.y1}px"
                style:translate={dragging ? `${dragOffset.x}px ${dragOffset.y}px` : null}
                onmousedown={(e) => startEndpointDrag(e, el, 1)} role="button" tabindex="-1" aria-label="Move line start"></div>
              <div class="handle endpoint" style:left="{el.x2}px" style:top="{el.y2}px"
                style:translate={dragging ? `${dragOffset.x}px ${dragOffset.y}px` : null}
                onmousedown={(e) => startEndpointDrag(e, el, 2)} role="button" tabindex="-1" aria-label="Move line end"></div>
            {/if}
          {:else}
            <div
              class="element"
              class:text-box={el.kind === 'text'}
              class:selected={selectedIds.includes(el.id)}
              class:editing={editingBoxId === el.id}
              class:dragging={dragging && selectedIds.includes(el.id)}
              style:translate={dragging && selectedIds.includes(el.id) ? `${dragOffset.x}px ${dragOffset.y}px` : null}
              class:quarter-turn={rotationOf(el) % 180 !== 0}
              class:hollow={el.kind === 'rect' && !el.fill}
              style:--stroke={el.kind === 'rect' ? `${el.stroke}pt` : null}
              data-element-id={el.id}
              style:transform={rotationOf(el) ? `rotate(${rotationOf(el)}deg)` : null}
              style:left="{el.x}px"
              style:top="{el.y}px"
              style:width={el.w !== null ? `${el.w}px` : null}
              style:height={el.kind !== 'text' ? `${el.h}px` : null}
              style:min-height={el.kind === 'text' && el.h !== null ? `${el.h}px` : null}
              use:registerNode={el.id}
              onmousedown={(e) => handleElementMouseDown(e, el)}
              role="button"
              tabindex="-1"
            >
              {#if el.kind === 'text'}
                <div
                  class="text-box-content"
                  contenteditable={editingBoxId === el.id ? "true" : "false"}
                  role="textbox"
                  tabindex="-1"
                  aria-multiline="true"
                  data-box-id={el.id}
                  style:font-family={cssFontFamily(el.style.fontFamily)}
                  style:font-size="{el.style.fontSize}pt"
                  style:color={el.style.color}
                  style:font-weight={el.style.bold ? 'bold' : 'normal'}
                  style:font-style={el.style.italic ? 'italic' : 'normal'}
                  style:text-decoration={el.style.underline ? 'underline' : 'none'}
                  style:text-align={el.style.align}
                  style:white-space={el.w !== null ? 'pre-wrap' : 'pre'}
                  use:editor={el}
                  oninput={(e) => el.html = e.currentTarget.innerHTML}
                  onpaste={handlePaste}
                ></div>
              {:else if el.kind === 'rect'}
                <div
                  class="rect-shape"
                  style:border="{el.stroke}pt solid {el.color}"
                  style:background={el.fill ? el.color : 'transparent'}
                ></div>
                {#if !el.fill}
                  <!-- An unfilled rectangle is only grabbed by its outline, so things inside stay clickable -->
                  {#each ['top', 'right', 'bottom', 'left'] as side}
                    <div class="rect-hit rect-hit-{side}"></div>
                  {/each}
                {/if}
              {:else}
                <img class="image-element" src={images.get(el.imageId)?.src} alt="" draggable="false" />
              {/if}

              {#if selected?.id === el.id}
                {#each RESIZE_HANDLES as [name, sx, sy]}
                  <div
                    class="handle handle-{name}"
                    onmousedown={(e) => startElementResize(e, el, sx, sy)}
                    role="button"
                    tabindex="-1"
                    aria-label="Resize"
                  ></div>
                {/each}
              {/if}
            </div>
          {/if}
        {/each}

        <!-- Resize handles for continuous dimensions -->
        {#if resizeEdge === "right"}
          <div
            class="resize-handle resize-handle-right"
            onmousedown={startResize}
            title="Drag to change the label length"
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
            title="Drag to change the label length"
            role="button"
            tabindex="0"
          >
            <div class="resize-handle-indicator"></div>
          </div>
        {/if}
      </div>
     </div>
    </div>

    <div class="zoom-bar">
      <button class="icon-btn" title="Zoom out" aria-label="Zoom out" onclick={() => setZoom(zoom / 1.25)}>−</button>
      <input
        type="range"
        class="zoom-slider"
        min="0"
        max="1000"
        aria-label="Zoom"
        value={zoomSlider}
        oninput={(e) => zoomFromSlider(Number(e.currentTarget.value))}
      />
      <button class="icon-btn" title="Zoom in" aria-label="Zoom in" onclick={() => setZoom(zoom * 1.25)}>+</button>
      <button class="text-btn zoom-value" title="Reset to 100%" onclick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button class="text-btn" title="Fit the label in view" onclick={zoomToFit}>Fit</button>
    </div>
    </div>
  </div>

  {#if marquee}
    <div
      class="marquee"
      style:left="{Math.min(marquee.x0, marquee.x1)}px"
      style:top="{Math.min(marquee.y0, marquee.y1)}px"
      style:width="{Math.abs(marquee.x1 - marquee.x0)}px"
      style:height="{Math.abs(marquee.y1 - marquee.y0)}px"
    ></div>
  {/if}

  {#if contextMenu}
    {@const hasSelection = selectedIds.length > 0}
    <div class="context-menu" role="menu" style:left="{contextMenu.x}px" style:top="{contextMenu.y}px">
      <button role="menuitem" disabled={!hasSelection} onclick={() => menuAction(() => cutSelection())}>Cut<span>Ctrl+X</span></button>
      <button role="menuitem" disabled={!hasSelection} onclick={() => menuAction(() => copySelection())}>
        {selectedTexts.length > 0 && selectedTexts.length === selectedIds.length ? 'Copy text' : 'Copy'}<span>Ctrl+C</span>
      </button>
      <button role="menuitem" onclick={() => menuAction(pasteFromMenu)}>Paste<span>Ctrl+V</span></button>
      <button role="menuitem" disabled={!hasSelection} onclick={() => menuAction(() => duplicateSelection())}>Duplicate<span>Ctrl+D</span></button>
      <button role="menuitem" disabled={!hasSelection} onclick={() => menuAction(() => deleteElements([...selectedIds]))}>Delete<span>Del</span></button>
      {#if hasSelection}
        <hr />
        <button role="menuitem" onclick={() => menuAction(() => rotateSelection(-1))}>Rotate left<span>Shift+R</span></button>
        <button role="menuitem" onclick={() => menuAction(() => rotateSelection(1))}>Rotate right<span>R</span></button>
      {/if}
      <hr />
      <button role="menuitem" disabled={!hasSelection} onclick={() => menuAction(() => bringToFront())}>Bring to front</button>
      <button role="menuitem" disabled={!hasSelection} onclick={() => menuAction(() => sendToBack())}>Send to back</button>
      <hr />
      <button role="menuitem" disabled={elements.length === 0} onclick={() => menuAction(() => selectAll())}>Select all<span>Ctrl+A</span></button>
    </div>
  {/if}

  <!-- Settings Panel -->
  <aside class="settings-panel">
    <h2>Label Settings</h2>

    <div class="settings-group">
      <h3>Label</h3>
      <select
        class="format-select"
        aria-label="Label format"
        value={labelFormat}
        onchange={(e) => selectLabelFormat(e.currentTarget.value)}
      >
        {#each LABEL_FORMATS as group}
          <optgroup label={group.group}>
            {#each group.formats as format}
              <option value={format.id}>{format.name}</option>
            {/each}
          </optgroup>
        {/each}
        <option value="custom">Custom size…</option>
      </select>

      {#if labelFormat === "custom"}
        <div class="dimension-control">
          <label for="width">Width (mm)</label>
          <input
            id="width"
            type="number"
            value={continuousWidth ? actualWidth : width}
            min={continuousWidth ? MIN_LENGTH_MM : 1}
            max={continuousWidth ? MAX_LENGTH_MM : undefined}
            step="any"
            oninput={(e) => { if (!continuousWidth) width = Number(e.currentTarget.value); }}
            onchange={(e) => { if (continuousWidth) commitLength(e.currentTarget, 'width'); }}
          />
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={continuousWidth} onchange={handleContinuousWidth} />
            Continuous
          </label>
        </div>

        <div class="dimension-control">
          <label for="height">Height (mm)</label>
          <input
            id="height"
            type="number"
            value={continuousHeight ? actualHeight : height}
            min={continuousHeight ? MIN_LENGTH_MM : 1}
            max={continuousHeight ? MAX_LENGTH_MM : undefined}
            step="any"
            oninput={(e) => { if (!continuousHeight) height = Number(e.currentTarget.value); }}
            onchange={(e) => { if (continuousHeight) commitLength(e.currentTarget, 'height'); }}
          />
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={continuousHeight} onchange={handleContinuousHeight} />
            Continuous
          </label>
        </div>
      {:else if currentFormat?.height === null}
        <div class="dimension-control">
          <label for="length">Length (mm)</label>
          <input
            id="length"
            type="number"
            value={actualHeight}
            min={MIN_LENGTH_MM}
            max={MAX_LENGTH_MM}
            step="any"
            title="{MIN_LENGTH_MM}–{MAX_LENGTH_MM} mm"
            onchange={(e) => commitLength(e.currentTarget, 'height')}
          />
        </div>
      {/if}
    </div>

    <div class="settings-group">
      <h3>Margins</h3>
      <div class="segmented" role="radiogroup" aria-label="Margins">
        {#each [["default", "Default"], ["none", "None"], ["custom", "Custom"]] as const as [value, label]}
          <label class:active={marginMode === value}>
            <input type="radio" name="marginMode" {value} checked={marginMode === value} onchange={() => setMarginMode(value)} />
            {label}
          </label>
        {/each}
      </div>
      {#if marginMode === "custom"}
        <div class="margin-grid">
          {#each [["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]] as const as [side, label]}
            <label>
              <span>{label}</span>
              <input type="number" min="0" step="0.5" bind:value={customMargins[side]} />
              <span class="unit">mm</span>
            </label>
          {/each}
        </div>
      {/if}
    </div>

    <div class="settings-group">
      <h3>Orientation</h3>
      <div class="segmented" role="radiogroup" aria-label="Orientation">
        <label class:active={orientation === "landscape"}>
          <input type="radio" name="orientation" value="landscape" bind:group={orientation} />
          Landscape
        </label>
        <label class:active={orientation === "portrait"}>
          <input type="radio" name="orientation" value="portrait" bind:group={orientation} />
          Portrait
        </label>
      </div>
    </div>

    <div class="output-footer">
      {#if status}
        <p class="status" class:error={status.error}>{status.text}</p>
      {/if}
      <div class="output-buttons">
        <button class="secondary-button" onclick={savePdf} disabled={busy}>Save PDF</button>
        <button class="print-button" onclick={openPrintDialog} disabled={busy} title="Print (Ctrl+P)">
          {busy ? 'Working…' : 'Print'}
        </button>
      </div>
    </div>
  </aside>
</div>

{#if printDialog}
  <div class="modal-backdrop" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) closePrintDialog(); }}>
    <div class="print-dialog" role="dialog" aria-modal="true" aria-labelledby="print-title">
      <h2 id="print-title">Print</h2>
      <div class="print-body">
        <figure class="print-preview">
          <img src={printDialog.preview} alt="Print preview" />
          <figcaption>{actualWidth} × {actualHeight} mm · shown as it comes out of the printer</figcaption>
        </figure>

        <div class="print-settings">
          <div class="field">
            <span>Printer</span>
            {#if printers.length > 0}
              <div class="printer-row">
                <select
                  class="printer-select"
                  aria-label="Printer"
                  bind:value={selectedPrinter}
                  onchange={() => loadPrinterOptions(selectedPrinter)}
                >
                  {#each printers as printer}
                    <option value={printer}>{printer}</option>
                  {/each}
                </select>
                <button class="refresh-printers-btn" title="Refresh printer list"
                  onclick={async () => { await loadPrinters(); loadPrinterOptions(selectedPrinter); }}>↻</button>
              </div>
            {:else}
              <p class="no-printers-text">No printers found. Check that the printer is installed (on Linux, that CUPS is running).</p>
              <button class="refresh-printers-btn" onclick={async () => { await loadPrinters(); loadPrinterOptions(selectedPrinter); }}>
                Refresh Printers
              </button>
            {/if}
          </div>

          <label class="field">
            <span>Copies</span>
            <input
              type="number"
              min="1"
              max="999"
              bind:value={copies}
              onchange={() => copies = Math.min(999, Math.max(1, Math.round(copies) || 1))}
            />
          </label>

          {#if printerOptions === null}
            <p class="field-note">Loading printer options…</p>
          {:else if printerOptionsError}
            <p class="field-note">This printer doesn't report its options, so it will use its own defaults.</p>
          {:else}
            {#each visiblePrintOptions as option (option.key)}
              <label class="field">
                <span>{PRINT_OPTION_LABELS[option.key] ?? option.label}</span>
                <select value={choiceFor(option)} onchange={(e) => setChoice(option, e.currentTarget.value)}>
                  {#each option.choices as choice, i}
                    <option value={choice}>{PRINT_CHOICE_LABELS[option.key]?.[choice] ?? option.choice_labels[i] ?? choice}</option>
                  {/each}
                </select>
              </label>
            {/each}
          {/if}
        </div>
      </div>

      {#if printError}
        <p class="status error">{printError}</p>
      {/if}
      <div class="dialog-actions">
        <button class="secondary-button" onclick={closePrintDialog} disabled={printing}>Cancel</button>
        <button class="print-button" onclick={printFromDialog} disabled={printing || !selectedPrinter}>
          {printing ? 'Printing…' : 'Print'}
        </button>
      </div>
    </div>
  </div>
{/if}

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
    --canvas-bg: #e8eaed;
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
      --canvas-bg: #16181b;
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
    --canvas-bg: #16181b;
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

  .segmented {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface);
  }

  .segmented label {
    padding: 5px 10px;
    font-size: 13px;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    text-align: center;
  }

  .segmented label + label {
    border-left: 1px solid var(--border);
  }

  .segmented label:not(.active):hover {
    background: var(--surface-muted);
  }

  .segmented label.active {
    background: var(--accent);
    color: white;
  }

  .segmented input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  /* In the settings panel, switches span the full width */
  .settings-panel .segmented {
    display: flex;
  }

  .settings-panel .segmented label {
    flex: 1;
    padding: 6px 8px;
  }

  .theme-switch label {
    padding: 4px 10px;
  }

  .font-controls {
    padding: 12px 15px;
    background: var(--surface);
    border-radius: 8px;
    box-shadow: 0 2px 4px var(--shadow);
    margin-bottom: 20px;
  }

  /* Rows never wrap, so the toolbar height stays the same whatever is selected */
  .toolbar-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: nowrap;
    height: 34px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .toolbar-row > * {
    flex-shrink: 0;
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
    width: 250px;
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

  .button-group {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .button-group > button + button {
    border-left: 1px solid var(--border);
  }

  .toolbar-spacer {
    flex: 1;
  }

  .format-row {
    box-sizing: content-box;
    margin-top: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .icon-btn,
  .text-btn {
    height: 32px;
    border: none;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn {
    width: 32px;
    font-size: 17px;
  }

  .text-btn {
    padding: 0 10px;
    font-size: 13px;
  }

  /* Standalone buttons get their own border */
  .toolbar-row > .icon-btn,
  .toolbar-row > .text-btn {
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .icon-btn:hover:not(:disabled),
  .text-btn:hover {
    background: var(--surface-muted);
  }

  .icon-btn:disabled {
    color: var(--text-subtle);
    opacity: 0.5;
    cursor: default;
  }

  .icon-btn.danger:hover {
    color: var(--danger);
  }

  .toggle-btn {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: var(--surface);
    color: var(--text);
    font-size: 15px;
    font-family: Georgia, serif;
    cursor: pointer;
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

  .canvas-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--canvas-bg);
    border-radius: 8px;
    box-shadow: 0 2px 4px var(--shadow);
    overflow: hidden;
  }

  .preview-container {
    flex: 1;
    display: flex;
    padding: 48px;
    overflow: auto;
    min-height: 0;
  }

  .preview-container.panning {
    cursor: grabbing;
  }

  /* margin: auto centres the label but still lets it scroll fully when zoomed in */
  .label-sizer {
    position: relative;
    flex-shrink: 0;
    margin: auto;
  }

  /* A continuous label keeps its start in place so only the cut end moves when it
     grows (centring would move both ends, half as far as the mouse) */
  .label-sizer.grows-down {
    margin-top: 0;
  }

  .label-sizer.grows-right {
    margin-left: 0;
  }

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

  .marquee {
    position: fixed;
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    pointer-events: none;
    z-index: 1000;
  }

  .context-menu {
    position: fixed;
    z-index: 1001;
    min-width: 200px;
    padding: 4px 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 20px var(--shadow);
  }

  .context-menu button {
    display: flex;
    justify-content: space-between;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .context-menu button span {
    margin-left: 24px;
    color: var(--text-subtle);
    font-size: 12px;
  }

  .context-menu button:hover:not(:disabled) {
    background: var(--accent);
    color: white;
  }

  .context-menu button:hover:not(:disabled) span {
    color: rgba(255, 255, 255, 0.8);
  }

  .context-menu button:disabled {
    color: var(--text-subtle);
    cursor: default;
  }

  .context-menu hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }

  /* The label itself is paper, so it stays white in every theme */
  /* Scaled by the zoom from its top-left corner; --hz (1/zoom) keeps editor chrome a constant size */
  .label-preview {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    background: white;
    min-height: 1em;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.18);
  }

  .label-preview.die-cut {
    border-radius: 1.5mm;
  }

  /* Printable area guide; not part of the output */
  .margin-guide {
    position: absolute;
    border: calc(1px * var(--hz)) dashed #b4b9c0;
    pointer-events: none;
  }

  .resize-handle {
    position: absolute;
    background-color: var(--accent);
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: calc(6px * var(--hz));
  }

  .resize-handle-right {
    right: calc(-10px * var(--hz));
    top: 50%;
    transform: translateY(-50%);
    width: calc(12px * var(--hz));
    height: calc(60px * var(--hz));
    cursor: ew-resize;
  }

  .resize-handle-bottom {
    bottom: calc(-10px * var(--hz));
    left: 50%;
    transform: translateX(-50%);
    width: calc(60px * var(--hz));
    height: calc(12px * var(--hz));
    cursor: ns-resize;
  }

  .resize-handle:hover {
    background-color: var(--accent-hover);
  }

  .resize-handle-indicator {
    background-color: white;
    border-radius: calc(2px * var(--hz));
  }

  .resize-handle-right .resize-handle-indicator {
    width: calc(3px * var(--hz));
    height: calc(20px * var(--hz));
  }

  .resize-handle-bottom .resize-handle-indicator {
    width: calc(20px * var(--hz));
    height: calc(3px * var(--hz));
  }

  .element {
    position: absolute;
    cursor: move;
  }

  /* Dragged elements move on their own compositor layer */
  .element.dragging {
    opacity: 0.85;
    will-change: translate;
  }

  .element.selected:not(.text-box):not(.line-element) {
    outline: calc(1px * var(--hz)) solid var(--accent);
    outline-offset: calc(1px * var(--hz));
  }

  .text-box {
    padding: 4px;
    border: 1px dashed transparent;
    min-width: 20px;
    user-select: none;
  }

  .text-box:hover {
    border-color: #9cc6ff;
  }

  .text-box.selected {
    border-color: var(--accent);
    border-style: solid;
    background-color: rgba(0, 123, 255, 0.05);
  }

  .text-box.editing {
    border-style: dashed;
    cursor: default;
  }

  .text-box-content {
    outline: none;
    min-height: 1em;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .text-box.editing .text-box-content {
    cursor: text;
    user-select: text;
  }

  .rect-shape {
    width: 100%;
    height: 100%;
  }

  .element.hollow {
    pointer-events: none;
  }

  .element.hollow .rect-hit,
  .element.hollow .handle {
    pointer-events: auto;
  }

  /* Grab strips along each side of an unfilled rectangle: the outline plus a few screen px */
  .rect-hit {
    --grab: calc(var(--stroke) + 8px * var(--hz));
    position: absolute;
  }

  .rect-hit-top { left: 0; right: 0; top: calc(-4px * var(--hz)); height: var(--grab); }
  .rect-hit-bottom { left: 0; right: 0; bottom: calc(-4px * var(--hz)); height: var(--grab); }
  .rect-hit-left { top: 0; bottom: 0; left: calc(-4px * var(--hz)); width: var(--grab); }
  .rect-hit-right { top: 0; bottom: 0; right: calc(-4px * var(--hz)); width: var(--grab); }

  .image-element {
    display: block;
    width: 100%;
    height: 100%;
    max-width: none;
    user-select: none;
    pointer-events: none;
  }

  /* Lines are a rotated strip; the strip is the click target, the bar is the line */
  .line-element {
    transform-origin: 0 50%;
  }

  .line-bar {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    min-height: 1px;
    transform: translateY(-50%);
  }

  .line-element.selected .line-bar {
    box-shadow: 0 0 0 calc(1px * var(--hz)) var(--accent);
  }

  .handle {
    --size: calc(9px * var(--hz));
    --edge: calc(-6px * var(--hz));
    position: absolute;
    width: var(--size);
    height: var(--size);
    background: white;
    border: calc(1.5px * var(--hz)) solid var(--accent);
    border-radius: calc(2px * var(--hz));
    z-index: 20;
  }

  .handle-nw { left: var(--edge); top: var(--edge); cursor: nwse-resize; }
  .handle-n { left: calc(50% - var(--size) / 2); top: var(--edge); cursor: ns-resize; }
  .handle-ne { right: var(--edge); top: var(--edge); cursor: nesw-resize; }
  .handle-e { right: var(--edge); top: calc(50% - var(--size) / 2); cursor: ew-resize; }
  .handle-se { right: var(--edge); bottom: var(--edge); cursor: nwse-resize; }
  .handle-s { left: calc(50% - var(--size) / 2); bottom: var(--edge); cursor: ns-resize; }
  .handle-sw { left: var(--edge); bottom: var(--edge); cursor: nesw-resize; }
  .handle-w { left: var(--edge); top: calc(50% - var(--size) / 2); cursor: ew-resize; }

  /* Handles rotate with a quarter-turned box, so swap their cursors to match */
  .quarter-turn .handle-n, .quarter-turn .handle-s { cursor: ew-resize; }
  .quarter-turn .handle-e, .quarter-turn .handle-w { cursor: ns-resize; }
  .quarter-turn .handle-nw, .quarter-turn .handle-se { cursor: nesw-resize; }
  .quarter-turn .handle-ne, .quarter-turn .handle-sw { cursor: nwse-resize; }

  .handle.endpoint {
    border-radius: 50%;
    transform: translate(-50%, -50%);
    cursor: crosshair;
  }

  /* Wavy edge drawn just outside the label where a continuous label is cut */
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

  /* Applied to the cloned label when capturing for output */
  .label-preview:global(.capturing) {
    border-radius: 0;
    box-shadow: none;
  }

  .label-preview:global(.capturing) .text-box {
    border-color: transparent;
    background: transparent;
  }

  .label-preview:global(.capturing) .element {
    outline: none;
    opacity: 1;
  }

  .label-preview:global(.capturing) .line-bar {
    box-shadow: none;
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

  .format-select {
    width: 100%;
    padding: 7px 8px;
    margin-bottom: 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 14px;
    background-color: var(--surface);
    color: var(--text);
  }

  .margin-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
    margin-top: 10px;
  }

  .margin-grid label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-muted);
  }

  .margin-grid label span:first-child {
    width: 46px;
    flex-shrink: 0;
  }

  .margin-grid input {
    flex: 1;
    width: 100%;
    min-width: 0;
    padding: 5px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 13px;
    background-color: var(--surface);
    color: var(--text);
  }

  .margin-grid .unit {
    font-size: 12px;
    color: var(--text-subtle);
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

  .output-buttons {
    display: flex;
    gap: 10px;
  }

  .output-buttons > button {
    flex: 1;
  }

  .secondary-button {
    padding: 12px 20px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
  }

  .secondary-button:hover:not(:disabled) {
    background: var(--surface-muted);
  }

  .secondary-button:disabled {
    opacity: 0.6;
    cursor: default;
  }

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

  .print-dialog {
    width: min(780px, 100%);
    max-height: 100%;
    overflow: auto;
    padding: 20px 24px;
    background: var(--surface);
    border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  }

  .print-dialog h2 {
    margin: 0 0 16px 0;
    font-size: 20px;
  }

  .print-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 20px;
  }

  @media (max-width: 680px) {
    .print-body {
      grid-template-columns: 1fr;
    }
  }

  .print-preview {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 260px;
    padding: 24px;
    background: var(--canvas-bg);
    border-radius: 8px;
  }

  .print-preview img {
    max-width: 100%;
    max-height: 340px;
    background: white;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.18);
  }

  .print-preview figcaption {
    font-size: 12px;
    color: var(--text-subtle);
    text-align: center;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }

  .field > span {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .field select,
  .field input {
    width: 100%;
    padding: 7px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 14px;
    background-color: var(--surface);
    color: var(--text);
  }

  .field-note {
    margin: 0 0 12px 0;
    font-size: 13px;
    color: var(--text-subtle);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 16px;
  }

  .print-button {
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
