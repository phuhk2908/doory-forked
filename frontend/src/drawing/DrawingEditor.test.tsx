import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import {
  DrawingEditor,
  type DrawingEditorHandle,
  trimEraserTrail,
} from "./DrawingEditor";
import {
  DEFAULT_STYLE,
  blankDrawing,
  createElement,
  mergeDrawingDocuments,
  type DrawingDocument,
  type LinearElement,
  type TextElement,
} from "./model";
import { createLinear } from "./scene";
import { exportDrawing } from "./renderer";

vi.mock("./renderer", () => ({
  exportDrawing: vi.fn(async () => new Blob()),
  renderDrawing: vi.fn(),
}));

describe("DrawingEditor", () => {
  it("keeps only the recent distance of the eraser trail", () => {
    expect(
      trimEraserTrail(
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 80, y: 0 },
          { x: 120, y: 0 },
        ],
        80,
      ),
    ).toEqual([
      { x: 40, y: 0 },
      { x: 80, y: 0 },
      { x: 120, y: 0 },
    ]);
  });

  function dispatchPointer(
    canvas: HTMLElement,
    type:
      | "pointerdown"
      | "pointermove"
      | "pointerup"
      | "pointercancel"
      | "lostpointercapture",
    clientX: number,
    clientY: number,
    pointerId = 1,
    shiftKey = false,
    pointerType: "mouse" | "touch" = "mouse",
    altKey = false,
  ): void {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY,
      shiftKey,
      altKey,
    });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    act(() => {
      canvas.dispatchEvent(event);
    });
  }

  it("uses the normal cursor state for select mode", async () => {
    render(<DrawingEditor initialDocument={blankDrawing()} />);

    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    expect(canvas).toHaveAttribute("data-select-mode", "true");
    expect(canvas).toHaveAttribute("data-tool", "select");

    await userEvent.click(screen.getByRole("button", { name: /Eraser/ }));
    expect(canvas).toHaveAttribute("data-select-mode", "false");
    expect(canvas).toHaveAttribute("data-tool", "eraser");

    await userEvent.click(screen.getByRole("button", { name: /Select/ }));
    expect(canvas).toHaveAttribute("data-select-mode", "true");
    expect(canvas).toHaveAttribute("data-tool", "select");
  });

  it("shows the hand cursor state while Space is held", () => {
    render(<DrawingEditor initialDocument={blankDrawing()} />);

    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(canvas).toHaveAttribute("data-pan-mode", "true");

    fireEvent.keyUp(window, { code: "Space", key: " " });
    expect(canvas).toHaveAttribute("data-pan-mode", "false");
  });

  it("returns to the starting zoom after one zoom in and out", async () => {
    render(<DrawingEditor initialDocument={blankDrawing()} />);

    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  function configureContextCanvas(
    canvas: HTMLElement,
    width = 320,
    height = 240,
  ): void {
    const rect = {
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
    };
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => rect,
    });
    Object.defineProperty(canvas, "clientWidth", {
      configurable: true,
      value: width,
    });
    Object.defineProperty(canvas, "clientHeight", {
      configurable: true,
      value: height,
    });
    const wrap = canvas.parentElement;
    if (wrap) {
      Object.defineProperty(wrap, "getBoundingClientRect", {
        configurable: true,
        value: () => rect,
      });
      Object.defineProperty(wrap, "clientWidth", {
        configurable: true,
        value: width,
      });
      Object.defineProperty(wrap, "clientHeight", {
        configurable: true,
        value: height,
      });
    }
  }

  it("opens a context menu on an element and reuses selection actions", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    const rectangle = createElement("rectangle", {
      id: "context-menu-shape",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    configureContextCanvas(canvas);

    fireEvent.contextMenu(canvas, {
      button: 2,
      clientX: 170,
      clientY: 140,
    });

    expect(
      screen.getByRole("menu", { name: "Canvas context menu" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Duplicate selection/ }),
    ).not.toBeDisabled();

    await userEvent.click(
      screen.getByRole("menuitem", { name: /Duplicate selection/ }),
    );
    expect(editorRef.current?.getDocument().elements).toHaveLength(2);
  });

  it("targets a whole group and dismisses when clicking outside", () => {
    const first = createElement("rectangle", {
      id: "context-group-first",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
      groupIds: ["context-group"],
    });
    const second = createElement("ellipse", {
      id: "context-group-second",
      x: 160,
      y: 40,
      width: 80,
      height: 50,
      groupIds: ["context-group"],
    });
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [first, second] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    configureContextCanvas(canvas);

    fireEvent.contextMenu(canvas, {
      button: 2,
      clientX: 150,
      clientY: 130,
    });

    expect(screen.getAllByText("2 selected").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("menuitem", { name: /Group selection/ }),
    ).not.toBeDisabled();

    fireEvent.pointerDown(document.body);
    expect(
      screen.queryByRole("menu", { name: "Canvas context menu" }),
    ).not.toBeInTheDocument();
  });

  it("opens a blank-canvas context menu with selection actions disabled and clamps it", () => {
    render(<DrawingEditor initialDocument={blankDrawing()} />);
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    configureContextCanvas(canvas);

    fireEvent.contextMenu(canvas, {
      button: 2,
      clientX: 319,
      clientY: 239,
    });

    const menu = screen.getByRole("menu", { name: "Canvas context menu" });
    expect(
      screen.getByRole("menuitem", { name: /Copy selection ⌘C/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("menuitem", { name: /Delete selection/ }),
    ).toBeDisabled();
    expect(
      Number.parseFloat(
        menu.getAttribute("style")?.match(/left:\s*([\d.]+)/)?.[1] ?? "0",
      ),
    ).toBeLessThanOrEqual(72);
    expect(
      Number.parseFloat(
        menu.getAttribute("style")?.match(/top:\s*([\d.]+)/)?.[1] ?? "0",
      ),
    ).toBeLessThanOrEqual(72);
  });

  it("keeps copy available while disabling mutations in read-only mode", () => {
    const rectangle = createElement("rectangle", {
      id: "readonly-context-shape",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    render(
      <DrawingEditor
        readOnly
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    configureContextCanvas(canvas);

    fireEvent.contextMenu(canvas, {
      button: 2,
      clientX: 170,
      clientY: 140,
    });

    expect(
      screen.getByRole("menuitem", { name: /Copy selection ⌘C/ }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("menuitem", { name: /Delete selection/ }),
    ).toBeDisabled();
  });

  it("supports the Context Menu key, arrow navigation, and Escape", () => {
    const rectangle = createElement("rectangle", {
      id: "context-key-shape",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "ContextMenu" });
    const menu = screen.getByRole("menu", { name: "Canvas context menu" });
    expect(menu).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Copy selection ⌘C/ }),
    ).toHaveFocus();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(
      screen.getByRole("menuitem", { name: /Cut selection/ }),
    ).toHaveFocus();

    fireEvent.keyDown(menu, { key: "Escape" });
    expect(
      screen.queryByRole("menu", { name: "Canvas context menu" }),
    ).not.toBeInTheDocument();
  });

  it("uploads an image through the host and inserts only metadata", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    const onUploadImage = vi.fn(async () => ({
      id: "image-file",
      mime: "image/png",
      name: "photo.png",
      url: "https://cdn.test/photo.png",
      width: 1600,
      height: 800,
    }));
    const { container } = render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={blankDrawing()}
        onUploadImage={onUploadImage}
      />,
    );

    const input = container.querySelector(
      'input[type="file"][accept="image/*"]',
    );
    expect(input).toBeInstanceOf(HTMLInputElement);
    await userEvent.upload(
      input as HTMLInputElement,
      new File(["private image bytes"], "photo.png", { type: "image/png" }),
    );

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
    const document = editorRef.current?.getDocument();
    expect(document?.elements[0]).toMatchObject({
      type: "image",
      fileId: "image-file",
      width: 360,
      height: 180,
    });
    expect(document?.files).toEqual({
      "image-file": {
        id: "image-file",
        mime: "image/png",
        name: "photo.png",
        url: "https://cdn.test/photo.png",
        width: 1600,
        height: 800,
      },
    });
    expect(JSON.stringify(document)).not.toContain("private image bytes");
  });

  it("uploads an image dropped onto the canvas at the drop point", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    const onUploadImage = vi.fn(async (file: File) => ({
      id: "dropped-image-file",
      mime: file.type,
      name: file.name,
      url: "https://cdn.test/dropped.png",
      width: 100,
      height: 60,
    }));
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={blankDrawing()}
        onUploadImage={onUploadImage}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    configureContextCanvas(canvas);
    const file = new File(["dropped image bytes"], "dropped.png", {
      type: "image/png",
    });
    const dataTransfer = {
      files: [file],
      items: [{ kind: "file" }],
      dropEffect: "none",
    };

    fireEvent.dragOver(canvas, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
    const dropEvent = createEvent.drop(canvas);
    Object.defineProperty(dropEvent, "dataTransfer", {
      configurable: true,
      value: dataTransfer,
    });
    Object.defineProperty(dropEvent, "clientX", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(dropEvent, "clientY", {
      configurable: true,
      value: 160,
    });
    fireEvent(canvas, dropEvent);

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
    expect(editorRef.current?.getDocument().elements[0]).toMatchObject({
      type: "image",
      fileId: "dropped-image-file",
      x: 30,
      y: 50,
      width: 100,
      height: 60,
    });
  });

  it("replaces a selected image without changing its frame or style", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    const image = createElement("image", {
      id: "replace-image",
      fileId: "old-image-file",
      x: 40,
      y: 60,
      width: 240,
      height: 120,
      angle: 18,
      style: {
        ...createElement("image").style,
        opacity: 0.6,
        stroke: "#ef4444",
      },
    });
    const onUploadImage = vi.fn(async () => ({
      id: "new-image-file",
      mime: "image/jpeg",
      name: "replacement.jpg",
      url: "https://cdn.test/replacement.jpg",
      width: 1600,
      height: 900,
    }));
    const { container } = render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{
          ...blankDrawing(),
          elements: [image],
          files: {
            "old-image-file": {
              id: "old-image-file",
              mime: "image/png",
              name: "old.png",
              url: "https://cdn.test/old.png",
            },
          },
        }}
        onUploadImage={onUploadImage}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Replace image" }),
    );
    const input = container.querySelector(
      'input[type="file"][accept="image/*"]',
    );
    expect(input).toBeInstanceOf(HTMLInputElement);
    await userEvent.upload(
      input as HTMLInputElement,
      new File(["replacement bytes"], "replacement.jpg", {
        type: "image/jpeg",
      }),
    );

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
    const document = editorRef.current?.getDocument();
    expect(document?.elements[0]).toMatchObject({
      id: image.id,
      type: "image",
      fileId: "new-image-file",
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
      angle: image.angle,
      style: image.style,
    });
    expect(document?.files).toMatchObject({
      "old-image-file": expect.objectContaining({ id: "old-image-file" }),
      "new-image-file": expect.objectContaining({ id: "new-image-file" }),
    });
    expect(screen.getByText("Replaced image")).toBeInTheDocument();

    act(() => editorRef.current?.undo());
    expect(editorRef.current?.getDocument().elements[0]).toMatchObject({
      id: image.id,
      fileId: "old-image-file",
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
      angle: image.angle,
    });
  });

  it("resolves image URLs before imperative export", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    const image = createElement("image", {
      fileId: "image-file",
      width: 100,
      height: 50,
    });
    const onResolveImage = vi.fn(async () => "blob:image-file");
    vi.mocked(exportDrawing).mockClear();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{
          ...blankDrawing(),
          elements: [image],
          files: {
            "image-file": {
              id: "image-file",
              mime: "image/png",
              name: "photo.png",
              url: "idb://image-file",
            },
          },
        }}
        onResolveImage={onResolveImage}
      />,
    );

    await editorRef.current?.export({ format: "svg" });

    await waitFor(() => expect(onResolveImage).toHaveBeenCalledTimes(1));
    expect(vi.mocked(exportDrawing).mock.calls.at(-1)?.[3]).toEqual({
      imageUrls: new Map([["image-file", "blob:image-file"]]),
    });
  });

  it("waits for an in-flight image resolution before imperative export", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    const image = createElement("image", {
      fileId: "image-file",
      width: 100,
      height: 50,
    });
    let resolveImage!: (url: string) => void;
    const pendingImage = new Promise<string>((resolve) => {
      resolveImage = resolve;
    });
    const onResolveImage = vi.fn(() => pendingImage);
    vi.mocked(exportDrawing).mockClear();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{
          ...blankDrawing(),
          elements: [image],
          files: {
            "image-file": {
              id: "image-file",
              mime: "image/png",
              name: "photo.png",
              url: "idb://image-file",
            },
          },
        }}
        onResolveImage={onResolveImage}
      />,
    );

    await waitFor(() => expect(onResolveImage).toHaveBeenCalledTimes(1));
    const exportPromise = editorRef.current?.export({ format: "svg" });
    await Promise.resolve();
    expect(exportDrawing).not.toHaveBeenCalled();

    resolveImage("blob:image-file");
    await exportPromise;
    expect(vi.mocked(exportDrawing).mock.calls.at(-1)?.[3]).toEqual({
      imageUrls: new Map([["image-file", "blob:image-file"]]),
    });
  });

  it("fits the current selection with the 2 shortcut", () => {
    const rectangle = createElement("rectangle", {
      id: "fit-selection-shape",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "clientWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(canvas, "clientHeight", {
      configurable: true,
      value: 600,
    });

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "2" });

    expect(screen.getByText("400%")).toBeInTheDocument();
  });

  it("snaps new shapes to the grid when grid snapping is enabled", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    render(<DrawingEditor ref={editorRef} initialDocument={blankDrawing()} />);
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    fireEvent.keyDown(window, { key: "g", shiftKey: true });
    await userEvent.click(screen.getByRole("button", { name: /Rectangle/ }));
    dispatchPointer(canvas, "pointerdown", 145, 115);
    dispatchPointer(canvas, "pointermove", 265, 215);
    dispatchPointer(canvas, "pointerup", 265, 215);

    expect(editorRef.current?.getDocument().elements[0]).toMatchObject({
      x: 40,
      y: 40,
      width: 120,
      height: 80,
    });
  });

  it("supports touch pinch zoom without committing a half-drawn shape", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    render(<DrawingEditor ref={editorRef} initialDocument={blankDrawing()} />);
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    await userEvent.click(screen.getByRole("button", { name: /Rectangle/ }));

    dispatchPointer(canvas, "pointerdown", 200, 200, 1, false, "touch");
    dispatchPointer(canvas, "pointerdown", 300, 200, 2, false, "touch");
    dispatchPointer(canvas, "pointermove", 400, 200, 2, false, "touch");

    expect(screen.getByText("200%")).toBeInTheDocument();
    dispatchPointer(canvas, "pointerup", 400, 200, 2, false, "touch");
    dispatchPointer(canvas, "pointerup", 200, 200, 1, false, "touch");
    expect(editorRef.current?.getDocument().elements).toHaveLength(0);
  });

  it.each(["Text", "Note"])(
    "does not turn a %s placement into a pinch gesture",
    async (label) => {
      const editorRef = createRef<DrawingEditorHandle>();
      render(
        <DrawingEditor ref={editorRef} initialDocument={blankDrawing()} />,
      );
      const canvas = screen.getByRole("application", {
        name: "Whiteboard canvas",
      });
      Object.defineProperty(canvas, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
          right: 800,
          bottom: 600,
        }),
      });
      Object.defineProperty(canvas, "setPointerCapture", {
        configurable: true,
        value: vi.fn(),
      });
      Object.defineProperty(canvas, "hasPointerCapture", {
        configurable: true,
        value: vi.fn(() => true),
      });
      Object.defineProperty(canvas, "releasePointerCapture", {
        configurable: true,
        value: vi.fn(),
      });
      await userEvent.click(
        screen.getByRole("button", { name: new RegExp(label) }),
      );

      dispatchPointer(canvas, "pointerdown", 200, 200, 1, false, "touch");
      dispatchPointer(canvas, "pointerdown", 300, 200, 2, false, "touch");
      dispatchPointer(canvas, "pointermove", 400, 200, 2, false, "touch");

      expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
      expect(editorRef.current?.getDocument().elements).toHaveLength(1);
      dispatchPointer(canvas, "pointerup", 400, 200, 2, false, "touch");
      dispatchPointer(canvas, "pointerup", 200, 200, 1, false, "touch");
    },
  );

  it("cleans up a cancelled touch pinch before the next gesture", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    render(<DrawingEditor ref={editorRef} initialDocument={blankDrawing()} />);
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    await userEvent.click(screen.getByRole("button", { name: /Rectangle/ }));

    dispatchPointer(canvas, "pointerdown", 200, 200, 1, false, "touch");
    dispatchPointer(canvas, "pointerdown", 300, 200, 2, false, "touch");
    dispatchPointer(canvas, "pointermove", 400, 200, 2, false, "touch");
    expect(screen.getByText("200%")).toBeInTheDocument();
    dispatchPointer(canvas, "pointercancel", 200, 200, 1, false, "touch");
    dispatchPointer(canvas, "pointerup", 400, 200, 2, false, "touch");

    dispatchPointer(canvas, "pointerdown", 160, 160, 3, false, "touch");
    dispatchPointer(canvas, "pointermove", 280, 240, 3, false, "touch");
    dispatchPointer(canvas, "pointerup", 280, 240, 3, false, "touch");

    expect(editorRef.current?.getDocument().elements).toHaveLength(1);
  });

  it("cleans up a touch pinch when pointer capture is lost", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    render(<DrawingEditor ref={editorRef} initialDocument={blankDrawing()} />);
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    await userEvent.click(screen.getByRole("button", { name: /Rectangle/ }));

    dispatchPointer(canvas, "pointerdown", 200, 200, 1, false, "touch");
    dispatchPointer(canvas, "pointerdown", 300, 200, 2, false, "touch");
    dispatchPointer(canvas, "pointermove", 400, 200, 2, false, "touch");
    dispatchPointer(canvas, "lostpointercapture", 200, 200, 1, false, "touch");
    dispatchPointer(canvas, "pointerup", 400, 200, 2, false, "touch");

    dispatchPointer(canvas, "pointerdown", 160, 160, 3, false, "touch");
    dispatchPointer(canvas, "pointermove", 280, 240, 3, false, "touch");
    dispatchPointer(canvas, "pointerup", 280, 240, 3, false, "touch");

    expect(editorRef.current?.getDocument().elements).toHaveLength(1);
  });

  it("shows the properties panel and resize handles for a selected shape", () => {
    const rectangle = createElement("rectangle", {
      id: "shape",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 170, 140);

    expect(
      screen.getByRole("complementary", { name: "Selection properties" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Resize selection/ }),
    ).toHaveLength(8);
    expect(
      screen.getByRole("button", { name: "Rotate selection" }),
    ).toBeInTheDocument();
  });

  it("keeps the rotate handle the same distance from the selection while zooming", async () => {
    const rectangle = createElement("rectangle", {
      id: "zoomed-handle-shape",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "clientWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(canvas, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 170, 140);
    const northHandle = () =>
      Number.parseFloat(
        screen.getByRole("button", { name: "Resize selection n" }).style.top,
      );
    const rotateHandle = () =>
      Number.parseFloat(
        screen.getByRole("button", { name: "Rotate selection" }).style.top,
      );
    expect(northHandle() - rotateHandle()).toBeCloseTo(24);

    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(northHandle() - rotateHandle()).toBeCloseTo(24);
  });

  it("keeps an image rotation handle aligned after zooming", async () => {
    const image = createElement("image", {
      id: "image-handle",
      fileId: "image-file",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    render(
      <DrawingEditor
        initialDocument={{
          ...blankDrawing(),
          elements: [image],
          files: {
            "image-file": {
              id: "image-file",
              mime: "image/png",
              name: "photo.png",
              url: "https://cdn.test/photo.png",
            },
          },
        }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "clientWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(canvas, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 170, 140);
    const northHandle = () =>
      Number.parseFloat(
        screen.getByRole("button", { name: "Resize selection n" }).style.top,
      );
    const rotateHandle = () =>
      Number.parseFloat(
        screen.getByRole("button", { name: "Rotate selection" }).style.top,
      );
    expect(northHandle() - rotateHandle()).toBeCloseTo(24);
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(northHandle() - rotateHandle()).toBeCloseTo(24);
  });

  it("rotates a multi-selection around its shared centre and undoes it as one gesture", () => {
    const first = createElement("rectangle", {
      id: "multi-rotate-first",
      x: 20,
      y: 30,
      width: 40,
      height: 40,
    });
    const second = createElement("ellipse", {
      id: "multi-rotate-second",
      x: 140,
      y: 30,
      width: 40,
      height: 40,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [first, second] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    const handle = screen.getByRole("button", { name: "Rotate selection" });
    expect(Number.parseFloat(handle.style.left)).toBeCloseTo(220);
    expect(Number.parseFloat(handle.style.top)).toBeCloseTo(86);
    dispatchPointer(handle, "pointerdown", 220, 86);
    dispatchPointer(canvas, "pointermove", 264, 130);
    dispatchPointer(canvas, "pointerup", 264, 130);

    expect(editorRef.current?.getDocument().elements).toMatchObject([
      { id: first.id, x: 80, y: -30, angle: 90 },
      { id: second.id, x: 80, y: 90, angle: 90 },
    ]);
    act(() => editorRef.current?.undo());
    expect(editorRef.current?.getDocument().elements).toMatchObject([
      { id: first.id, x: 20, y: 30, angle: 0 },
      { id: second.id, x: 140, y: 30, angle: 0 },
    ]);
  });

  it("keeps the rotate handle anchored to a rotated single-element frame", () => {
    const rectangle = createElement("rectangle", {
      id: "rotated-handle-shape",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    // The default viewport maps the selection centre to (190, 140).
    dispatchPointer(canvas, "pointerdown", 190, 140);
    const handle = screen.getByRole("button", { name: "Rotate selection" });
    expect(Number.parseFloat(handle.style.left)).toBeCloseTo(190);
    expect(Number.parseFloat(handle.style.top)).toBeCloseTo(86);

    dispatchPointer(handle, "pointerdown", 190, 86);
    dispatchPointer(canvas, "pointermove", 244, 140);
    dispatchPointer(canvas, "pointerup", 244, 140);

    expect(editorRef.current?.getDocument().elements[0]?.angle).toBe(90);
    const rotatedHandle = screen.getByRole("button", {
      name: "Rotate selection",
    });
    expect(Number.parseFloat(rotatedHandle.style.left)).toBeCloseTo(244);
    expect(Number.parseFloat(rotatedHandle.style.top)).toBeCloseTo(140);
  });

  it("snaps a dragged selection to object anchors and clears transient guides", () => {
    const moving = createElement("rectangle", {
      id: "drag-snap-moving",
      x: 20,
      y: 30,
      width: 40,
      height: 40,
    });
    const lockedTarget = createElement("rectangle", {
      id: "drag-snap-target",
      x: 140,
      y: 30,
      width: 40,
      height: 40,
      locked: true,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{
          ...blankDrawing(),
          elements: [moving, lockedTarget],
        }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    // Default viewport maps world (40, 50) to screen (160, 130).
    dispatchPointer(canvas, "pointerdown", 160, 130);
    dispatchPointer(canvas, "pointermove", 238, 130);

    const guide = screen.getByTestId("selection-snap-guide-vertical");
    expect(guide).toHaveAttribute("data-target-id", lockedTarget.id);
    expect(Number.parseFloat(guide.style.left)).toBeCloseTo(260);

    dispatchPointer(canvas, "pointerup", 238, 130);
    expect(screen.queryByTestId("selection-snap-guide-vertical")).toBeNull();
    expect(editorRef.current?.getDocument().elements[0]).toMatchObject({
      id: moving.id,
      x: 100,
    });

    act(() => editorRef.current?.undo());
    expect(editorRef.current?.getDocument().elements[0]).toMatchObject({
      id: moving.id,
      x: 20,
    });

    dispatchPointer(canvas, "pointerdown", 160, 130);
    dispatchPointer(canvas, "pointermove", 238, 130);
    expect(
      screen.getByTestId("selection-snap-guide-vertical"),
    ).toBeInTheDocument();
    dispatchPointer(canvas, "pointercancel", 238, 130);
    expect(screen.queryByTestId("selection-snap-guide-vertical")).toBeNull();
    expect(editorRef.current?.getDocument().elements[0]).toMatchObject({
      id: moving.id,
      x: 20,
    });
  });

  it("lets Alt bypass object and grid snapping during a drag", () => {
    const moving = createElement("rectangle", {
      id: "drag-snap-alt-moving",
      x: 20,
      y: 30,
      width: 40,
      height: 40,
    });
    const target = createElement("rectangle", {
      id: "drag-snap-alt-target",
      x: 140,
      y: 30,
      width: 40,
      height: 40,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [moving, target] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 160, 130);
    dispatchPointer(canvas, "pointermove", 238, 130, 1, false, "mouse", true);
    expect(screen.queryByTestId("selection-snap-guide-vertical")).toBeNull();
    dispatchPointer(canvas, "pointerup", 238, 130, 1, false, "mouse", true);

    expect(editorRef.current?.getDocument().elements[0]).toMatchObject({
      id: moving.id,
      x: 98,
    });
  });

  it("shows equal-spacing hints when placing an element between neighbors", () => {
    const left = createElement("rectangle", {
      id: "spacing-editor-left",
      x: 0,
      y: 20,
      width: 40,
      height: 40,
    });
    const moving = createElement("rectangle", {
      id: "spacing-editor-moving",
      x: 100,
      y: 20,
      width: 40,
      height: 40,
    });
    const right = createElement("rectangle", {
      id: "spacing-editor-right",
      x: 220,
      y: 20,
      width: 40,
      height: 40,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [left, moving, right] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    // Default viewport maps world (120, 40) to screen (240, 120).
    dispatchPointer(canvas, "pointerdown", 240, 120);
    dispatchPointer(canvas, "pointermove", 252, 120);

    const guide = screen.getByTestId("selection-spacing-guide-horizontal");
    expect(guide).toBeInTheDocument();
    expect(guide).toHaveTextContent("70");

    dispatchPointer(canvas, "pointerup", 252, 120);
    expect(editorRef.current?.getDocument().elements[1]).toMatchObject({
      id: moving.id,
      x: 110,
    });
  });

  it("snaps rotation to fifteen-degree increments while Shift is held", () => {
    const rectangle = createElement("rectangle", {
      id: "rotation-snap-shape",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    // The default viewport maps the shape's centre to (190, 140).
    dispatchPointer(canvas, "pointerdown", 190, 140);
    dispatchPointer(canvas, "pointerup", 190, 140);
    const rotateHandle = screen.getByRole("button", {
      name: "Rotate selection",
    });
    const startX = Number.parseFloat(rotateHandle.style.left);
    const startY = Number.parseFloat(rotateHandle.style.top);
    dispatchPointer(rotateHandle, "pointerdown", startX, startY);
    // Move only about eight degrees; Shift should snap that to the nearest 15°.
    dispatchPointer(canvas, "pointermove", startX + 8, startY, 1, true);
    dispatchPointer(canvas, "pointerup", startX + 8, startY, 1, true);

    expect(editorRef.current?.getDocument().elements[0]?.angle).toBe(15);
  });

  it("rotates a focused selection handle with arrow keys", () => {
    const rectangle = createElement("rectangle", {
      id: "keyboard-rotation-shape",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    dispatchPointer(canvas, "pointerdown", 170, 140);
    dispatchPointer(canvas, "pointerup", 170, 140);
    const handle = () =>
      screen.getByRole("button", { name: "Rotate selection" });

    act(() => fireEvent.keyDown(handle(), { key: "ArrowRight" }));
    expect(editorRef.current?.getDocument().elements[0]?.angle).toBe(1);
    act(() =>
      fireEvent.keyDown(handle(), { key: "ArrowLeft", shiftKey: true }),
    );
    expect(editorRef.current?.getDocument().elements[0]?.angle).toBe(346);

    act(() => editorRef.current?.undo());
    expect(editorRef.current?.getDocument().elements[0]?.angle).toBe(0);
  });

  it("aligns a multi-selection from the actions menu and keyboard", async () => {
    const first = createElement("rectangle", {
      id: "align-first",
      x: 20,
      y: 30,
      width: 80,
      height: 40,
    });
    const second = createElement("ellipse", {
      id: "align-second",
      x: 180,
      y: 100,
      width: 40,
      height: 50,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [first, second] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /Align left/ }));

    expect(
      editorRef.current?.getDocument().elements.map((element) => element.x),
    ).toEqual([20, 20]);
    expect(
      editorRef.current?.getDocument().elements.map((element) => element.y),
    ).toEqual([30, 100]);

    fireEvent.keyDown(window, {
      key: "ArrowUp",
      altKey: true,
      shiftKey: true,
    });
    expect(
      editorRef.current?.getDocument().elements.map((element) => element.y),
    ).toEqual([30, 30]);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(
      editorRef.current?.getDocument().elements.map((element) => element.y),
    ).toEqual([30, 100]);
  });

  it("disables alignment for a selection that is one group", async () => {
    const first = createElement("rectangle", {
      id: "aligned-group-first",
      x: 20,
      y: 30,
      width: 80,
      height: 40,
      groupIds: ["aligned-group"],
    });
    const second = createElement("ellipse", {
      id: "aligned-group-second",
      x: 140,
      y: 50,
      width: 40,
      height: 50,
      groupIds: ["aligned-group"],
    });
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [first, second] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    expect(screen.getByRole("menuitem", { name: /Align left/ })).toBeDisabled();
  });

  it("distributes a multi-selection with the actions menu and keyboard", async () => {
    const first = createElement("rectangle", {
      id: "distribution-first",
      x: 20,
      y: 20,
      width: 20,
      height: 20,
    });
    const second = createElement("ellipse", {
      id: "distribution-second",
      x: 200,
      y: 200,
      width: 40,
      height: 30,
    });
    const third = createElement("diamond", {
      id: "distribution-third",
      x: 500,
      y: 500,
      width: 60,
      height: 40,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{
          ...blankDrawing(),
          elements: [first, second, third],
        }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Distribute horizontally/ }),
    );

    expect(
      editorRef.current?.getDocument().elements.map((element) => element.x),
    ).toEqual([20, 250, 500]);

    fireEvent.keyDown(window, {
      key: "y",
      altKey: true,
      shiftKey: true,
    });
    expect(
      editorRef.current?.getDocument().elements.map((element) => element.y),
    ).toEqual([20, 255, 500]);
  });

  it("disables distribution when the selection has only two logical groups", async () => {
    const elements = [
      createElement("rectangle", {
        id: "distribution-group-a-first",
        x: 20,
        y: 20,
        width: 20,
        height: 20,
        groupIds: ["distribution-group-a"],
      }),
      createElement("ellipse", {
        id: "distribution-group-a-second",
        x: 60,
        y: 20,
        width: 20,
        height: 20,
        groupIds: ["distribution-group-a"],
      }),
      createElement("diamond", {
        id: "distribution-group-b-first",
        x: 200,
        y: 20,
        width: 20,
        height: 20,
        groupIds: ["distribution-group-b"],
      }),
      createElement("rectangle", {
        id: "distribution-group-b-second",
        x: 240,
        y: 20,
        width: 20,
        height: 20,
        groupIds: ["distribution-group-b"],
      }),
    ];
    render(<DrawingEditor initialDocument={{ ...blankDrawing(), elements }} />);

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    expect(
      screen.getByRole("menuitem", { name: /Distribute horizontally/ }),
    ).toBeDisabled();
  });

  it("orthogonalizes a selected connector from the actions menu with undo and redo", async () => {
    const arrow = createLinear("arrow", { x: 20, y: 20 }, { x: 140, y: 80 });
    const editorRef = createRef<DrawingEditorHandle>();
    const onDocumentChange = vi.fn();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [arrow] }}
        onDocumentChange={onDocumentChange}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    const action = screen.getByRole("menuitem", {
      name: /Orthogonalize connector/,
    });
    expect(action).not.toBeDisabled();
    await userEvent.click(action);

    expect(editorRef.current?.getDocument().elements[0]).toMatchObject({
      points: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 60 },
      ],
    });
    expect(editorRef.current?.isDirty()).toBe(true);
    expect(onDocumentChange).toHaveBeenLastCalledWith(
      expect.anything(),
      "Orthogonalize connector",
    );

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(
      (editorRef.current?.getDocument().elements[0] as LinearElement).points,
    ).toEqual(arrow.points);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(
      (editorRef.current?.getDocument().elements[0] as LinearElement).points,
    ).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 60 },
    ]);

    fireEvent.keyDown(window, {
      key: "o",
      altKey: true,
      shiftKey: true,
    });
    expect(onDocumentChange).toHaveBeenCalledTimes(3);
  });

  it("reverses a selected arrow direction without changing its path", async () => {
    const arrow = createLinear("arrow", { x: 20, y: 20 }, { x: 140, y: 80 });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [arrow] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Reverse connector direction/ }),
    );

    const reversed = editorRef.current?.getDocument()
      .elements[0] as LinearElement;
    expect(reversed.points).toEqual([
      { x: 120, y: 60 },
      { x: 0, y: 0 },
    ]);
    expect(reversed.startArrowhead).toBe("arrow");
    expect(reversed.endArrowhead).toBeNull();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(
      (editorRef.current?.getDocument().elements[0] as LinearElement).points,
    ).toEqual(arrow.points);
    fireEvent.keyDown(window, {
      key: "r",
      altKey: true,
      shiftKey: true,
    });
    expect(
      (editorRef.current?.getDocument().elements[0] as LinearElement).points,
    ).toEqual(reversed.points);
  });

  it("flips a selection around its shared bounds with undo and keyboard support", async () => {
    const first = createElement("rectangle", {
      id: "flip-first",
      x: 20,
      y: 20,
      width: 20,
      height: 20,
    });
    const second = createElement("ellipse", {
      id: "flip-second",
      x: 140,
      y: 100,
      width: 40,
      height: 40,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [first, second] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Flip horizontally/ }),
    );

    expect(editorRef.current?.getDocument().elements).toMatchObject([
      { id: first.id, x: 160, y: 20 },
      { id: second.id, x: 20, y: 100 },
    ]);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(editorRef.current?.getDocument().elements).toMatchObject([
      { id: first.id, x: 20, y: 20 },
      { id: second.id, x: 140, y: 100 },
    ]);

    fireEvent.keyDown(window, {
      key: "m",
      altKey: true,
      shiftKey: true,
    });
    expect(editorRef.current?.getDocument().elements).toMatchObject([
      { id: first.id, x: 20, y: 120 },
      { id: second.id, x: 140, y: 20 },
    ]);
  });

  it("resets rotation for a selection from the actions menu with undo", async () => {
    const first = createElement("rectangle", {
      id: "reset-rotation-first",
      x: 20,
      y: 30,
      width: 80,
      height: 40,
      angle: 30,
    });
    const second = createElement("ellipse", {
      id: "reset-rotation-second",
      x: 180,
      y: 60,
      width: 40,
      height: 40,
      angle: 315,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [first, second] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    const action = screen.getByRole("menuitem", { name: "Reset rotation" });
    expect(action).not.toBeDisabled();
    await userEvent.click(action);

    expect(editorRef.current?.getDocument().elements).toMatchObject([
      { id: first.id, angle: 0 },
      { id: second.id, angle: 0 },
    ]);
    expect(screen.getByText("Reset selection rotation")).toBeInTheDocument();

    act(() => editorRef.current?.undo());
    expect(editorRef.current?.getDocument().elements).toMatchObject([
      { id: first.id, angle: 30 },
      { id: second.id, angle: 315 },
    ]);
  });

  it("locks a selection with a shortcut and unlocks all from the actions menu", async () => {
    const shape = createElement("rectangle", {
      id: "lockable-shape",
      x: 20,
      y: 30,
      width: 80,
      height: 40,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [shape] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "l", ctrlKey: true, shiftKey: true });
    expect(editorRef.current?.getDocument().elements[0]).toMatchObject({
      id: shape.id,
      locked: true,
    });

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(
      editorRef.current?.getDocument().elements[0]?.locked,
    ).toBeUndefined();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(editorRef.current?.getDocument().elements[0]?.locked).toBe(true);

    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    const unlock = screen.getByRole("menuitem", { name: "Unlock all" });
    expect(unlock).not.toBeDisabled();
    await userEvent.click(unlock);
    expect(editorRef.current?.getDocument().elements[0]).toMatchObject({
      id: shape.id,
      locked: false,
    });
  });

  it("exports only the expanded selection from the actions menu", async () => {
    const first = createElement("rectangle", {
      id: "export-selection-first",
      x: 20,
      y: 30,
      width: 80,
      height: 40,
    });
    const second = createElement("ellipse", {
      id: "export-selection-second",
      x: 180,
      y: 60,
      width: 40,
      height: 50,
      groupIds: ["export-selection-group"],
    });
    const groupMember = createElement("diamond", {
      id: "export-selection-group-member",
      x: 240,
      y: 60,
      width: 30,
      height: 30,
      groupIds: ["export-selection-group"],
    });
    const outside = createElement("rectangle", {
      id: "export-selection-outside",
      x: 400,
      y: 60,
      width: 40,
      height: 40,
    });
    vi.mocked(exportDrawing).mockClear();
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test-selection");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(
      <DrawingEditor
        initialDocument={{
          ...blankDrawing(),
          elements: [first, second, groupMember, outside],
        }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    dispatchPointer(canvas, "pointerdown", 520, 140, 1, true);
    dispatchPointer(canvas, "pointerup", 520, 140, 1, true);
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Download selection PNG" }),
    );
    await waitFor(() => expect(exportDrawing).toHaveBeenCalled());

    const [exported, , options] = vi.mocked(exportDrawing).mock.calls.at(-1)!;
    expect(exported.elements.map((element) => element.id)).toEqual([
      first.id,
      second.id,
      groupMember.id,
    ]);
    expect(options).toMatchObject({ format: "png", bounds: "content" });

    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Export selection JSON" }),
    );
    await waitFor(() => expect(exportDrawing).toHaveBeenCalledTimes(2));

    const [jsonSelection, , jsonOptions] = vi
      .mocked(exportDrawing)
      .mock.calls.at(-1)!;
    expect(jsonSelection.elements.map((element) => element.id)).toEqual([
      first.id,
      second.id,
      groupMember.id,
    ]);
    expect(jsonOptions).toMatchObject({ format: "json", bounds: "content" });
    createObjectUrl.mockRestore();
    click.mockRestore();
  });

  it("copies a selection as an image without creating a history change", async () => {
    const shape = createElement("rectangle", {
      id: "copy-selection-shape",
      x: 20,
      y: 30,
      width: 80,
      height: 40,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    const clipboardWrite = vi.fn(async () => undefined);
    const previousClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const previousClipboardItem = Object.getOwnPropertyDescriptor(
      globalThis,
      "ClipboardItem",
    );
    class TestClipboardItem {
      constructor(readonly items: Record<string, unknown>) {}
    }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: clipboardWrite },
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: TestClipboardItem,
    });
    try {
      render(
        <DrawingEditor
          ref={editorRef}
          initialDocument={{ ...blankDrawing(), elements: [shape] }}
        />,
      );
      fireEvent.keyDown(window, { key: "a", ctrlKey: true });
      await userEvent.click(
        screen.getByRole("button", { name: "More whiteboard actions" }),
      );
      await userEvent.click(
        screen.getByRole("menuitem", { name: "Copy selection as image" }),
      );
      await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
      expect(editorRef.current?.isDirty()).toBe(false);
      expect(screen.getByText("Copied selection as image")).toBeInTheDocument();
    } finally {
      if (previousClipboard)
        Object.defineProperty(navigator, "clipboard", previousClipboard);
      else
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: undefined,
        });
      if (previousClipboardItem)
        Object.defineProperty(
          globalThis,
          "ClipboardItem",
          previousClipboardItem,
        );
      else
        Object.defineProperty(globalThis, "ClipboardItem", {
          configurable: true,
          value: undefined,
        });
    }
  });

  it("selects and moves every member when clicking a grouped element", () => {
    const first = createElement("rectangle", {
      id: "group-first",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
      groupIds: ["group"],
    });
    const second = createElement("ellipse", {
      id: "group-second",
      x: 160,
      y: 40,
      width: 80,
      height: 50,
      groupIds: ["group"],
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [first, second] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 140, 140);
    expect(screen.getAllByText("2 selected").length).toBeGreaterThan(0);
    dispatchPointer(canvas, "pointermove", 160, 160);
    dispatchPointer(canvas, "pointerup", 160, 160);

    const moved = editorRef.current?.getDocument().elements;
    expect(moved?.find((element) => element.id === first.id)).toMatchObject({
      x: 40,
      y: 50,
    });
    expect(moved?.find((element) => element.id === second.id)).toMatchObject({
      x: 180,
      y: 60,
    });
  });

  it("supports grouping and ungrouping with undoable keyboard commands", () => {
    const first = createElement("rectangle", {
      id: "group-first",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
    });
    const second = createElement("ellipse", {
      id: "group-second",
      x: 160,
      y: 40,
      width: 80,
      height: 50,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [first, second] }}
      />,
    );
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });

    const grouped = editorRef.current?.getDocument().elements;
    expect(grouped?.every((element) => element.groupIds?.length === 1)).toBe(
      true,
    );

    fireEvent.keyDown(window, { key: "g", ctrlKey: true, shiftKey: true });
    const ungrouped = editorRef.current?.getDocument().elements;
    expect(ungrouped?.every((element) => !element.groupIds?.length)).toBe(true);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(
      editorRef.current
        ?.getDocument()
        .elements.every((element) => element.groupIds?.length === 1),
    ).toBe(true);
  });

  it("duplicates and deletes a selection from the actions menu", async () => {
    const shape = createElement("rectangle", {
      id: "menu-duplicate-shape",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [shape] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Duplicate selection/ }),
    );
    expect(editorRef.current?.getDocument().elements).toHaveLength(2);
    expect(screen.getByText("Duplicated 1 element")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Delete selection/ }),
    );
    expect(editorRef.current?.getDocument().elements).toMatchObject([
      { id: shape.id, isDeleted: false },
      { isDeleted: true },
    ]);
    expect(screen.getByText("Deleted selection")).toBeInTheDocument();

    act(() => editorRef.current?.undo());
    expect(editorRef.current?.getDocument().elements).toMatchObject([
      { id: shape.id, isDeleted: false },
      { isDeleted: false },
    ]);
  });

  it("selects every live unlocked element from the actions menu", async () => {
    const selectable = createElement("rectangle", {
      id: "menu-selectable-shape",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
    });
    const locked = createElement("ellipse", {
      id: "menu-locked-shape",
      locked: true,
    });
    const deleted = createElement("diamond", {
      id: "menu-deleted-shape",
      isDeleted: true,
    });
    const onPresenceChange = vi.fn();
    render(
      <DrawingEditor
        initialDocument={{
          ...blankDrawing(),
          elements: [selectable, locked, deleted],
        }}
        onPresenceChange={onPresenceChange}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    const selectAll = screen.getByRole("menuitem", { name: /Select all/ });
    expect(selectAll).not.toBeDisabled();
    await userEvent.click(selectAll);

    expect(screen.getByText("Selected 1 element")).toBeInTheDocument();
    expect(onPresenceChange).toHaveBeenLastCalledWith({
      cursor: null,
      selection: [selectable.id],
    });

    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Clear selection/ }),
    );
    expect(screen.getByText("Cleared selection")).toBeInTheDocument();
    expect(onPresenceChange).toHaveBeenLastCalledWith({
      cursor: null,
      selection: [],
    });
  });

  it("copies and pastes a selection from the actions menu", async () => {
    const shape = createElement("rectangle", {
      id: "menu-copy-shape",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [shape] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Copy selection ⌘C/ }),
    );
    expect(screen.getByText("Copied selection")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Paste selection ⌘V/ }),
    );
    await waitFor(() =>
      expect(editorRef.current?.getDocument().elements).toHaveLength(2),
    );
    expect(editorRef.current?.getDocument().elements[1]).toMatchObject({
      x: 44,
      y: 54,
    });
    expect(editorRef.current?.getDocument().elements[1]?.id).not.toBe(shape.id);
  });

  it("pastes a copied selection in place from the actions menu", async () => {
    const shape = createElement("rectangle", {
      id: "menu-paste-place-shape",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [shape] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Copy selection ⌘C/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Paste in place ⌘⇧V/ }),
    );

    await waitFor(() =>
      expect(editorRef.current?.getDocument().elements).toHaveLength(2),
    );
    expect(editorRef.current?.getDocument().elements[1]).toMatchObject({
      x: shape.x,
      y: shape.y,
    });
    expect(editorRef.current?.getDocument().elements[1]?.id).not.toBe(shape.id);
    expect(screen.getByText("Pasted 1 element in place")).toBeInTheDocument();
  });

  it("transfers referenced image metadata through the system clipboard", async () => {
    const image = createElement("image", {
      id: "clipboard-image",
      fileId: "asset-clipboard",
      x: 20,
      y: 30,
      width: 120,
      height: 80,
    });
    const file = {
      id: "asset-clipboard",
      mime: "image/png",
      name: "clipboard.png",
      url: "https://cdn.test/clipboard.png",
      width: 1200,
      height: 800,
    };
    const previousClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    let clipboardText = "";
    const writeText = vi.fn(async (value: string) => {
      clipboardText = value;
    });
    const readText = vi.fn(async () => clipboardText);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText, readText },
    });
    try {
      const source = render(
        <DrawingEditor
          initialDocument={{
            ...blankDrawing(),
            elements: [image],
            files: { [file.id]: file },
          }}
        />,
      );
      fireEvent.keyDown(window, { key: "a", ctrlKey: true });
      fireEvent.keyDown(window, { key: "c", ctrlKey: true });
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(clipboardText).toMatch(/^doory-drawing:v2:/);
      source.unmount();

      const editorRef = createRef<DrawingEditorHandle>();
      render(
        <DrawingEditor ref={editorRef} initialDocument={blankDrawing()} />,
      );
      fireEvent.keyDown(window, { key: "v", ctrlKey: true });

      await waitFor(() =>
        expect(editorRef.current?.getDocument().elements).toHaveLength(1),
      );
      const pasted = editorRef.current?.getDocument();
      expect(pasted?.elements[0]).toMatchObject({
        type: "image",
        fileId: file.id,
      });
      expect(pasted?.files).toEqual({ [file.id]: file });
      expect(readText).toHaveBeenCalledTimes(1);
    } finally {
      if (previousClipboard) {
        Object.defineProperty(navigator, "clipboard", previousClipboard);
      } else {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: undefined,
        });
      }
    }
  });

  it("remaps colliding image file ids without touching unrelated files", async () => {
    const image = createElement("image", {
      id: "clipboard-collision-image",
      fileId: "asset-collision",
      x: 20,
      y: 30,
      width: 120,
      height: 80,
    });
    const sourceFile = {
      id: "asset-collision",
      mime: "image/png",
      name: "source.png",
      url: "https://cdn.test/source.png",
    };
    const previousClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    let clipboardText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async (value: string) => {
          clipboardText = value;
        }),
        readText: vi.fn(async () => clipboardText),
      },
    });
    try {
      const source = render(
        <DrawingEditor
          initialDocument={{
            ...blankDrawing(),
            elements: [image],
            files: { [sourceFile.id]: sourceFile },
          }}
        />,
      );
      fireEvent.keyDown(window, { key: "a", ctrlKey: true });
      fireEvent.keyDown(window, { key: "c", ctrlKey: true });
      await waitFor(() => expect(clipboardText).toMatch(/^doory-drawing:v2:/));
      source.unmount();

      const existing = {
        id: "asset-collision",
        mime: "image/jpeg",
        name: "existing.jpg",
        url: "https://cdn.test/existing.jpg",
      };
      const unrelated = {
        id: "asset-keep",
        mime: "image/png",
        name: "keep.png",
        url: "https://cdn.test/keep.png",
      };
      const editorRef = createRef<DrawingEditorHandle>();
      render(
        <DrawingEditor
          ref={editorRef}
          initialDocument={{
            ...blankDrawing(),
            files: { [existing.id]: existing, [unrelated.id]: unrelated },
          }}
        />,
      );
      fireEvent.keyDown(window, { key: "v", ctrlKey: true });

      await waitFor(() =>
        expect(editorRef.current?.getDocument().elements).toHaveLength(1),
      );
      const pasted = editorRef.current?.getDocument();
      const pastedImage = pasted?.elements[0];
      expect(pastedImage?.type).toBe("image");
      if (pastedImage?.type !== "image") return;
      expect(pastedImage.fileId).not.toBe(existing.id);
      expect(pasted?.files?.[existing.id]).toEqual(existing);
      expect(pasted?.files?.[unrelated.id]).toEqual(unrelated);
      expect(pasted?.files?.[pastedImage.fileId]).toMatchObject({
        ...sourceFile,
        id: pastedImage.fileId,
      });
    } finally {
      if (previousClipboard) {
        Object.defineProperty(navigator, "clipboard", previousClipboard);
      } else {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: undefined,
        });
      }
    }
  });

  it("accepts legacy element-only clipboard payloads", async () => {
    const image = createElement("image", {
      id: "legacy-clipboard-image",
      fileId: "missing-asset",
      width: 120,
      height: 80,
    });
    const previousClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn(
          async () => "doory-drawing:v1:" + JSON.stringify([image]),
        ),
      },
    });
    try {
      const editorRef = createRef<DrawingEditorHandle>();
      render(
        <DrawingEditor ref={editorRef} initialDocument={blankDrawing()} />,
      );
      fireEvent.keyDown(window, { key: "v", ctrlKey: true });

      await waitFor(() =>
        expect(editorRef.current?.getDocument().elements).toHaveLength(1),
      );
      expect(editorRef.current?.getDocument().elements[0]).toMatchObject({
        type: "image",
        fileId: "missing-asset",
      });
      expect(editorRef.current?.getDocument().files).toBeUndefined();
    } finally {
      if (previousClipboard) {
        Object.defineProperty(navigator, "clipboard", previousClipboard);
      } else {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: undefined,
        });
      }
    }
  });

  it("pastes an image from the system clipboard when no drawing payload exists", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    const clipboardBlob = new Blob(["clipboard image"], { type: "image/png" });
    const onUploadImage = vi.fn(async (file: File) => {
      expect(file.name).toBe("pasted-image.png");
      expect(file.type).toBe("image/png");
      return {
        id: "clipboard-uploaded-image",
        mime: "image/png",
        name: file.name,
        url: "https://cdn.test/clipboard-uploaded.png",
        width: 800,
        height: 400,
      };
    });
    const previousClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const readText = vi.fn(async () => "plain text");
    const getType = vi.fn(async () => clipboardBlob);
    const read = vi.fn(async () => [{ types: ["image/png"], getType }]);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText, read },
    });
    try {
      render(
        <DrawingEditor
          ref={editorRef}
          initialDocument={blankDrawing()}
          onUploadImage={onUploadImage}
        />,
      );
      fireEvent.keyDown(window, { key: "v", ctrlKey: true });

      await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
      expect(readText).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(1);
      expect(getType).toHaveBeenCalledWith("image/png");
      expect(editorRef.current?.getDocument()).toMatchObject({
        elements: [
          expect.objectContaining({
            type: "image",
            fileId: "clipboard-uploaded-image",
            width: 360,
            height: 180,
          }),
        ],
        files: {
          "clipboard-uploaded-image": expect.objectContaining({
            name: "pasted-image.png",
          }),
        },
      });
    } finally {
      if (previousClipboard) {
        Object.defineProperty(navigator, "clipboard", previousClipboard);
      } else {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: undefined,
        });
      }
    }
  });

  it("prefers a system clipboard image over stale internal clipboard data", async () => {
    const shape = createElement("rectangle", {
      id: "stale-clipboard-shape",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    const clipboardBlob = new Blob(["external image"], { type: "image/png" });
    const onUploadImage = vi.fn(async (file: File) => ({
      id: "external-clipboard-image",
      mime: file.type,
      name: file.name,
      url: "https://cdn.test/external-clipboard.png",
      width: 400,
      height: 200,
    }));
    const previousClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const readText = vi.fn(async () => "plain text");
    const read = vi.fn(async () => [
      { types: ["image/png"], getType: async () => clipboardBlob },
    ]);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
        readText,
        read,
      },
    });
    try {
      render(
        <DrawingEditor
          ref={editorRef}
          initialDocument={{ ...blankDrawing(), elements: [shape] }}
          onUploadImage={onUploadImage}
        />,
      );
      fireEvent.keyDown(window, { key: "a", ctrlKey: true });
      fireEvent.keyDown(window, { key: "c", ctrlKey: true });
      fireEvent.keyDown(window, { key: "v", ctrlKey: true });

      await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
      expect(editorRef.current?.getDocument().elements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: shape.id, type: "rectangle" }),
          expect.objectContaining({
            type: "image",
            fileId: "external-clipboard-image",
          }),
        ]),
      );
      expect(readText).toHaveBeenCalled();
      expect(read).toHaveBeenCalled();
    } finally {
      if (previousClipboard) {
        Object.defineProperty(navigator, "clipboard", previousClipboard);
      } else {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: undefined,
        });
      }
    }
  });

  it("does not paste stale internal data over plain system clipboard text", async () => {
    const shape = createElement("rectangle", {
      id: "plain-clipboard-shape",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    const previousClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
        readText: vi.fn(async () => "plain text from another app"),
      },
    });
    try {
      render(
        <DrawingEditor
          ref={editorRef}
          initialDocument={{ ...blankDrawing(), elements: [shape] }}
        />,
      );
      fireEvent.keyDown(window, { key: "a", ctrlKey: true });
      fireEvent.keyDown(window, { key: "c", ctrlKey: true });
      fireEvent.keyDown(window, { key: "v", ctrlKey: true });

      await waitFor(() =>
        expect(screen.getByText("No drawing in clipboard")).toBeInTheDocument(),
      );
      expect(editorRef.current?.getDocument().elements).toHaveLength(1);
    } finally {
      if (previousClipboard) {
        Object.defineProperty(navigator, "clipboard", previousClipboard);
      } else {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: undefined,
        });
      }
    }
  });

  it("cuts a selection from the actions menu and restores it with undo", async () => {
    const shape = createElement("rectangle", {
      id: "menu-cut-shape",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [shape] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Cut selection ⌘X/ }),
    );

    expect(editorRef.current?.getDocument().elements).toMatchObject([
      { id: shape.id, isDeleted: true },
    ]);
    expect(screen.getByText("Cut selection")).toBeInTheDocument();

    act(() => editorRef.current?.undo());
    expect(editorRef.current?.getDocument().elements).toMatchObject([
      { id: shape.id, isDeleted: false },
    ]);
  });

  it("closes an open actions menu without clearing the selection", async () => {
    const shape = createElement("rectangle", {
      id: "menu-escape-shape",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
    });
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [shape] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    expect(
      screen.getByRole("menu", { name: "Whiteboard actions" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(
      screen.queryByRole("menu", { name: "Whiteboard actions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rotate selection" }),
    ).toBeInTheDocument();
  });

  it("changes the board background from the actions menu", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    render(<DrawingEditor ref={editorRef} initialDocument={blankDrawing()} />);

    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    fireEvent.change(screen.getByLabelText("Background color picker"), {
      target: { value: "#f8fafc" },
    });

    expect(editorRef.current?.getDocument().background).toBe("#f8fafc");
    expect(screen.getByText("Changed board background")).toBeInTheDocument();

    act(() => editorRef.current?.undo());
    expect(editorRef.current?.getDocument().background).toBe("#ffffff");
  });

  it("undoes and redoes a change from the actions menu", async () => {
    const shape = createElement("rectangle", {
      id: "menu-history-shape",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    const changes: DrawingDocument[] = [];
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [shape] }}
        onDocumentChange={(document) => changes.push(document)}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(editorRef.current?.getDocument().elements[0]?.x).toBe(21);
    const moved = changes.at(-1);
    expect(moved?.elements[0]).toMatchObject({ x: 21, version: 2 });

    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /Undo ⌘Z/ }));
    expect(editorRef.current?.getDocument().elements[0]?.x).toBe(20);
    const undone = changes.at(-1);
    expect(undone?.elements[0]).toMatchObject({ x: 20, version: 3 });
    if (moved && undone)
      expect(mergeDrawingDocuments(moved, undone).elements[0]).toMatchObject({
        x: 20,
        version: 3,
      });

    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /Redo ⌘⇧Z/ }));
    expect(editorRef.current?.getDocument().elements[0]?.x).toBe(21);
    const redone = changes.at(-1);
    expect(redone?.elements[0]).toMatchObject({ x: 21, version: 4 });
    if (undone && redone)
      expect(mergeDrawingDocuments(undone, redone).elements[0]).toMatchObject({
        x: 21,
        version: 4,
      });
  });

  it("arranges a selection with bracket shortcuts", () => {
    const first = createElement("rectangle", {
      id: "layer-first",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
    });
    const second = createElement("ellipse", {
      id: "layer-second",
      x: 160,
      y: 40,
      width: 80,
      height: 50,
    });
    const third = createElement("diamond", {
      id: "layer-third",
      x: 300,
      y: 50,
      width: 80,
      height: 50,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{
          ...blankDrawing(),
          elements: [first, second, third],
        }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 320, 145);
    fireEvent.keyDown(window, {
      key: "]",
      code: "BracketRight",
      ctrlKey: true,
    });
    expect(
      editorRef.current?.getDocument().elements.map((element) => element.id),
    ).toEqual(["layer-first", "layer-third", "layer-second"]);
    fireEvent.keyDown(window, {
      key: "]",
      code: "BracketRight",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(
      editorRef.current?.getDocument().elements.map((element) => element.id),
    ).toEqual(["layer-first", "layer-third", "layer-second"]);
  });

  it("imports a validated source JSON document from the actions menu", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    const imported = createElement("rectangle", {
      id: "imported-shape",
      x: 40,
      y: 50,
      width: 120,
      height: 80,
    });
    const { container } = render(
      <DrawingEditor ref={editorRef} initialDocument={blankDrawing()} />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "More whiteboard actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Import source JSON" }),
    );
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, {
      target: {
        files: [
          new File(
            [JSON.stringify({ ...blankDrawing(), elements: [imported] })],
            "board.json",
            { type: "application/json" },
          ),
        ],
      },
    });

    await waitFor(() =>
      expect(editorRef.current?.getDocument().elements).toEqual([
        expect.objectContaining({ id: "imported-shape" }),
      ]),
    );
  });

  it("keeps the rotate handle inside the canvas when the selection is above the viewport", () => {
    const rectangle = createElement("rectangle", {
      id: "top-edge-shape",
      x: 20,
      y: -200,
      width: 100,
      height: 60,
    });
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 320,
        height: 240,
        right: 320,
        bottom: 240,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 140, -120);

    const handle = screen.getByRole("button", { name: "Rotate selection" });
    expect(Number.parseFloat(handle.style.top)).toBeGreaterThanOrEqual(14);
    expect(Number.parseFloat(handle.style.top)).toBeLessThanOrEqual(226);
  });

  it("repositions the rotate handle after the canvas is resized", () => {
    const callbacks: ResizeObserverCallback[] = [];
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }

      observe(): void {}

      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    try {
      const rectangle = createElement("rectangle", {
        id: "resize-handle-shape",
        x: 20,
        y: -120,
        width: 100,
        height: 60,
      });
      render(
        <DrawingEditor
          initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
        />,
      );
      const canvas = screen.getByRole("application", {
        name: "Whiteboard canvas",
      });
      configureContextCanvas(canvas, 320, 240);
      Object.defineProperty(canvas, "setPointerCapture", {
        configurable: true,
        value: vi.fn(),
      });
      dispatchPointer(canvas, "pointerdown", 140, -40);

      const handle = screen.getByRole("button", { name: "Rotate selection" });
      configureContextCanvas(canvas, 80, 60);
      act(() => {
        callbacks[0]?.([], {} as ResizeObserver);
      });

      expect(Number.parseFloat(handle.style.left)).toBeGreaterThanOrEqual(14);
      expect(Number.parseFloat(handle.style.left)).toBeLessThanOrEqual(66);
      expect(Number.parseFloat(handle.style.top)).toBeGreaterThanOrEqual(14);
      expect(Number.parseFloat(handle.style.top)).toBeLessThanOrEqual(46);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows editable endpoint handles for a selected connector", () => {
    const arrow = createLinear("arrow", { x: 20, y: 30 }, { x: 120, y: 90 });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [arrow] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 190, 140);

    expect(
      screen.getAllByRole("button", { name: /Connector endpoint/ }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /Resize selection/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Rotate selection" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add connector point 1" }),
    ).toBeInTheDocument();

    const add = screen.getByRole("button", { name: "Add connector point 1" });
    fireEvent.keyDown(add, { key: "Enter" });
    expect(
      screen.getByRole("button", { name: "Move connector point 1" }),
    ).toBeInTheDocument();
    const movedPoint = screen.getByRole("button", {
      name: "Move connector point 1",
    });
    const before = editorRef.current
      ?.getDocument()
      .elements.find((element) => element.id === arrow.id);
    fireEvent.keyDown(movedPoint, { key: "ArrowRight" });
    const after = editorRef.current
      ?.getDocument()
      .elements.find((element) => element.id === arrow.id);
    if (
      !before ||
      !after ||
      (before.type !== "arrow" && before.type !== "line") ||
      (after.type !== "arrow" && after.type !== "line")
    )
      throw new Error("connector missing");
    expect(after.points[1]?.x).toBe((before.points[1]?.x ?? 0) + 1);

    fireEvent.keyDown(movedPoint, { key: "Delete" });
    expect(
      editorRef.current
        ?.getDocument()
        .elements.some((element) => element.id === arrow.id),
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Move connector point 1" }),
    ).toBeNull();
  });

  it("applies inspector colors to a selection", () => {
    const rectangle = createElement("rectangle", {
      id: "styled-shape",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 170, 140);
    fireEvent.change(screen.getByLabelText("Stroke color"), {
      target: { value: "#2563eb" },
    });
    fireEvent.change(screen.getByLabelText("Fill color"), {
      target: { value: "#dbeafe" },
    });

    const styled = editorRef.current?.getDocument().elements[0];
    expect(styled?.style).toMatchObject({
      stroke: "#2563eb",
      fill: "#dbeafe",
    });
  });

  it("sets a precise selection rotation from the inspector with undo", () => {
    const rectangle = createElement("rectangle", {
      id: "inspector-rotation",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    dispatchPointer(canvas, "pointerdown", 170, 140);
    fireEvent.change(screen.getByLabelText("Rotation"), {
      target: { value: "37" },
    });

    expect(editorRef.current?.getDocument().elements[0]?.angle).toBe(37);
    expect(screen.getByText("Rotated selection to 37°")).toBeInTheDocument();

    act(() => editorRef.current?.undo());
    expect(editorRef.current?.getDocument().elements[0]?.angle).toBe(0);
  });

  it("updates text font size and color from the floating inspector", () => {
    const text = createElement("text", {
      id: "styled-text",
      x: 20,
      y: 30,
      width: 100,
      height: 40,
      text: "Text",
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [text] }}
      />,
    );
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    dispatchPointer(canvas, "pointerdown", 170, 140);
    fireEvent.change(screen.getByLabelText("Text color"), {
      target: { value: "#be123c" },
    });
    fireEvent.change(screen.getByLabelText("Size"), {
      target: { value: "32" },
    });

    const styled = editorRef.current?.getDocument().elements[0];
    expect(styled?.style).toMatchObject({ stroke: "#be123c", fontSize: 32 });
  });

  it("selects all canvas elements and pastes a fresh copy", () => {
    const rectangle = createElement("rectangle", {
      id: "shape",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [rectangle] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });

    const elements = editorRef.current?.getDocument().elements ?? [];
    expect(elements).toHaveLength(2);
    expect(elements[1]).toMatchObject({ x: 44, y: 54 });
    expect(elements[1]?.id).not.toBe(rectangle.id);
  });

  it("copies and pastes visual style as one undoable change", () => {
    const source = createElement("rectangle", {
      id: "style-source",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
      style: {
        ...DEFAULT_STYLE,
        stroke: "#e11d48",
        fill: "#fee2e2",
        strokeWidth: 4,
        strokeStyle: "dashed",
      },
    });
    const target = createElement("ellipse", {
      id: "style-target",
      x: 180,
      y: 30,
      width: 80,
      height: 50,
      style: {
        ...DEFAULT_STYLE,
        stroke: "#2563eb",
        fill: "#dbeafe",
        strokeWidth: 1,
      },
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [source, target] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, {
      key: "c",
      altKey: true,
      shiftKey: true,
    });
    fireEvent.keyDown(window, {
      key: "p",
      altKey: true,
      shiftKey: true,
    });

    const pastedTarget = editorRef.current?.getDocument().elements[1];
    expect(pastedTarget?.style).toEqual(source.style);
    expect(editorRef.current?.isDirty()).toBe(true);
    expect(screen.getByText("Pasted visual style")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(editorRef.current?.getDocument().elements[1]?.style).toEqual(
      target.style,
    );
  });

  it("copies arrowheads with an arrow visual style", () => {
    const source = createLinear("arrow", { x: 20, y: 30 }, { x: 120, y: 30 });
    source.startArrowhead = "triangle";
    source.endArrowhead = "arrow";
    const target = createLinear("arrow", { x: 180, y: 30 }, { x: 280, y: 30 });
    target.startArrowhead = null;
    target.endArrowhead = null;
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [source, target] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, {
      key: "c",
      altKey: true,
      shiftKey: true,
    });
    fireEvent.keyDown(window, {
      key: "p",
      altKey: true,
      shiftKey: true,
    });

    expect(editorRef.current?.getDocument().elements[1]).toMatchObject({
      startArrowhead: "triangle",
      endArrowhead: "arrow",
    });
  });

  it("resets selected visual style with undo support", () => {
    const shape = createElement("rectangle", {
      id: "reset-style-shape",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
      style: {
        ...DEFAULT_STYLE,
        stroke: "#7c3aed",
        fill: "#ede9fe",
        strokeWidth: 6,
      },
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [shape] }}
      />,
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, {
      key: "0",
      altKey: true,
      shiftKey: true,
    });

    expect(editorRef.current?.getDocument().elements[0]?.style).toEqual(
      DEFAULT_STYLE,
    );
    expect(screen.getByText("Reset visual style")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(editorRef.current?.getDocument().elements[0]?.style).toEqual(
      shape.style,
    );
  });

  it("renders collaborator cursors as labeled pointer icons", () => {
    render(
      <DrawingEditor
        initialDocument={blankDrawing()}
        remotePeers={[
          {
            id: "ada",
            name: "Ada",
            cursor: { x: 40, y: 50 },
            selection: [],
            color: "#c2410c",
          },
          {
            id: "bo",
            name: "Bo",
            cursor: { x: 100, y: 120 },
            selection: [],
            color: "#6d28d9",
          },
        ]}
      />,
    );

    const cursors = screen.getAllByTestId("remote-cursor");
    expect(cursors).toHaveLength(2);
    expect(cursors[0]).toHaveTextContent("Ada");
    expect(cursors[0].querySelector("svg")).toBeInTheDocument();
    expect(cursors[0]).toHaveStyle({ color: "#c2410c" });
    expect(cursors[1]).toHaveTextContent("Bo");
    expect(cursors[1]).toHaveStyle({ color: "#6d28d9" });
  });

  it("keeps the note editor open after placing a note", async () => {
    const editorRef = createRef<DrawingEditorHandle>();
    render(<DrawingEditor ref={editorRef} initialDocument={blankDrawing()} />);

    await userEvent.click(screen.getByRole("button", { name: /Note/ }));
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    const setPointerCapture = vi.fn();
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: setPointerCapture,
    });
    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 180,
      clientY: 140,
    });
    Object.defineProperty(pointerDown, "pointerId", { value: 1 });

    act(() => {
      canvas.dispatchEvent(pointerDown);
    });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Edit text" })).toBeVisible(),
    );
    expect(screen.getByRole("textbox", { name: "Edit text" })).toHaveFocus();
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(screen.getByRole("textbox", { name: "Edit text" })).toHaveValue(
      "New note",
    );
    expect(setPointerCapture).toHaveBeenCalledWith(1);

    fireEvent.change(screen.getByRole("textbox", { name: "Edit text" }), {
      target: { value: "A working note ".repeat(80) },
    });
    expect(screen.getByRole("textbox", { name: "Edit text" })).toHaveValue(
      "A working note ".repeat(80),
    );
    expect(
      editorRef.current?.getDocument().elements[0]?.height,
    ).toBeGreaterThan(128);
  });

  it("keeps the text editor open after placing text", async () => {
    render(<DrawingEditor initialDocument={blankDrawing()} />);

    await userEvent.click(screen.getByRole("button", { name: /Text/ }));
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    const setPointerCapture = vi.fn();
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: setPointerCapture,
    });
    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 180,
      clientY: 140,
    });
    Object.defineProperty(pointerDown, "pointerId", { value: 1 });

    act(() => {
      canvas.dispatchEvent(pointerDown);
    });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Edit text" })).toBeVisible(),
    );
    expect(screen.getByRole("textbox", { name: "Edit text" })).toHaveFocus();
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(screen.getByRole("textbox", { name: "Edit text" })).toHaveValue("");
    expect(setPointerCapture).toHaveBeenCalledWith(1);

    const textbox = screen.getByRole("textbox", { name: "Edit text" });
    fireEvent.change(textbox, { target: { value: "awd" } });
    expect(textbox).toHaveValue("awd");
    expect(textbox.style.width).not.toBe("120px");
  });

  it("commits typed text when the editor loses focus", async () => {
    const changes: DrawingDocument[] = [];
    render(
      <DrawingEditor
        initialDocument={blankDrawing()}
        onDocumentChange={(document) => changes.push(document)}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Text/ }));
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 180,
      clientY: 140,
    });
    Object.defineProperty(pointerDown, "pointerId", { value: 1 });
    act(() => canvas.dispatchEvent(pointerDown));

    const textbox = await screen.findByRole("textbox", { name: "Edit text" });
    fireEvent.change(textbox, { target: { value: "Saved text" } });
    fireEvent.blur(textbox);

    await waitFor(() =>
      expect(changes.at(-1)?.elements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "text", text: "Saved text" }),
        ]),
      ),
    );
  });

  it("opens an existing text element for editing on double click", async () => {
    const text = createElement("text", {
      id: "existing-text",
      x: 300,
      y: 220,
      width: 240,
      height: 40,
      text: "Existing text",
    });
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [text] }}
      />,
    );

    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    fireEvent.doubleClick(canvas, { clientX: 420, clientY: 300 });

    expect(
      await screen.findByRole("textbox", { name: "Edit text" }),
    ).toHaveValue("Existing text");
  });

  it("cancels an edit without deleting the existing text", async () => {
    const text = createElement("text", {
      id: "existing-text",
      x: 300,
      y: 220,
      width: 240,
      height: 40,
      text: "Existing text",
    });
    const changes: DrawingDocument[] = [];
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [text] }}
        onDocumentChange={(document) => changes.push(document)}
      />,
    );

    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    fireEvent.doubleClick(canvas, { clientX: 420, clientY: 300 });
    const textbox = await screen.findByRole("textbox", { name: "Edit text" });
    fireEvent.change(textbox, { target: { value: "Changed text" } });
    fireEvent.keyDown(textbox, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(changes.at(-1)?.elements).toEqual([
      expect.objectContaining({ id: "existing-text", text: "Existing text" }),
    ]);
  });

  it("publishes Escape cancellation as a newer collaborative text version", async () => {
    const text = createElement("text", {
      id: "escape-versioned-text",
      x: 300,
      y: 220,
      width: 240,
      height: 40,
      text: "Original text",
    }) as TextElement;
    const changes: DrawingDocument[] = [];
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [text] }}
        onDocumentChange={(document) => changes.push(document)}
      />,
    );

    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    fireEvent.doubleClick(canvas, { clientX: 420, clientY: 300 });
    const textbox = await screen.findByRole("textbox", { name: "Edit text" });
    fireEvent.change(textbox, { target: { value: "Published draft" } });
    const draft = changes.at(-1);
    fireEvent.keyDown(textbox, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    const cancelled = changes.at(-1);
    expect(draft).toBeDefined();
    expect(cancelled).toBeDefined();
    if (!draft || !cancelled) return;
    const draftElement = draft.elements.find(
      (element) => element.id === text.id,
    );
    const cancelledElement = cancelled.elements.find(
      (element) => element.id === text.id,
    );
    expect(cancelledElement).toMatchObject({ text: "Original text" });
    expect(cancelledElement?.version).toBeGreaterThan(
      draftElement?.version ?? 0,
    );
    expect(
      mergeDrawingDocuments(draft, cancelled).elements.find(
        (element) => element.id === text.id,
      ),
    ).toMatchObject({ text: "Original text" });
    act(() => editorRef.current?.redo());
    expect(
      editorRef.current
        ?.getDocument()
        .elements.find((element) => element.id === text.id),
    ).toMatchObject({ text: "Original text" });
  });

  it("keeps a text draft open across an unrelated remote update and cancels safely", async () => {
    const text = createElement("text", {
      id: "remote-text-draft",
      x: 300,
      y: 220,
      width: 240,
      height: 40,
      text: "Original text",
    }) as TextElement;
    const remoteShape = createElement("ellipse", {
      id: "remote-shape",
      x: 40,
      y: 60,
      width: 80,
      height: 60,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [text] }}
      />,
    );

    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    fireEvent.doubleClick(canvas, { clientX: 420, clientY: 300 });
    const textbox = await screen.findByRole("textbox", { name: "Edit text" });
    fireEvent.change(textbox, { target: { value: "Local draft" } });

    act(() => {
      editorRef.current?.applyRemoteDocument({
        ...blankDrawing(),
        elements: [{ ...text, text: "Local draft" }, remoteShape],
      });
    });

    expect(textbox).toHaveValue("Local draft");
    fireEvent.keyDown(textbox, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(editorRef.current?.getDocument().elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: text.id, text: "Original text" }),
        expect.objectContaining({ id: remoteShape.id }),
      ]),
    );
  });

  it("uses a same-element remote text change as the cancel baseline", async () => {
    const text = createElement("text", {
      id: "remote-text-conflict",
      x: 300,
      y: 220,
      width: 240,
      height: 40,
      text: "Original text",
    }) as TextElement;
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [text] }}
      />,
    );

    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    fireEvent.doubleClick(canvas, { clientX: 420, clientY: 300 });
    const textbox = await screen.findByRole("textbox", { name: "Edit text" });
    fireEvent.change(textbox, { target: { value: "Local draft" } });

    act(() => {
      editorRef.current?.applyRemoteDocument({
        ...blankDrawing(),
        elements: [{ ...text, text: "Collaborator text", version: 5 }],
      });
    });

    expect(textbox).toHaveValue("Local draft");
    fireEvent.keyDown(textbox, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(editorRef.current?.getDocument().elements).toEqual([
      expect.objectContaining({ id: text.id, text: "Collaborator text" }),
    ]);
  });

  it("keeps the original cancel baseline after typing again following a remote update", async () => {
    const text = createElement("text", {
      id: "remote-text-continued",
      x: 300,
      y: 220,
      width: 240,
      height: 40,
      text: "Original text",
    }) as TextElement;
    const remoteShape = createElement("ellipse", {
      id: "remote-continued-shape",
      x: 40,
      y: 60,
      width: 80,
      height: 60,
    });
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [text] }}
      />,
    );

    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    fireEvent.doubleClick(canvas, { clientX: 420, clientY: 300 });
    const textbox = await screen.findByRole("textbox", { name: "Edit text" });
    fireEvent.change(textbox, { target: { value: "Local draft" } });
    act(() =>
      editorRef.current?.applyRemoteDocument({
        ...blankDrawing(),
        elements: [{ ...text, text: "Local draft" }, remoteShape],
      }),
    );
    fireEvent.change(textbox, { target: { value: "Local draft plus" } });
    fireEvent.keyDown(textbox, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(editorRef.current?.getDocument().elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: text.id, text: "Original text" }),
        expect.objectContaining({ id: remoteShape.id }),
      ]),
    );
  });

  it("updates the cancel baseline when a newer remote element keeps the draft text", async () => {
    const text = createElement("text", {
      id: "remote-text-same-value",
      x: 300,
      y: 220,
      width: 240,
      height: 40,
      text: "Original text",
    }) as TextElement;
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [text] }}
      />,
    );

    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    fireEvent.doubleClick(canvas, { clientX: 420, clientY: 300 });
    const textbox = await screen.findByRole("textbox", { name: "Edit text" });
    fireEvent.change(textbox, { target: { value: "Local draft" } });
    act(() =>
      editorRef.current?.applyRemoteDocument({
        ...blankDrawing(),
        elements: [{ ...text, text: "Local draft", version: 5 }],
      }),
    );
    fireEvent.keyDown(textbox, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(editorRef.current?.getDocument().elements).toEqual([
      expect.objectContaining({ id: text.id, text: "Local draft", version: 5 }),
    ]);
  });

  it("closes text editing when a collaborator deletes the active element", async () => {
    const text = createElement("text", {
      id: "deleted-remote-text",
      x: 300,
      y: 220,
      width: 240,
      height: 40,
      text: "To be deleted",
    }) as TextElement;
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [text] }}
      />,
    );

    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    fireEvent.doubleClick(canvas, { clientX: 420, clientY: 300 });
    await screen.findByRole("textbox", { name: "Edit text" });

    act(() => editorRef.current?.applyRemoteDocument(blankDrawing()));

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(editorRef.current?.getDocument().elements).toEqual([]);
  });

  it("preserves live selection and prunes deleted selections on remote updates", () => {
    const selected = createElement("rectangle", {
      id: "remote-selected",
      x: 20,
      y: 30,
      width: 80,
      height: 50,
    });
    const remote = createElement("ellipse", {
      id: "remote-kept",
      x: 180,
      y: 30,
      width: 80,
      height: 50,
    });
    const presence: Array<{
      cursor: { x: number; y: number } | null;
      selection: string[];
    }> = [];
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [selected] }}
        onPresenceChange={(value) => presence.push(value)}
      />,
    );

    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
      }),
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 180, 150);
    expect(presence.at(-1)?.selection).toEqual([selected.id]);

    act(() =>
      editorRef.current?.applyRemoteDocument({
        ...blankDrawing(),
        elements: [selected, remote],
      }),
    );
    expect(presence.at(-1)?.selection).toEqual([selected.id]);

    act(() =>
      editorRef.current?.applyRemoteDocument({
        ...blankDrawing(),
        elements: [remote],
      }),
    );
    expect(presence.at(-1)?.selection).toEqual([]);
  });

  it("erases every element crossed by a drag that starts on blank canvas", async () => {
    const first = createElement("rectangle", {
      id: "first",
      x: 100,
      y: 100,
      width: 40,
      height: 40,
    });
    const second = createElement("text", {
      id: "second",
      x: 220,
      y: 100,
      width: 80,
      height: 40,
      text: "Second",
    });
    const changes: DrawingDocument[] = [];
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [first, second] }}
        onDocumentChange={(document) => changes.push(document)}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Eraser/ }));
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 140, 100);
    dispatchPointer(canvas, "pointermove", 220, 180);
    dispatchPointer(canvas, "pointermove", 340, 180);
    dispatchPointer(canvas, "pointerup", 340, 180);

    await waitFor(() => expect(changes).toHaveLength(1));
    expect(changes[0].elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "first", isDeleted: true }),
        expect.objectContaining({ id: "second", isDeleted: true }),
      ]),
    );
  });

  it("cancels an in-progress erase before it reaches save", async () => {
    const first = createElement("rectangle", {
      id: "first",
      x: 100,
      y: 100,
      width: 40,
      height: 40,
    });
    const saved: DrawingDocument[] = [];
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [first] }}
        onSaveNow={async (document) => {
          saved.push(document);
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Eraser/ }));
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 140, 100);
    dispatchPointer(canvas, "pointermove", 220, 180);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].elements).toEqual([
      expect.objectContaining({ id: "first", isDeleted: false }),
    ]);
  });

  it("does not commit an erase on pointer cancellation", async () => {
    const first = createElement("rectangle", {
      id: "first",
      x: 100,
      y: 100,
      width: 40,
      height: 40,
    });
    const changes: DrawingDocument[] = [];
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [first] }}
        onDocumentChange={(document) => changes.push(document)}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Eraser/ }));
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 140, 100);
    dispatchPointer(canvas, "pointermove", 220, 180);
    act(() => {
      fireEvent.pointerCancel(canvas, { pointerId: 1 });
    });

    expect(changes).toHaveLength(0);
  });

  it("cancels an active erase before applying a remote document", async () => {
    const first = createElement("rectangle", {
      id: "first",
      x: 100,
      y: 100,
      width: 40,
      height: 40,
    });
    const remote = createElement("ellipse", {
      id: "remote",
      x: 300,
      y: 100,
      width: 40,
      height: 40,
    });
    const changes: DrawingDocument[] = [];
    const editorRef = createRef<DrawingEditorHandle>();
    render(
      <DrawingEditor
        ref={editorRef}
        initialDocument={{ ...blankDrawing(), elements: [first] }}
        onDocumentChange={(document) => changes.push(document)}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Eraser/ }));
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 140, 100);
    dispatchPointer(canvas, "pointermove", 220, 180);
    act(() => {
      editorRef.current?.applyRemoteDocument({
        ...blankDrawing(),
        elements: [remote],
      });
    });
    dispatchPointer(canvas, "pointerup", 340, 180);

    expect(changes).toHaveLength(0);
  });

  it("ignores a second pointer until the active gesture ends", async () => {
    const first = createElement("rectangle", {
      id: "first",
      x: 100,
      y: 100,
      width: 40,
      height: 40,
    });
    const changes: DrawingDocument[] = [];
    render(
      <DrawingEditor
        initialDocument={{ ...blankDrawing(), elements: [first] }}
        onDocumentChange={(document) => changes.push(document)}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Eraser/ }));
    const canvas = screen.getByRole("application", {
      name: "Whiteboard canvas",
    });
    Object.defineProperty(canvas, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(canvas, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(canvas, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    dispatchPointer(canvas, "pointerdown", 140, 100, 1);
    dispatchPointer(canvas, "pointermove", 220, 180, 2);
    dispatchPointer(canvas, "pointerup", 340, 180, 2);
    expect(changes).toHaveLength(0);

    dispatchPointer(canvas, "pointermove", 220, 180, 1);
    dispatchPointer(canvas, "pointerup", 340, 180, 1);
    await waitFor(() => expect(changes).toHaveLength(1));
  });
});
