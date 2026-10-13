const HISTORY_LIMIT = 200;
const SETTLE_DELAY = 400; // ms

type UndoableDocument = {
  snapshot(): string; // JSON of the document; read reactively
  restore(json: string): void;
  busy(): boolean; // mid-gesture or mid-edit: changes are committed when that finishes
};

// Undo history: JSON snapshots of the document
export class History {
  canUndo = $state(false);
  canRedo = $state(false);

  #doc: UndoableDocument;
  #undoStack: string[] = [];
  #redoStack: string[] = [];
  #lastCommitted: string | null = null;
  #commitTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(doc: UndoableDocument) {
    this.#doc = doc;
  }

  // Records document changes once they settle, so a drag or a burst of typing is one
  // step. Call during component initialisation.
  track() {
    $effect(() => {
      const json = this.#doc.snapshot();
      if (this.#lastCommitted === null) {
        this.#lastCommitted = json;
        return;
      }
      clearTimeout(this.#commitTimer);
      this.#commitTimer = setTimeout(() => this.commit(), SETTLE_DELAY);
    });
  }

  commit() {
    clearTimeout(this.#commitTimer);
    if (this.#lastCommitted === null || this.#doc.busy()) return;
    const json = this.#doc.snapshot();
    if (json === this.#lastCommitted) return;
    this.#undoStack.push(this.#lastCommitted);
    if (this.#undoStack.length > HISTORY_LIMIT) this.#undoStack.shift();
    this.#redoStack = [];
    this.#lastCommitted = json;
    this.canUndo = true;
    this.canRedo = false;
  }

  // Starts over from the current document, e.g. after opening a file
  reset() {
    clearTimeout(this.#commitTimer);
    this.#undoStack = [];
    this.#redoStack = [];
    this.#lastCommitted = this.#doc.snapshot();
    this.canUndo = false;
    this.canRedo = false;
  }

  undo() {
    this.commit();
    const previous = this.#undoStack.pop();
    if (previous === undefined || this.#lastCommitted === null) return;
    this.#redoStack.push(this.#lastCommitted);
    this.#restore(previous);
  }

  redo() {
    this.commit();
    const next = this.#redoStack.pop();
    if (next === undefined || this.#lastCommitted === null) return;
    this.#undoStack.push(this.#lastCommitted);
    this.#restore(next);
  }

  #restore(json: string) {
    this.#lastCommitted = json;
    this.#doc.restore(json);
    this.canUndo = this.#undoStack.length > 0;
    this.canRedo = this.#redoStack.length > 0;
  }
}
