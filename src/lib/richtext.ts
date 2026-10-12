// Helpers for the contenteditable text boxes
import type { TextStyle } from './types';

export type RangeStyle = Pick<TextStyle, 'fontFamily' | 'fontSize' | 'color'>;

export function caretRangeAt(x: number, y: number): Range | null {
  const doc = document as any;
  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const range = document.createRange();
  range.setStart(pos.offsetNode, pos.offset);
  range.collapse(true);
  return range;
}

// Reads the formatting at the start of a selection from the rendered text
export function styleAtRange(range: Range): RangeStyle | null {
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
export function clearInlineFormat(root: HTMLElement, key: keyof TextStyle) {
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

// Applies one style property to `range` inside the text box `root`, leaving it selected
export function formatRange(root: HTMLElement, range: Range, key: keyof TextStyle, value: TextStyle[keyof TextStyle]) {
  root.focus();
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);

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
      for (const font of Array.from(root.querySelectorAll('font[size="7"]'))) {
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
}

// Paste as plain text so formatting from other apps doesn't leak in
export function pastePlainText(event: ClipboardEvent) {
  event.preventDefault();
  const text = event.clipboardData?.getData('text/plain') ?? '';
  document.execCommand('insertText', false, text);
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
