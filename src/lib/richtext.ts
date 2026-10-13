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

// Text dragged around inside a text box keeps the browser's own move; anything dragged in
// from elsewhere goes in as plain text at the drop point, like a paste
let draggingInsideBox = false;

export function startTextDrag() {
  draggingInsideBox = true;
}

export function endTextDrag() {
  draggingInsideBox = false;
}

export function dropPlainText(event: DragEvent) {
  if (draggingInsideBox) return;
  event.preventDefault();
  const text = event.dataTransfer?.getData('text/plain') ?? '';
  const range = caretRangeAt(event.clientX, event.clientY);
  if (!text || !range) return;
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('insertText', false, text);
}

// ---- Sanitizing ----
// Text box HTML comes from label files (possibly someone else's) and from what the browser
// inserts while editing. Only the markup the editor itself makes is kept: formatting tags
// and the style properties the formatting controls set. Everything else is dropped, so a
// label can't carry scripts, event handlers, links, images or anything that loads.

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
// What execCommand produces, plus the line wrappers contenteditable inserts
const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'span', 'font', 'div', 'p', 'br']);
// Removed with their content, which isn't text meant for the label
const DROPPED_TAGS = new Set([
  'script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'img', 'picture', 'video', 'audio', 'source', 'track', 'canvas', 'map', 'area', 'link', 'meta',
  'base', 'head', 'title', 'input', 'textarea', 'select', 'button', 'option',
]);
const FONT_ATTRIBUTES = new Set(['face', 'size', 'color']);
const STYLE_PROPERTIES = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-align']);
// `text-decoration` is stored as its longhands (line, style, color, thickness)
const isAllowedStyle = (property: string) => STYLE_PROPERTIES.has(property) || property.startsWith('text-decoration');

// Removes everything but allowed markup from `root`, in place. Returns whether anything
// changed: clean content is left untouched, so the caret stays where it is while typing.
export function sanitizeNode(root: Node): boolean {
  let changed = false;
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (!(node instanceof Element)) {
      node.remove(); // comments and the like
      changed = true;
      continue;
    }
    const tag = node.localName;
    if (node.namespaceURI !== HTML_NAMESPACE || DROPPED_TAGS.has(tag)) {
      // Attributes first: a removed element can still fire handlers (e.g. an image's onerror)
      for (const attr of Array.from(node.attributes)) node.removeAttribute(attr.name);
      node.remove();
      changed = true;
      continue;
    }
    if (sanitizeNode(node)) changed = true;
    if (!ALLOWED_TAGS.has(tag)) {
      for (const attr of Array.from(node.attributes)) node.removeAttribute(attr.name);
      unwrap(node); // keep its text
      changed = true;
      continue;
    }
    if (sanitizeAttributes(node as HTMLElement)) changed = true;
  }
  return changed;
}

function sanitizeAttributes(el: HTMLElement): boolean {
  let changed = false;
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'style' || (el.localName === 'font' && FONT_ATTRIBUTES.has(attr.name))) continue;
    el.removeAttribute(attr.name);
    changed = true;
  }
  if (el.hasAttribute('style')) {
    for (const property of Array.from(el.style)) {
      if (isAllowedStyle(property)) continue;
      el.style.removeProperty(property);
      changed = true;
    }
    if (el.style.length === 0) {
      el.removeAttribute('style');
      changed = true;
    }
  }
  return changed;
}

// Clean text box HTML, parsed in an inert template so nothing in it loads or runs. The
// cleaned tree is serialized again even when nothing was removed, so what gets parsed
// later is exactly what was checked.
export function sanitizeHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  sanitizeNode(template.content);
  return template.innerHTML;
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
