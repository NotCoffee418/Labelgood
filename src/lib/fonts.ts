export const GENERIC_FONTS = [
  { value: 'sans-serif', label: 'Sans Serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
];

// Used if the system font list can't be read
export const FALLBACK_FONTS = [
  'Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia',
  'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
];

export function cssFontFamily(family: string): string {
  if (GENERIC_FONTS.some(f => f.value === family)) return family;
  return `"${family.replace(/"/g, '')}", sans-serif`;
}
