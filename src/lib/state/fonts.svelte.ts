import { getDefaultFonts, listFonts } from '#lib/commands.ts';

// The fonts installed on this system
class Fonts {
  system = $state<string[]>([]);
  // What the generic families resolve to on this system, e.g. sans-serif -> "Noto Sans"
  defaults = $state<Record<string, string | null>>({});
}

export const fonts = new Fonts();

export async function loadFonts() {
  try {
    fonts.system = await listFonts();
  } catch (error) {
    console.error('Failed to load fonts:', error);
  }
  try {
    const resolved = await getDefaultFonts();
    fonts.defaults = { 'sans-serif': resolved?.sans_serif ?? null, serif: resolved?.serif ?? null, monospace: resolved?.monospace ?? null };
  } catch (error) {
    console.error('Failed to resolve default fonts:', error);
  }
}

// The system's default fonts are listed by what they resolve to
export function genericFontLabel(font: { value: string; label: string }): string {
  return fonts.defaults[font.value] ?? font.label;
}
