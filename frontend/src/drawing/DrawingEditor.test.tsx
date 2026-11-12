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
import { createLinear } from "./scene";

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
    shiftKey = false,
  ): void {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY,
      shiftKey,
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

  it("returns to the starting zoom after one zoom in and out", async () => {
    render(<DrawingEditor initialDocument={blankDrawing()} />);

    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
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
