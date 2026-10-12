// Whether an event happened in a field the user types into, which keeps its own
// shortcuts, paste and context menu
export function isEditableTarget(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]');
}

// For toolbar buttons: a mousedown would move focus off the text being edited and
// lose its selection, so the click formats the selection instead
export function keepTextFocus(event: MouseEvent) {
  event.preventDefault();
}
