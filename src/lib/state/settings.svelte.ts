// Settings remembered between runs, and the theme
import { getCurrentWindow } from '@tauri-apps/api/window';
import { MAX_ZOOM, MIN_ZOOM } from '$lib/constants';
import type { MarginMode, Theme } from '$lib/types';
import { canvas } from './canvas.svelte';
import { labelDocument } from './document.svelte';
import { editor } from './editor.svelte';
import { label } from './label.svelte';
import { output } from './output.svelte';

const SETTINGS_KEY = 'labelgood-settings';
const MARGIN_MODES: MarginMode[] = ['default', 'none', 'custom'];

class Settings {
  theme = $state<Theme>('system');
}

export const settings = new Settings();

// Restore the last used settings
export function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return;
    const s = JSON.parse(saved);
    label.format = s.labelFormat ?? label.format;
    label.width = s.width ?? label.width;
    label.height = s.height ?? label.height;
    label.continuousWidth = s.continuousWidth ?? label.continuousWidth;
    label.continuousHeight = s.continuousHeight ?? label.continuousHeight;
    label.orientation = s.orientation ?? label.orientation;
    if (MARGIN_MODES.includes(s.marginMode)) label.marginMode = s.marginMode;
    label.customMargins = { ...label.customMargins, ...s.customMargins };
    settings.theme = s.theme ?? settings.theme;
    editor.defaultStyle = { ...editor.defaultStyle, ...s.defaultStyle };
    editor.defaultShape = { ...editor.defaultShape, ...s.defaultShape };
    output.selectedPrinter = s.selectedPrinter ?? output.selectedPrinter;
    output.copies = s.copies >= 1 ? s.copies : output.copies;
    output.printChoices = s.printChoices ?? output.printChoices;
    output.lastSaveDir = s.lastSaveDir ?? output.lastSaveDir;
    labelDocument.lastDir = s.lastLabelDir ?? labelDocument.lastDir;
    if (Array.isArray(s.recentLabels)) labelDocument.recent = s.recentLabels.filter((p: unknown) => typeof p === 'string');
    if (s.zoom >= MIN_ZOOM && s.zoom <= MAX_ZOOM) canvas.zoom = s.zoom;
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// Saves settings once they've stopped changing (not on every step of a drag).
// Call during component initialisation.
export function persistSettings() {
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const json = JSON.stringify({
      labelFormat: label.format,
      width: label.width,
      height: label.height,
      continuousWidth: label.continuousWidth,
      continuousHeight: label.continuousHeight,
      orientation: label.orientation,
      marginMode: label.marginMode,
      customMargins: label.customMargins,
      theme: settings.theme,
      defaultStyle: editor.defaultStyle,
      defaultShape: editor.defaultShape,
      selectedPrinter: output.selectedPrinter,
      copies: output.copies,
      printChoices: output.printChoices,
      lastSaveDir: output.lastSaveDir,
      lastLabelDir: labelDocument.lastDir,
      recentLabels: labelDocument.recent,
      zoom: canvas.zoom,
    });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(SETTINGS_KEY, json);
      } catch (error) {
        console.error('Failed to save settings:', error);
      }
    }, 300);
  });
}

// Applies the theme ("system" leaves it to prefers-color-scheme). Call during component initialisation.
export function applyTheme() {
  $effect(() => {
    const { theme } = settings;
    if (theme === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
    // Match the native window frame (getCurrentWindow throws outside Tauri)
    try {
      getCurrentWindow().setTheme(theme === 'system' ? null : theme).catch(() => {});
    } catch {}
  });
}
