import type { DrawingDocument } from "./model";

interface Entry {
  document: DrawingDocument;
  label: string;
  key?: string;
  at: number;
}

export class DrawingHistory {
  private entries: Entry[];
  private index = 0;
  private sealed = false;

  constructor(
    initial: DrawingDocument,
    private readonly limit = 200,
    private readonly coalesceMs = 900,
  ) {
    this.entries = [{ document: initial, label: "Initial", at: Date.now() }];
  }

  get current(): DrawingDocument {
    return this.entries[this.index].document;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  push(document: DrawingDocument, label: string, key?: string): void {
    const now = Date.now();
    const top = this.entries[this.index];
    if (
      key &&
      !this.sealed &&
      this.index === this.entries.length - 1 &&
      top.key === key &&
      now - top.at <= this.coalesceMs
    ) {
      this.entries[this.index] = { document, label, key, at: now };
      return;
    }
    this.entries = [
      ...this.entries.slice(0, this.index + 1),
      { document, label, key, at: now },
    ].slice(-this.limit);
    this.index = this.entries.length - 1;
    this.sealed = false;
  }

  seal(): void {
    this.sealed = true;
  }

  undo(): DrawingDocument | null {
    if (!this.canUndo) return null;
    this.index -= 1;
    this.sealed = true;
    return this.current;
  }

  redo(): DrawingDocument | null {
    if (!this.canRedo) return null;
    this.index += 1;
    this.sealed = true;
    return this.current;
  }

  clear(document: DrawingDocument): void {
    this.entries = [{ document, label: "Initial", at: Date.now() }];
    this.index = 0;
    this.sealed = false;
  }
}
