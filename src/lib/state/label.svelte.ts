import { ALL_FORMATS, DEFAULT_MARGIN_ENDS, DEFAULT_MARGIN_SIDES, clampLength } from '$lib/formats';
import type { MarginMode, Margins, Orientation } from '$lib/types';

// The label's size, orientation and margins, and how it's laid out on screen
class LabelSetup {
  // Defaults match the 62 mm continuous format
  format = $state<string>('c62'); // a LABEL_FORMATS id or "custom"
  width = $state(62);
  height = $state(30);
  continuousWidth = $state(false);
  continuousHeight = $state(true);
  orientation = $state<Orientation>('landscape');

  marginMode = $state<MarginMode>('default');
  customMargins = $state<Margins>({
    top: DEFAULT_MARGIN_ENDS, right: DEFAULT_MARGIN_SIDES, bottom: DEFAULT_MARGIN_ENDS, left: DEFAULT_MARGIN_SIDES
  });

  // Length a continuous label needs to fit everything inside its margins (0 = no constraint).
  // The user's own length (width/height) is kept; the label is never shorter than this.
  contentLength = $state(0);

  // Actual label dimensions (respecting continuous settings), used for printing
  actualWidth = $derived(this.continuousWidth ? clampLength(Math.max(this.width, this.contentLength)) : this.width);
  actualHeight = $derived(this.continuousHeight ? clampLength(Math.max(this.height, this.contentLength)) : this.height);
  isContinuous = $derived(this.continuousWidth || this.continuousHeight);

  // Whether the label's long edge (its length) is the width.
  // A continuous dimension is always the length, so dragging it never flips the view.
  lengthIsWidth = $derived(
    this.continuousWidth || (!this.continuousHeight && this.actualWidth >= this.actualHeight)
  );

  // Landscape shows the long edge horizontally, portrait vertically.
  // The view is rotated when the label's natural shape doesn't match the orientation.
  viewRotation = $derived<'normal' | 'rotated'>(
    (this.orientation === 'landscape') === this.lengthIsWidth ? 'normal' : 'rotated'
  );

  // Dimensions of the label as displayed (swapped when the view is rotated)
  renderWidth = $derived(this.viewRotation === 'rotated' ? this.actualHeight : this.actualWidth);
  renderHeight = $derived(this.viewRotation === 'rotated' ? this.actualWidth : this.actualHeight);

  // Edge of the view where a continuous label is cut off the roll, which is also
  // where its length is adjusted. When the view is rotated, axes swap.
  resizeEdge = $derived<'right' | 'bottom' | null>(
    this.continuousWidth ? (this.viewRotation === 'rotated' ? 'bottom' : 'right')
    : this.continuousHeight ? (this.viewRotation === 'rotated' ? 'right' : 'bottom')
    : null
  );

  currentFormat = $derived(ALL_FORMATS.find(f => f.id === this.format) ?? null);

  // Margins in mm for each edge of the label as displayed
  displayMargins = $derived.by<Margins>(() => {
    if (this.marginMode === 'none') return { top: 0, right: 0, bottom: 0, left: 0 };
    if (this.marginMode === 'custom') {
      const mm = (v: number) => Math.max(0, Number(v) || 0);
      const m = this.customMargins;
      return { top: mm(m.top), right: mm(m.right), bottom: mm(m.bottom), left: mm(m.left) };
    }
    // Side margins go across the roll, end margins along the feed (the continuous
    // or length direction). Only which axis is horizontal on screen changes.
    const acrossIsHorizontal = (this.viewRotation === 'normal') !== this.continuousWidth;
    const horizontal = acrossIsHorizontal ? DEFAULT_MARGIN_SIDES : DEFAULT_MARGIN_ENDS;
    const vertical = acrossIsHorizontal ? DEFAULT_MARGIN_ENDS : DEFAULT_MARGIN_SIDES;
    return { top: vertical, right: horizontal, bottom: vertical, left: horizontal };
  });
}

export const label = new LabelSetup();

export function selectLabelFormat(id: string) {
  label.format = id;
  const format = ALL_FORMATS.find(f => f.id === id);
  if (!format) return; // custom: keep the current dimensions
  label.width = format.width;
  label.continuousWidth = false;
  label.continuousHeight = format.height === null;
  label.height = format.height ?? clampLength(label.height);
}

export function setMarginMode(mode: MarginMode) {
  if (mode === 'custom' && label.marginMode !== 'custom') {
    // Start from what's currently shown
    label.customMargins = { ...label.displayMargins };
  }
  label.marginMode = mode;
}

// Only one dimension can be continuous: run after its checkbox changes
export function handleContinuousWidth() {
  if (label.continuousWidth) {
    label.continuousHeight = false;
    label.width = clampLength(label.width);
  }
}

export function handleContinuousHeight() {
  if (label.continuousHeight) {
    label.continuousWidth = false;
    label.height = clampLength(label.height);
  }
}
