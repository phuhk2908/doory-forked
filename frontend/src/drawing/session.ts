import { useCallback, useEffect, useRef, useState } from "react";
import type { DrawingDocument } from "./model";

export interface DrawingSessionOptions {
  save(document: DrawingDocument): Promise<void>;
  delayMs: number;
  canSave?: () => boolean;
  onError?: (error: unknown) => void;
}

export interface DrawingSessionState {
  dirty: boolean;
  saving: boolean;
}

type StateListener = (state: DrawingSessionState) => void;

/**
 * Owns the save lifecycle for a Whiteboard while its concrete persistence adapter stays outside the module.
 * Saves are coalesced, serialized, retried through the pending document, and flushed when the owner unmounts.
 */
export class DrawingSessionController {
  private options: DrawingSessionOptions;
  private readonly listen: StateListener;
  private pending: DrawingDocument | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private savingPromise: Promise<void> | null = null;
  private state: DrawingSessionState = { dirty: false, saving: false };
  private disposed = false;

  constructor(options: DrawingSessionOptions, listen: StateListener) {
    this.options = options;
    this.listen = listen;
  }

  update(options: DrawingSessionOptions): void {
    if (!this.disposed) this.options = options;
  }

  queue(document: DrawingDocument, immediate = false): void {
    if (this.disposed) return;
    this.pending = document;
    this.setState({ dirty: true });
    this.clearTimer();
    if (immediate) {
      void this.flush().catch(() => undefined);
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, this.options.delayMs);
  }

  async saveNow(document: DrawingDocument): Promise<void> {
    this.queue(document, true);
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.savingPromise) {
      await this.savingPromise;
      if (this.pending) await this.flush();
      return;
    }

    if (!this.pending) {
      this.setState({ dirty: false });
      return;
    }
    if (this.options.canSave && !this.options.canSave()) return;

    this.clearTimer();
    const document = this.pending;
    this.pending = null;
    const task = Promise.resolve()
      .then(() => this.options.save(document))
      .catch((error: unknown) => {
        this.pending = this.pending ?? document;
        this.setState({ dirty: true });
        try {
          this.options.onError?.(error);
        } catch {
          // Error reporting must not replace the save failure or lose the pending document.
        }
        throw error;
      });
    this.savingPromise = task;
    this.setState({ saving: true });
    try {
      await task;
    } finally {
      this.savingPromise = null;
      this.setState({ saving: false });
    }
    if (!this.pending) this.setState({ dirty: false });
    else await this.flush();
  }

  markSaved(): void {
    if (!this.pending && !this.savingPromise) this.setState({ dirty: false });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.clearTimer();
    await this.flush();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private setState(patch: Partial<DrawingSessionState>): void {
    const next = { ...this.state, ...patch };
    if (next.dirty === this.state.dirty && next.saving === this.state.saving)
      return;
    this.state = next;
    this.listen(next);
  }
}

export function useDrawingSession(
  options: DrawingSessionOptions,
): DrawingSessionState & {
  queue(document: DrawingDocument, immediate?: boolean): void;
  saveNow(document: DrawingDocument): Promise<void>;
  flush(): Promise<void>;
  markSaved(): void;
} {
  const [state, setState] = useState<DrawingSessionState>({
    dirty: false,
    saving: false,
  });
  const controllerRef = useRef<DrawingSessionController | null>(null);
  if (controllerRef.current === null)
    controllerRef.current = new DrawingSessionController(options, setState);
  else controllerRef.current.update(options);

  useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      void controller?.dispose().catch(() => undefined);
    };
  }, []);

  const queue = useCallback(
    (document: DrawingDocument, immediate = false) =>
      controllerRef.current?.queue(document, immediate),
    [],
  );
  const saveNow = useCallback(
    (document: DrawingDocument) =>
      controllerRef.current?.saveNow(document) ?? Promise.resolve(),
    [],
  );
  const flush = useCallback(
    () => controllerRef.current?.flush() ?? Promise.resolve(),
    [],
  );
  const markSaved = useCallback(() => controllerRef.current?.markSaved(), []);
  return { ...state, queue, saveNow, flush, markSaved };
}
