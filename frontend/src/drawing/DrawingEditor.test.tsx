import {
  act,
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
import { blankDrawing, createElement, type DrawingDocument } from "./model";

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
    type: "pointerdown" | "pointermove" | "pointerup",
    clientX: number,
    clientY: number,
    pointerId = 1,
  ): void {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY,
    });
    Object.defineProperty(event, "pointerId", { value: pointerId });
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
    render(<DrawingEditor initialDocument={blankDrawing()} />);

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
      target: { value: "A working note" },
    });
    expect(screen.getByRole("textbox", { name: "Edit text" })).toHaveValue(
      "A working note",
    );
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

    fireEvent.change(screen.getByRole("textbox", { name: "Edit text" }), {
      target: { value: "A working text" },
    });
    expect(screen.getByRole("textbox", { name: "Edit text" })).toHaveValue(
      "A working text",
    );
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
