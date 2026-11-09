import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronDown,
  Circle,
  Diamond,
  Download,
  Eraser,
  Grid3x3,
  Hand,
  Maximize2,
  Menu,
  Minus,
  MoveRight,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  StickyNote,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button, Dialog, Input } from "@/ui";
import {
  documentBounds,
  elementBounds,
  elementsHitBySegment,
  elementsInRect,
  hitTestScene,
  normalizeRect,
  screenToWorld,
  selectionBounds,
  textBounds,
  translateElement,
  viewportAtPoint,
  worldToScreen,
  type Point,
  type Rect,
} from "./geometry";
import { DrawingHistory } from "./history";
import {
  createFreedraw,
  createLinear,
  createNote,
  createShape,
  createText,
  deleteElements,
  duplicateElements,
  groupElements,
  updateElements,
} from "./scene";
import { exportDrawing, renderDrawing } from "./renderer";
import {
  DRAWING_NOTE_DEFAULT_TEXT,
  DRAWING_NOTE_PADDING,
  restoreDrawing,
  versionNonce,
  type DrawingDocument,
  type DrawingElement,
  type DrawingExportOptions,
  type DrawingTool,
  type DrawingViewport,
  type TextElement,
} from "./model";
import styles from "./DrawingEditor.module.css";

export interface DrawingEditorHandle {
  getDocument(): DrawingDocument;
  replaceDocument(document: DrawingDocument): void;
  applyRemoteDocument(document: DrawingDocument): void;
  undo(): void;
  redo(): void;
  saveNow(): Promise<void>;
  isDirty(): boolean;
  export(options: DrawingExportOptions): Promise<Blob>;
}

export interface DrawingEditorProps {
  initialDocument: DrawingDocument;
  readOnly?: boolean;
  onDocumentChange?: (document: DrawingDocument, label: string) => void;
  onPresenceChange?: (presence: {
    cursor: Point | null;
    selection: string[];
  }) => void;
  remotePeers?: ReadonlyArray<{
    id: string;
    name?: string;
    cursor: Point | null;
    selection: string[];
    color?: string;
  }>;
  onSaveStateChange?: (dirty: boolean) => void;
  onSaveNow?: (document: DrawingDocument) => Promise<void>;
  onSaveToAccount?: () => void | Promise<void>;
  onTitleChange?: (title: string) => void | Promise<void>;
  title?: string;
}

type DrawTool = Extract<
  DrawingTool,
  "rectangle" | "ellipse" | "diamond" | "line" | "arrow" | "freedraw"
>;
type TextEditing = {
  id: string;
  value: string;
  isNew: boolean;
  wasDirty: boolean;
  changed: boolean;
};
type Interaction =
  | { kind: "pan"; pointerId: number; last: Point }
  | { kind: "lasso"; pointerId: number; start: Point; current: Point }
  | {
      kind: "drag";
      pointerId: number;
      start: Point;
      current: Point;
      document: DrawingDocument;
      ids: ReadonlySet<string>;
    }
  | {
      kind: "erase";
      pointerId: number;
      document: DrawingDocument;
      ids: Set<string>;
      points: Point[];
    }
  | {
      kind: "draw";
      pointerId: number;
      start: Point;
      points: Point[];
      tool: DrawTool;
    };

const TOOL_LABELS: Array<{
  tool: DrawingTool;
  label: string;
  icon: typeof MousePointer2;
  shortcut: string;
}> = [
  { tool: "select", label: "Select", icon: MousePointer2, shortcut: "V" },
  { tool: "hand", label: "Pan", icon: Hand, shortcut: "H" },
  { tool: "rectangle", label: "Rectangle", icon: Square, shortcut: "R" },
  { tool: "line", label: "Line", icon: Minus, shortcut: "L" },
  { tool: "arrow", label: "Arrow", icon: MoveRight, shortcut: "A" },
  { tool: "freedraw", label: "Draw", icon: Pencil, shortcut: "P" },
  { tool: "text", label: "Text", icon: Type, shortcut: "T" },
  { tool: "note", label: "Note", icon: StickyNote, shortcut: "N" },
  { tool: "eraser", label: "Eraser", icon: Eraser, shortcut: "E" },
];

const TOOL_KEYS: Record<string, DrawingTool> = {
  v: "select",
  h: "hand",
  r: "rectangle",
  o: "ellipse",
  d: "diamond",
  l: "line",
  a: "arrow",
  p: "freedraw",
  t: "text",
  n: "note",
  e: "eraser",
};

const SHAPE_LABELS: Record<
  "rectangle" | "ellipse" | "diamond",
  { label: string; icon: typeof Square; shortcut: string }
> = {
  rectangle: { label: "Rectangle", icon: Square, shortcut: "R" },
  ellipse: { label: "Ellipse", icon: Circle, shortcut: "O" },
  diamond: { label: "Diamond", icon: Diamond, shortcut: "D" },
};

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function translateDocument(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
): DrawingDocument {
  return updateElements(document, ids, (element) =>
    translateElement(element, dx, dy),
  );
}

function movement(
  event: Pick<ReactPointerEvent<HTMLCanvasElement>, "clientX" | "clientY">,
  rect: DOMRect,
  viewport: DrawingViewport,
): Point {
  return screenToWorld(
    { x: event.clientX - rect.left, y: event.clientY - rect.top },
    viewport,
  );
}

function keyFor(event: KeyboardEvent): string {
  return event.key.toLowerCase();
}

const ERASER_TRAIL_MAX_DISTANCE = 120;

export function trimEraserTrail(
  points: readonly Point[],
  maxDistance: number,
): Point[] {
  let first = points.length - 1;
  let distance = 0;
  while (first > 0) {
    const current = points[first];
    const previous = points[first - 1];
    const segment = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (distance + segment > maxDistance) break;
    distance += segment;
    first -= 1;
  }
  return points.slice(Math.max(0, first));
}

function updateTextElement(element: TextElement, text: string): TextElement {
  const next = { ...element, text };
  if (element.customData?.variant === "note") return next;
  const bounds = textBounds(next);
  return { ...next, width: bounds.width, height: bounds.height };
}

export const DrawingEditor = forwardRef<
  DrawingEditorHandle,
  DrawingEditorProps
>(function DrawingEditor(
  {
    initialDocument,
    readOnly = false,
    onDocumentChange,
    onPresenceChange,
    remotePeers = [],
    onSaveStateChange,
    onSaveNow,
    onSaveToAccount,
    onTitleChange,
    title = "Untitled whiteboard",
  },
  ref,
) {
  const initial = useMemo(
    () => restoreDrawing(initialDocument),
    [initialDocument],
  );
  const [document, setDocument] = useState<DrawingDocument>(initial);
  const documentRef = useRef(document);
  const historyRef = useRef(new DrawingHistory(initial));
  const [tool, setTool] = useState<DrawingTool>("select");
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [eraserTargets, setEraserTargets] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [eraserTrail, setEraserTrail] = useState<readonly Point[]>([]);
  const [viewport, setViewport] = useState<DrawingViewport>({
    zoom: 1,
    scrollX: -120,
    scrollY: -80,
  });
  const [preview, setPreview] = useState<DrawingDocument | null>(null);
  const [draft, setDraft] = useState<DrawingElement | null>(null);
  const [lasso, setLasso] = useState<Rect | null>(null);
  const [editing, setEditing] = useState<TextEditing | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const spacePressedRef = useRef(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const shapeMenuRef = useRef<HTMLDivElement>(null);
  const shown = preview ?? document;

  useEffect(() => {
    if (!renameOpen) setTitleDraft(title);
  }, [renameOpen, title]);

  const markChange = useCallback(
    (next: DrawingDocument, label: string, coalesceKey?: string): void => {
      documentRef.current = next;
      historyRef.current.push(next, label, coalesceKey);
      setDocument(next);
      setPreview(null);
      setDirty(true);
      onSaveStateChange?.(true);
      onDocumentChange?.(next, label);
    },
    [onDocumentChange, onSaveStateChange],
  );

  function setPreviewDocument(next: DrawingDocument): void {
    setPreview(next);
  }

  const cancelInteraction = useCallback((pointerId?: number): void => {
    const interaction = interactionRef.current;
    if (
      interaction &&
      pointerId !== undefined &&
      interaction.pointerId !== pointerId
    )
      return;
    const canvas = canvasRef.current;
    if (interaction && canvas?.hasPointerCapture(interaction.pointerId))
      canvas.releasePointerCapture(interaction.pointerId);
    interactionRef.current = null;
    setPreview(null);
    setDraft(null);
    setLasso(null);
    setEraserTargets(new Set());
    setEraserTrail([]);
    setIsPanning(false);
  }, []);

  const resetTo = useCallback(
    (next: DrawingDocument): void => {
      documentRef.current = next;
      setDocument(next);
      setPreview(null);
      setDraft(null);
      setDirty(true);
      onSaveStateChange?.(true);
      onDocumentChange?.(next, "Edit drawing");
    },
    [onDocumentChange, onSaveStateChange],
  );

  const undo = useCallback((): void => {
    if (readOnly) return;
    const next = historyRef.current.undo();
    if (next) resetTo(next);
  }, [readOnly, resetTo]);

  const redo = useCallback((): void => {
    if (readOnly) return;
    const next = historyRef.current.redo();
    if (next) resetTo(next);
  }, [readOnly, resetTo]);

  const replaceDocument = useCallback(
    (next: DrawingDocument): void => {
      cancelInteraction();
      const restored = restoreDrawing(next);
      documentRef.current = restored;
      historyRef.current.clear(restored);
      setDocument(restored);
      setPreview(null);
      setDraft(null);
      setLasso(null);
      setEditing(null);
      setSelection(new Set());
      setEraserTargets(new Set());
      setEraserTrail([]);
      setDirty(false);
      onSaveStateChange?.(false);
    },
    [cancelInteraction, onSaveStateChange],
  );

  const applyRemoteDocument = useCallback(
    (next: DrawingDocument): void => {
      cancelInteraction();
      const restored = restoreDrawing(next);
      documentRef.current = restored;
      historyRef.current.clear(restored);
      setDocument(restored);
      setPreview(null);
      setDraft(null);
      setLasso(null);
      setSelection(new Set());
      setEraserTargets(new Set());
      setEraserTrail([]);
      setDirty(false);
      onSaveStateChange?.(false);
    },
    [cancelInteraction, onSaveStateChange],
  );

  const saveNow = useCallback(async (): Promise<void> => {
    await onSaveNow?.(documentRef.current);
    setDirty(false);
    onSaveStateChange?.(false);
  }, [onSaveNow, onSaveStateChange]);

  const exportAs = useCallback(
    async (format: "json" | "png" | "svg"): Promise<void> => {
      const blob = await exportDrawing(documentRef.current, viewport, {
        format,
        bounds: "content",
        padding: 40,
        scale: 2,
      });
      download(
        blob,
        (title || "drawing") +
          "." +
          (format === "json" ? "doory-drawing.json" : format),
      );
    },
    [title, viewport],
  );

  useImperativeHandle(
    ref,
    () => ({
      getDocument: () => documentRef.current,
      replaceDocument,
      applyRemoteDocument,
      undo,
      redo,
      saveNow,
      isDirty: () => dirty,
      export: (options) =>
        exportDrawing(documentRef.current, viewport, options),
    }),
    [
      applyRemoteDocument,
      dirty,
      redo,
      replaceDocument,
      saveNow,
      undo,
      viewport,
    ],
  );

  useLayoutEffect(() => {
    const node = textRef.current;
    if (node) {
      node.focus();
      node.select();
    }
  }, [editing?.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell) return undefined;
    const draw = () =>
      renderDrawing(canvas, shown, viewport, {
        selection,
        eraserTargets,
        eraserTrail,
        draft,
        showGrid,
      });
    const observer = new ResizeObserver(draw);
    observer.observe(shell);
    draw();
    return () => observer.disconnect();
  }, [shown, viewport, selection, eraserTargets, eraserTrail, draft, showGrid]);

  useEffect(() => {
    if (tool !== "eraser") {
      setEraserTargets((current) => (current.size === 0 ? current : new Set()));
      setEraserTrail((current) => (current.length === 0 ? current : []));
    }
  }, [tool]);

  const beginTextEditing = useCallback(
    (element: TextElement): void => {
      if (readOnly) return;
      setSelection(new Set([element.id]));
      setEditing({
        id: element.id,
        value:
          element.text ||
          (element.customData?.variant === "note"
            ? DRAWING_NOTE_DEFAULT_TEXT
            : ""),
        isNew: false,
        wasDirty: dirty,
        changed: false,
      });
      setTool("select");
    },
    [dirty, readOnly],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (editing) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!spacePressedRef.current) {
          spacePressedRef.current = true;
          setSpacePressed(true);
        }
        return;
      }
      const key = keyFor(event);
      if (event.key === "Enter" && selection.size === 1 && !readOnly) {
        const selected = documentRef.current.elements.find(
          (element): element is TextElement =>
            selection.has(element.id) && element.type === "text",
        );
        if (selected) {
          event.preventDefault();
          beginTextEditing(selected);
          return;
        }
      }
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        if (readOnly) return;
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "y") {
        if (readOnly) return;
        event.preventDefault();
        redo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "s") {
        event.preventDefault();
        void saveNow();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "e") {
        event.preventDefault();
        void exportAs("png");
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        key === "d" &&
        selection.size > 0 &&
        !readOnly
      ) {
        event.preventDefault();
        const result = duplicateElements(documentRef.current, selection);
        markChange(result.document, "Duplicate selection");
        setSelection(new Set(result.ids));
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        key === "g" &&
        selection.size > 1 &&
        !readOnly
      ) {
        event.preventDefault();
        const result = groupElements(documentRef.current, selection);
        markChange(result.document, "Group selection");
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        selection.size > 0 &&
        !readOnly
      ) {
        event.preventDefault();
        markChange(
          deleteElements(documentRef.current, selection),
          "Delete selection",
        );
        setSelection(new Set());
        return;
      }
      if (key === "escape") {
        cancelInteraction();
        setSelection(new Set());
        return;
      }
      if (key === "0") {
        event.preventDefault();
        zoomToContent();
        return;
      }
      if (key === "+" || key === "=") {
        event.preventDefault();
        setViewport((value) =>
          viewportAtPoint(value, { x: 0, y: 0 }, value.zoom * 1.1),
        );
        return;
      }
      if (key === "-") {
        event.preventDefault();
        setViewport((value) =>
          viewportAtPoint(value, { x: 0, y: 0 }, value.zoom * 0.9),
        );
        return;
      }
      const nextTool = TOOL_KEYS[key];
      if (nextTool && !event.metaKey && !event.ctrlKey) setTool(nextTool);
      if (
        selection.size > 0 &&
        ["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key) &&
        !readOnly
      ) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        const dx =
          key === "arrowleft" ? -amount : key === "arrowright" ? amount : 0;
        const dy =
          key === "arrowup" ? -amount : key === "arrowdown" ? amount : 0;
        markChange(
          translateDocument(documentRef.current, selection, dx, dy),
          "Move selection",
          "nudge",
        );
      }
    };
    const releaseSpace = () => {
      spacePressedRef.current = false;
      setSpacePressed(false);
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", releaseSpace);
    window.addEventListener("blur", releaseSpace);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", releaseSpace);
      window.removeEventListener("blur", releaseSpace);
    };
  }, [
    beginTextEditing,
    cancelInteraction,
    editing,
    exportAs,
    markChange,
    readOnly,
    redo,
    saveNow,
    selection,
    undo,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        setViewport((value) =>
          viewportAtPoint(
            value,
            { x: event.clientX - rect.left, y: event.clientY - rect.top },
            value.zoom * (event.deltaY > 0 ? 0.9 : 1.1),
          ),
        );
      } else {
        setViewport((value) => ({
          ...value,
          scrollX: value.scrollX + event.deltaX / value.zoom,
          scrollY: value.scrollY + event.deltaY / value.zoom,
        }));
      }
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, []);

  useEffect(() => {
    if (!menuOpen && !shapeMenuOpen) return undefined;
    const closeMenus = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!menuRef.current?.contains(target)) setMenuOpen(false);
      if (!shapeMenuRef.current?.contains(target)) setShapeMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setShapeMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeMenus);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenus);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen, shapeMenuOpen]);

  async function saveTitle(): Promise<void> {
    const nextTitle =
      titleDraft.trim().replace(/\s+/g, " ").slice(0, 200) ||
      "Untitled whiteboard";
    if (!onTitleChange) {
      setRenameOpen(false);
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      await onTitleChange(nextTitle);
      setRenameOpen(false);
    } catch {
      setRenameError("Could not rename this whiteboard yet.");
    } finally {
      setRenameBusy(false);
    }
  }

  function finishText(commit: boolean): void {
    if (!editing) return;
    const current = documentRef.current.elements.find(
      (element): element is TextElement =>
        element.id === editing.id && element.type === "text",
    );
    if (!current) {
      setEditing(null);
      return;
    }
    const value =
      editing.value.trim() === "" && current.customData?.variant === "note"
        ? current.text.trim() || DRAWING_NOTE_DEFAULT_TEXT
        : editing.value;
    if (!commit) {
      if (editing.isNew) {
        markChange(
          deleteElements(documentRef.current, new Set([editing.id])),
          "Cancel text",
        );
      } else if (editing.changed) {
        const restored = historyRef.current.undo();
        if (restored) {
          documentRef.current = restored;
          setDocument(restored);
          setPreview(null);
          setDirty(editing.wasDirty);
          onSaveStateChange?.(editing.wasDirty);
          onDocumentChange?.(restored, "Cancel text edit");
        }
      }
      setEditing(null);
      return;
    }
    if (value.trim() === "") {
      markChange(
        deleteElements(documentRef.current, new Set([editing.id])),
        "Delete empty text",
      );
    } else {
      const next = updateElements(
        documentRef.current,
        new Set([editing.id]),
        (element) =>
          element.type === "text"
            ? {
                ...updateTextElement(element, value),
                version: element.version + 1,
                versionNonce: element.versionNonce + 1,
              }
            : element,
      );
      markChange(next, "Edit text", "text:" + editing.id);
      historyRef.current.seal();
    }
    setEditing(null);
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (interactionRef.current) return;
    if (event.button !== 0 && event.button !== 1) return;
    const rect = canvas.getBoundingClientRect();
    const start = movement(event, rect, viewport);
    canvas.setPointerCapture(event.pointerId);
    if (spacePressedRef.current || tool === "hand" || event.button === 1) {
      interactionRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        last: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      };
      setIsPanning(true);
      return;
    }
    if (tool === "select") {
      const hit = hitTestScene(documentRef.current, start, 10 / viewport.zoom);
      if (hit) {
        const next = event.shiftKey
          ? new Set([...selection, hit.id])
          : selection.has(hit.id)
            ? selection
            : new Set([hit.id]);
        setSelection(next);
        onPresenceChange?.({ cursor: start, selection: [...next] });
        if (!readOnly)
          interactionRef.current = {
            kind: "drag",
            pointerId: event.pointerId,
            start,
            current: start,
            document: documentRef.current,
            ids: next,
          };
      } else {
        setSelection(new Set());
        onPresenceChange?.({ cursor: start, selection: [] });
        interactionRef.current = {
          kind: "lasso",
          pointerId: event.pointerId,
          start,
          current: start,
        };
      }
      return;
    }
    if (tool === "text") {
      if (readOnly) return;
      event.preventDefault();
      const text = createText(start.x, start.y);
      markChange(
        {
          ...documentRef.current,
          elements: [...documentRef.current.elements, text],
        },
        "Add text",
      );
      setSelection(new Set([text.id]));
      setEditing({
        id: text.id,
        value: "",
        isNew: true,
        wasDirty: true,
        changed: false,
      });
      setTool("select");
      return;
    }
    if (tool === "note") {
      if (readOnly) return;
      event.preventDefault();
      const note = createNote(start.x, start.y);
      markChange(
        {
          ...documentRef.current,
          elements: [...documentRef.current.elements, note],
        },
        "Add note",
      );
      setSelection(new Set([note.id]));
      setEditing({
        id: note.id,
        value: note.text,
        isNew: true,
        wasDirty: true,
        changed: false,
      });
      setTool("select");
      return;
    }
    if (tool === "eraser") {
      if (readOnly) return;
      const ids = new Set(
        elementsHitBySegment(
          documentRef.current,
          start,
          start,
          10 / viewport.zoom,
        ),
      );
      interactionRef.current = {
        kind: "erase",
        pointerId: event.pointerId,
        document: documentRef.current,
        ids,
        points: [start],
      };
      setSelection(new Set());
      setEraserTargets(ids);
      setEraserTrail([start]);
      if (ids.size > 0) {
        setPreviewDocument(deleteElements(documentRef.current, ids));
      }
      return;
    }
    if (readOnly) return;
    if (
      ["rectangle", "ellipse", "diamond", "line", "arrow", "freedraw"].includes(
        tool,
      )
    ) {
      interactionRef.current = {
        kind: "draw",
        pointerId: event.pointerId,
        start,
        points: [start],
        tool: tool as DrawTool,
      };
    }
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const current = movement(event, rect, viewport);
    const interaction = interactionRef.current;
    if (interaction && interaction.pointerId !== event.pointerId) return;
    onPresenceChange?.({ cursor: current, selection: [...selection] });
    if (!interaction) {
      if (tool === "eraser") {
        const ids = elementsHitBySegment(
          documentRef.current,
          current,
          current,
          10 / viewport.zoom,
        );
        setEraserTargets((previous) => {
          const next = new Set(ids);
          if (
            previous.size === next.size &&
            [...next].every((id) => previous.has(id))
          )
            return previous;
          return next;
        });
      }
      return;
    }
    if (interaction.kind === "pan") {
      const previous = interaction.last;
      const dx = (event.clientX - rect.left - previous.x) / viewport.zoom;
      const dy = (event.clientY - rect.top - previous.y) / viewport.zoom;
      interaction.last = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      setViewport((value) => ({
        ...value,
        scrollX: value.scrollX - dx,
        scrollY: value.scrollY - dy,
      }));
    } else if (interaction.kind === "lasso") {
      interaction.current = current;
      setLasso(normalizeRect(interaction.start, current));
    } else if (interaction.kind === "drag") {
      interaction.current = current;
      setPreviewDocument(
        translateDocument(
          interaction.document,
          interaction.ids,
          current.x - interaction.start.x,
          current.y - interaction.start.y,
        ),
      );
    } else if (interaction.kind === "erase") {
      const previous =
        interaction.points[interaction.points.length - 1] ?? current;
      interaction.points = trimEraserTrail(
        [...interaction.points, current],
        ERASER_TRAIL_MAX_DISTANCE / viewport.zoom,
      );
      setEraserTrail(interaction.points);
      const ids = elementsHitBySegment(
        interaction.document,
        previous,
        current,
        10 / viewport.zoom,
      );
      const before = interaction.ids.size;
      for (const id of ids) interaction.ids.add(id);
      if (interaction.ids.size !== before) {
        setEraserTargets(new Set(interaction.ids));
        setPreviewDocument(
          deleteElements(interaction.document, interaction.ids),
        );
      }
    } else {
      interaction.points.push(current);
      if (interaction.tool === "freedraw")
        setDraft(createFreedraw(interaction.points));
      else if (interaction.tool === "line" || interaction.tool === "arrow")
        setDraft(createLinear(interaction.tool, interaction.start, current));
      else setDraft(createShape(interaction.tool, interaction.start, current));
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    const interaction = interactionRef.current;
    if (interaction && interaction.pointerId !== event.pointerId) return;
    if (!canvas || !interaction) {
      if (canvas?.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      setEraserTargets((current) => (current.size === 0 ? current : new Set()));
      setEraserTrail((current) => (current.length === 0 ? current : []));
      return;
    }
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    interactionRef.current = null;
    setIsPanning(false);
    if (interaction.kind === "lasso") {
      const next = new Set(
        elementsInRect(
          documentRef.current,
          normalizeRect(interaction.start, interaction.current),
        ),
      );
      setSelection(next);
      onPresenceChange?.({
        cursor: movement(event, canvas.getBoundingClientRect(), viewport),
        selection: [...next],
      });
      setLasso(null);
    } else if (interaction.kind === "drag") {
      if (preview && preview !== interaction.document)
        markChange(preview, "Move selection", "drag");
      historyRef.current.seal();
      setPreview(null);
    } else if (interaction.kind === "erase") {
      if (interaction.ids.size > 0) {
        markChange(
          deleteElements(interaction.document, interaction.ids),
          "Erase selection",
        );
        setSelection(new Set());
      }
      setPreview(null);
      setEraserTargets(new Set());
      setEraserTrail([]);
    } else if (interaction.kind === "draw") {
      const current = draft;
      setDraft(null);
      if (
        current &&
        (current.type === "freedraw"
          ? current.points.length > 1
          : current.width > 3 || current.height > 3)
      ) {
        markChange(
          {
            ...documentRef.current,
            elements: [...documentRef.current.elements, current],
          },
          "Add " + interaction.tool,
        );
        setSelection(new Set([current.id]));
        onPresenceChange?.({
          cursor: movement(event, canvas.getBoundingClientRect(), viewport),
          selection: [current.id],
        });
      }
    }
  }

  function pointerCancel(event: ReactPointerEvent<HTMLCanvasElement>): void {
    cancelInteraction(event.pointerId);
  }

  function pointerLeave(): void {
    onPresenceChange?.({ cursor: null, selection: [...selection] });
    if (interactionRef.current?.kind !== "erase") {
      setEraserTargets((current) => (current.size === 0 ? current : new Set()));
      setEraserTrail((current) => (current.length === 0 ? current : []));
    }
  }

  function doubleClick(event: ReactMouseEvent<HTMLCanvasElement>): void {
    if (tool !== "select" || readOnly || editing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const hit = hitTestScene(
      documentRef.current,
      movement(event, canvas.getBoundingClientRect(), viewport),
      10 / viewport.zoom,
    );
    if (hit?.type !== "text") return;
    event.preventDefault();
    beginTextEditing(hit);
  }

  function zoomToContent(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = documentBounds(documentRef.current);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const zoom = Math.max(
      0.1,
      Math.min(
        4,
        Math.min(
          (width - 80) / Math.max(1, bounds.width),
          (height - 80) / Math.max(1, bounds.height),
        ),
      ),
    );
    setViewport({
      zoom,
      scrollX: bounds.x - (width / zoom - bounds.width) / 2,
      scrollY: bounds.y - (height / zoom - bounds.height) / 2,
    });
  }

  function editText(event: React.ChangeEvent<HTMLTextAreaElement>): void {
    if (!editing) return;
    const currentEditing = editing;
    setEditing({
      ...currentEditing,
      value: event.target.value,
      changed: true,
    });
    const next = updateElements(
      documentRef.current,
      new Set([currentEditing.id]),
      (element) =>
        element.type === "text"
          ? {
              ...updateTextElement(element, event.target.value),
              version: element.version + 1,
              versionNonce: versionNonce(),
            }
          : element,
    );
    documentRef.current = next;
    setDocument(next);
    historyRef.current.push(next, "Edit text", "text:" + currentEditing.id);
    setDirty(true);
    onSaveStateChange?.(true);
    onDocumentChange?.(next, "Edit text");
  }

  function textKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      finishText(false);
    }
  }

  const editingElement = editing
    ? documentRef.current.elements.find(
        (element): element is TextElement =>
          element.id === editing.id && element.type === "text",
      )
    : null;
  const editingBounds = editingElement ? elementBounds(editingElement) : null;
  const editingPadding =
    editingElement?.customData?.variant === "note" ? DRAWING_NOTE_PADDING : 0;
  const editingPosition = editingElement
    ? worldToScreen(
        {
          x: editingElement.x + editingPadding,
          y: editingElement.y + editingPadding,
        },
        viewport,
      )
    : null;
  const editingWidth = editingBounds
    ? Math.max(
        120,
        editingBounds.width -
          (editingElement?.customData?.variant === "note"
            ? editingPadding * 2
            : 0),
      )
    : 120;
  const editingHeight = editingBounds
    ? Math.max(
        40,
        editingBounds.height -
          (editingElement?.customData?.variant === "note"
            ? editingPadding * 2
            : 0),
      )
    : 40;
  const editingValue = editing?.value ?? "";
  const remoteOverlays = remotePeers.flatMap((peer) => {
    const color = peer.color ?? "#f97316";
    const bounds = selectionBounds(document, new Set(peer.selection));
    const overlays: Array<{
      kind: "selection" | "cursor";
      key: string;
      style: Record<string, string | number>;
      color: string;
      label?: string;
    }> = [];
    if (bounds) {
      const topLeft = worldToScreen({ x: bounds.x, y: bounds.y }, viewport);
      const bottomRight = worldToScreen(
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        viewport,
      );
      overlays.push({
        kind: "selection",
        key: peer.id + "-selection",
        color,
        style: {
          left: topLeft.x,
          top: topLeft.y,
          width: bottomRight.x - topLeft.x,
          height: bottomRight.y - topLeft.y,
        },
      });
    }
    if (peer.cursor) {
      const cursor = worldToScreen(peer.cursor, viewport);
      overlays.push({
        kind: "cursor",
        key: peer.id + "-cursor",
        color,
        label: peer.name || peer.id.slice(0, 6),
        style: { left: cursor.x, top: cursor.y },
      });
    }
    return overlays;
  });

  const activeShape =
    tool === "ellipse" || tool === "diamond" || tool === "rectangle"
      ? tool
      : "rectangle";
  const activeShapeDetails = SHAPE_LABELS[activeShape];
  const ActiveShapeIcon = activeShapeDetails.icon;

  return (
    <div
      className={styles.editor}
      ref={shellRef}
      data-space-pan={spacePressed ? "true" : "false"}
    >
      <header className={styles.toolbar}>
        <div className={styles.titleArea}>
          <div className={styles.menuWrap} ref={menuRef}>
            <button
              type="button"
              className={styles.moreButton}
              aria-label="More whiteboard actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-tooltip="More actions"
              onClick={() => {
                setMenuOpen((value) => !value);
                setShapeMenuOpen(false);
              }}
            >
              <Menu size={18} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div
                className={styles.moreMenu}
                role="menu"
                aria-label="Whiteboard actions"
              >
                {onTitleChange ? (
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      setTitleDraft(title);
                      setRenameError(null);
                      setRenameOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    <Pencil size={15} aria-hidden="true" />
                    <span>Rename</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={showGrid}
                  className={styles.menuItem}
                  onClick={() => {
                    setShowGrid((value) => !value);
                    setMenuOpen(false);
                  }}
                >
                  <Grid3x3 size={15} aria-hidden="true" />
                  <span>Grid</span>
                  <kbd>G</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    zoomToContent();
                    setMenuOpen(false);
                  }}
                >
                  <Maximize2 size={15} aria-hidden="true" />
                  <span>Fit to content</span>
                  <kbd>0</kbd>
                </button>
                <div className={styles.menuDivider} />
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    void exportAs("png");
                    setMenuOpen(false);
                  }}
                >
                  <Download size={15} aria-hidden="true" />
                  <span>Download PNG</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    void exportAs("svg");
                    setMenuOpen(false);
                  }}
                >
                  <Download size={15} aria-hidden="true" />
                  <span>Export SVG</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    void exportAs("json");
                    setMenuOpen(false);
                  }}
                >
                  <Menu size={15} aria-hidden="true" />
                  <span>Export source JSON</span>
                </button>
                {onSaveNow ? (
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    disabled={readOnly || !dirty}
                    onClick={() => {
                      void saveNow();
                      setMenuOpen(false);
                    }}
                  >
                    <Download size={15} aria-hidden="true" />
                    <span>Save changes</span>
                  </button>
                ) : null}
                {onSaveToAccount ? (
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    disabled={readOnly}
                    onClick={() => {
                      void onSaveToAccount();
                      setMenuOpen(false);
                    }}
                  >
                    <Pencil size={15} aria-hidden="true" />
                    <span>Save to account</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className={styles.title} title={title}>
            {title}
          </div>
        </div>
      </header>
      <div
        className={styles.toolGroup}
        role="toolbar"
        aria-label="Drawing tools"
      >
        {TOOL_LABELS.map(({ tool: item, label, icon: Icon, shortcut }) =>
          item === "rectangle" ? (
            <div key="shape" className={styles.shapeWrap} ref={shapeMenuRef}>
              <div className={styles.shapeControl}>
                <button
                  type="button"
                  className={styles.shapeButton}
                  title={
                    activeShapeDetails.label +
                    " (" +
                    activeShapeDetails.shortcut +
                    ")"
                  }
                  aria-label={
                    activeShapeDetails.label +
                    " (" +
                    activeShapeDetails.shortcut +
                    ")"
                  }
                  aria-pressed={
                    tool === "rectangle" ||
                    tool === "ellipse" ||
                    tool === "diamond"
                  }
                  data-tooltip={
                    activeShapeDetails.label +
                    " (" +
                    activeShapeDetails.shortcut +
                    ")"
                  }
                  onClick={() => setTool(activeShape)}
                >
                  <ActiveShapeIcon size={17} aria-hidden="true" />
                  <kbd className={styles.toolShortcut} aria-hidden="true">
                    {activeShapeDetails.shortcut}
                  </kbd>
                </button>
                <button
                  type="button"
                  className={styles.shapeDropdownButton}
                  aria-label="More shapes"
                  aria-haspopup="menu"
                  aria-expanded={shapeMenuOpen}
                  data-tooltip="More shapes"
                  onClick={() => {
                    setShapeMenuOpen((value) => !value);
                    setMenuOpen(false);
                  }}
                >
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
              </div>
              {shapeMenuOpen ? (
                <div
                  className={styles.shapeMenu}
                  role="menu"
                  aria-label="Shapes"
                >
                  {(
                    Object.entries(SHAPE_LABELS) as Array<
                      [
                        keyof typeof SHAPE_LABELS,
                        (typeof SHAPE_LABELS)[keyof typeof SHAPE_LABELS],
                      ]
                    >
                  ).map(([shape, details]) => {
                    const ShapeIcon = details.icon;
                    return (
                      <button
                        key={shape}
                        type="button"
                        role="menuitemradio"
                        aria-checked={tool === shape}
                        className={styles.menuItem}
                        onClick={() => {
                          setTool(shape);
                          setShapeMenuOpen(false);
                        }}
                      >
                        <ShapeIcon size={15} aria-hidden="true" />
                        <span>{details.label}</span>
                        <kbd>{details.shortcut}</kbd>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <button
              key={item}
              type="button"
              className={styles.toolButton}
              title={label + " (" + shortcut + ")"}
              aria-label={label + " (" + shortcut + ")"}
              aria-pressed={tool === item}
              data-tooltip={label + " (" + shortcut + ")"}
              onClick={() => setTool(item)}
            >
              <Icon size={17} aria-hidden="true" />
              <kbd className={styles.toolShortcut} aria-hidden="true">
                {shortcut}
              </kbd>
            </button>
          ),
        )}
      </div>
      <main className={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="application"
          aria-label="Whiteboard canvas"
          data-pan-mode={tool === "hand" || spacePressed ? "true" : "false"}
          data-pan-active={isPanning ? "true" : "false"}
          data-select-mode={tool === "select" ? "true" : "false"}
          data-tool={tool}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerLeave={pointerLeave}
          onPointerUp={pointerUp}
          onPointerCancel={pointerCancel}
          onDoubleClick={doubleClick}
        />
        {remoteOverlays.map((overlay) =>
          overlay.kind === "selection" ? (
            <div
              key={overlay.key}
              className={styles.remoteSelection}
              style={{ ...overlay.style, borderColor: overlay.color }}
            />
          ) : (
            <div
              key={overlay.key}
              className={styles.remoteCursor}
              data-testid="remote-cursor"
              style={{
                ...overlay.style,
                color: overlay.color,
              }}
            >
              <MousePointer2 size={20} strokeWidth={2.25} aria-hidden="true" />
              <span>{overlay.label}</span>
            </div>
          ),
        )}
        {lasso
          ? (() => {
              const topLeft = worldToScreen(
                { x: lasso.x, y: lasso.y },
                viewport,
              );
              const bottomRight = worldToScreen(
                { x: lasso.x + lasso.width, y: lasso.y + lasso.height },
                viewport,
              );
              return (
                <div
                  className={styles.lasso}
                  style={{
                    left: topLeft.x,
                    top: topLeft.y,
                    width: bottomRight.x - topLeft.x,
                    height: bottomRight.y - topLeft.y,
                  }}
                />
              );
            })()
          : null}
        {editingElement && editingPosition ? (
          <textarea
            ref={textRef}
            className={styles.textEditor}
            value={editingValue}
            onChange={editText}
            onBlur={() => finishText(true)}
            onKeyDown={textKeyDown}
            style={{
              left: editingPosition.x,
              top: editingPosition.y,
              width: editingWidth * viewport.zoom,
              minHeight: editingHeight * viewport.zoom,
              fontFamily: editingElement.style.fontFamily,
              fontSize: editingElement.style.fontSize * viewport.zoom,
              lineHeight: editingElement.style.lineHeight,
              background:
                editingElement.customData?.variant === "note"
                  ? editingElement.style.fill
                  : undefined,
              borderColor:
                editingElement.customData?.variant === "note"
                  ? editingElement.style.stroke
                  : undefined,
            }}
            data-note={
              editingElement.customData?.variant === "note" ? "true" : "false"
            }
            aria-label="Edit text"
          />
        ) : null}
      </main>
      <div className={styles.floatingZoom} aria-label="Zoom controls">
        <button
          type="button"
          className={styles.zoomButton}
          aria-label="Undo"
          data-tooltip="Undo (⌘/Ctrl+Z)"
          onClick={undo}
          disabled={readOnly || !historyRef.current.canUndo}
        >
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.zoomButton}
          aria-label="Redo"
          data-tooltip="Redo (⌘/Ctrl+Shift+Z)"
          onClick={redo}
          disabled={readOnly || !historyRef.current.canRedo}
        >
          <Redo2 size={16} aria-hidden="true" />
        </button>
        <span className={styles.zoomDivider} aria-hidden="true" />
        <button
          type="button"
          className={styles.zoomButton}
          aria-label="Zoom out"
          data-tooltip="Zoom out"
          onClick={() =>
            setViewport((value) =>
              viewportAtPoint(value, { x: 0, y: 0 }, value.zoom * 0.9),
            )
          }
        >
          <ZoomOut size={16} aria-hidden="true" />
        </button>
        <span className={styles.zoomValue} aria-live="polite">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          type="button"
          className={styles.zoomButton}
          aria-label="Zoom in"
          data-tooltip="Zoom in"
          onClick={() =>
            setViewport((value) =>
              viewportAtPoint(value, { x: 0, y: 0 }, value.zoom * 1.1),
            )
          }
        >
          <ZoomIn size={16} aria-hidden="true" />
        </button>
      </div>
      <footer className={styles.status}>
        <span>
          {readOnly
            ? "View only"
            : tool === "eraser"
              ? "Hover and drag to erase"
              : selection.size
                ? selection.size + " selected"
                : "Click and drag to draw"}
        </span>
        <button
          type="button"
          className={styles.exportLink}
          data-tooltip="Save changes (⌘/Ctrl+S)"
          onClick={() => void saveNow()}
          disabled={readOnly || !dirty}
        >
          Save
        </button>
      </footer>
      <Dialog
        open={renameOpen}
        onClose={() => {
          if (!renameBusy) setRenameOpen(false);
        }}
        title="Rename whiteboard"
        description="Give this board a name that is easy to find later."
        size="sm"
        dismissible={!renameBusy}
        initialFocusRef={titleInputRef}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={renameBusy}
              onClick={() => setRenameOpen(false)}
            >
              Cancel
            </Button>
            <Button loading={renameBusy} onClick={() => void saveTitle()}>
              Save name
            </Button>
          </>
        }
      >
        <Input
          ref={titleInputRef}
          label="Whiteboard name"
          value={titleDraft}
          maxLength={200}
          autoComplete="off"
          onChange={(event) => setTitleDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveTitle();
            }
          }}
          error={renameError ?? undefined}
        />
      </Dialog>
    </div>
  );
});
