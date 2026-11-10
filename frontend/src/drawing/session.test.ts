import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankDrawing, createElement, type DrawingDocument } from "./model";
import { DrawingSessionController, type DrawingSessionState } from "./session";

describe("DrawingSessionController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function documentWith(id: string): DrawingDocument {
    return {
      ...blankDrawing(),
      elements: [{ ...createElement("rectangle"), id }],
    };
  }

  function setup(
    save: (document: DrawingDocument) => Promise<void>,
    options: Partial<{
      canSave: () => boolean;
      onError: (error: unknown) => void;
    }> = {},
  ) {
    let state: DrawingSessionState = { dirty: false, saving: false };
    const controller = new DrawingSessionController(
      {
        save,
        delayMs: 20,
        ...options,
      },
      (next) => {
        state = next;
      },
    );
    return { controller, getState: () => state };
  }

  it("coalesces changes behind one delayed save", async () => {
    const save = vi.fn<(document: DrawingDocument) => Promise<void>>(
      async () => undefined,
    );
    const { controller, getState } = setup(save);

    controller.queue(documentWith("first"));
    controller.queue(documentWith("latest"));
    expect(getState()).toEqual({ dirty: true, saving: false });

    await vi.advanceTimersByTimeAsync(20);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].elements[0]?.id).toBe("latest");
    expect(getState()).toEqual({ dirty: false, saving: false });
  });

  it("serializes a change made while a save is in flight", async () => {
    let release!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = vi
      .fn<(document: DrawingDocument) => Promise<void>>()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(undefined);
    const { controller } = setup(save);

    controller.queue(documentWith("first"), true);
    await Promise.resolve();
    controller.queue(documentWith("second"));
    const flushed = controller.flush();
    expect(save).toHaveBeenCalledTimes(1);

    release();
    await flushed;

    expect(save.mock.calls[0]?.[0].elements[0]?.id).toBe("first");
    expect(save.mock.calls[1]?.[0].elements[0]?.id).toBe("second");
  });

  it("keeps the failed document pending and reports the error", async () => {
    const failure = new Error("offline");
    const save = vi
      .fn<(document: DrawingDocument) => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const { controller, getState } = setup(save, { onError });
    const document = documentWith("retry");

    controller.queue(document, true);
    await expect(controller.flush()).rejects.toBe(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(getState().dirty).toBe(true);

    await controller.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(getState()).toEqual({ dirty: false, saving: false });
  });

  it("waits until an adapter can save without dropping the pending document", async () => {
    let canSave = false;
    const save = vi.fn<(document: DrawingDocument) => Promise<void>>(
      async () => undefined,
    );
    const { controller, getState } = setup(save, {
      canSave: () => canSave,
    });

    controller.queue(documentWith("waiting"), true);
    await controller.flush();
    expect(save).not.toHaveBeenCalled();
    expect(getState().dirty).toBe(true);

    canSave = true;
    await controller.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(getState().dirty).toBe(false);
  });

  it("flushes pending work when disposed", async () => {
    const save = vi.fn<(document: DrawingDocument) => Promise<void>>(
      async () => undefined,
    );
    const { controller } = setup(save);
    controller.queue(documentWith("closing"));

    await controller.dispose();

    expect(save.mock.calls[0]?.[0].elements[0]?.id).toBe("closing");
  });
});
