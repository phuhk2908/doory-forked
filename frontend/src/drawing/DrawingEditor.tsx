import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Circle,
  Clipboard,
  Copy,
  Diamond,
  Download,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Grid3x3,
  Hand,
  Image as ImageIcon,
  Maximize2,
  Menu,
  Minus,
  MoveRight,
  MousePointer2,
  Pencil,
  Paintbrush,
  Redo2,
  Route,
  RotateCcw,
  RotateCw,
  Scissors,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Lock,
  LockOpen,
  X,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button, Dialog, Input } from "@/ui";
import {
  documentBounds,
  elementFrame,
  elementBounds,
  elementsHitBySegment,
  elementsInRect,
  hitTestScene,
  normalizeRect,
  noteTextHeight,
  rotatePoint,
  snapToGrid,
  screenToWorld,
  selectionBounds,
  textBounds,
  translateElement,
  viewportAtPoint,
  worldToScreen,
  zoomViewport,
  type Point,
  type Rect,
} from "./geometry";
import { DrawingHistory } from "./history";
import {
  alignElements,
  createFreedraw,
  createLinear,
  createNote,
  createShape,
  createText,
  bindLinearElement,
  bringForward,
  bringToFront,
  deleteElements,
  distributeElements,
  duplicateElements,
  expandSelectionToGroups,
  flipElements,
  groupIdsInSelection,
  groupElements,
  linearEndpoint,
  linearPoint,
  insertLinearWaypoint,
  moveLinearEndpoint,
  moveLinearPoint,
  orthogonalizeConnector,
  pasteElements,
  removeLinearWaypoint,
  reverseConnector,
  rotateElement,
  rotateElements,
  resizeElement,
  resizeElements,
  snapSelectionTranslation,
  selectionUnitCount,
  sendToBack,
  syncBindings,
  sendBackward,
  ungroupElements,
  updateElements,
  type LinearEndpoint,
  type ResizeHandle,
  type Alignment,
  type SelectionSnapGuide,
  type SelectionSpacingGuide,
} from "./scene";
import { exportDrawing, renderDrawing } from "./renderer";
import {
  DRAWING_NOTE_DEFAULT_TEXT,
  DRAWING_NOTE_PADDING,
  createElement,
  newElementId,
  rebaseDrawingHistory,
  restoreDrawing,
  DEFAULT_STYLE,
  updateElement,
  versionNonce,
  type DrawingDocument,
  type DrawingElement,
  type DrawingFile,
  type DrawingExportOptions,
  type DrawingStyle,
  type DrawingTool,
  type DrawingViewport,
  type LinearElement,
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
  /** Upload image bytes and return durable metadata; bytes never enter the drawing document. */
  onUploadImage?: (file: File) => Promise<DrawingFile>;
  /** Resolve a stored image URL (for example an IndexedDB-backed `idb://` URL). */
  onResolveImage?: (file: DrawingFile) => Promise<string>;
  title?: string;
}

type DrawTool = Extract<
  DrawingTool,
  "rectangle" | "ellipse" | "diamond" | "line" | "arrow" | "freedraw"
>;
type TextEditing = {
  id: string;
  value: string;
  cancelText: string;
  historyReset: boolean;
  isNew: boolean;
  wasDirty: boolean;
  changed: boolean;
};
type ContextMenuPosition = {
  x: number;
  y: number;
};
type ImageInputAction = "insert" | { replaceId: string };
type PinchInteraction = {
  pointerIds: [number, number];
  startDistance: number;
  startMidpoint: Point;
  startWorld: Point;
  startViewport: DrawingViewport;
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
      kind: "resize";
      pointerId: number;
      start: Point;
      current: Point;
      document: DrawingDocument;
      elements: readonly DrawingElement[];
      handle: ResizeHandle;
      keepAspectRatio: boolean;
    }
  | {
      kind: "endpoint";
      pointerId: number;
      start: Point;
      current: Point;
      document: DrawingDocument;
      element: LinearElement;
      endpoint: LinearEndpoint;
      targetId: string | null;
    }
  | {
      kind: "waypoint";
      pointerId: number;
      document: DrawingDocument;
      baseDocument: DrawingDocument;
      elementId: string;
      index: number;
    }
  | {
      kind: "rotate";
      pointerId: number;
      start: Point;
      current: Point;
      centre: Point;
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

const RESIZE_HANDLES: ResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

type TransformTarget = Rect & { angle?: number };
interface CanvasBounds {
  width: number;
  height: number;
}

const TRANSFORM_HANDLE_MARGIN = 14;
const ROTATION_HANDLE_OFFSET = 24;
const ROTATION_SNAP_DEGREES = 15;
const OBJECT_SNAP_TOLERANCE_PX = 8;

function isResizableElement(element: DrawingElement | undefined): boolean {
  return (
    element?.type === "rectangle" ||
    element?.type === "ellipse" ||
    element?.type === "diamond" ||
    element?.type === "image" ||
    element?.type === "line" ||
    element?.type === "arrow" ||
    element?.type === "freedraw" ||
    (element?.type === "text" && element.customData?.variant === "note")
  );
}

function isActionableConnector(
  element: DrawingElement | undefined,
): element is LinearElement {
  return (
    element !== undefined &&
    (element.type === "line" || element.type === "arrow") &&
    !element.locked &&
    element.angle === 0 &&
    element.points.length >= 2
  );
}

function isOrthogonalizableConnector(
  element: DrawingElement | undefined,
): element is LinearElement {
  return isActionableConnector(element);
}

function isReversibleConnector(
  element: DrawingElement | undefined,
): element is LinearElement {
  return isActionableConnector(element);
}

function canResizeSelection(elements: readonly DrawingElement[]): boolean {
  return (
    elements.length > 0 &&
    elements.every(isResizableElement) &&
    (elements.length === 1 || elements.every((element) => element.angle === 0))
  );
}

function canRotateSelection(elements: readonly DrawingElement[]): boolean {
  return (
    elements.length > 0 &&
    elements.every(isResizableElement) &&
    !(
      elements.length === 1 &&
      (elements[0]?.type === "line" || elements[0]?.type === "arrow")
    )
  );
}

function canShowResizeHandles(elements: readonly DrawingElement[]): boolean {
  return (
    canResizeSelection(elements) &&
    !(
      elements.length === 1 &&
      (elements[0]?.type === "line" || elements[0]?.type === "arrow")
    )
  );
}

function resizeHandleAt(
  element: TransformTarget,
  screen: Point,
  viewport: DrawingViewport,
): ResizeHandle | null {
  return (
    RESIZE_HANDLES.find((handle) => {
      const position = resizeHandlePosition(element, handle, viewport);
      return Math.hypot(screen.x - position.x, screen.y - position.y) <= 12;
    }) ?? null
  );
}

function transformTargetFor(element: DrawingElement): TransformTarget {
  return { ...elementFrame(element), angle: element.angle };
}

function resizeHandlePosition(
  element: TransformTarget,
  handle: ResizeHandle,
  viewport: DrawingViewport,
): Point {
  const x = handle.includes("w")
    ? element.x
    : handle.includes("e")
      ? element.x + element.width
      : element.x + element.width / 2;
  const y = handle.includes("n")
    ? element.y
    : handle.includes("s")
      ? element.y + element.height
      : element.y + element.height / 2;
  const rotated = rotatePoint(
    { x, y },
    { x: element.x + element.width / 2, y: element.y + element.height / 2 },
    element.angle ?? 0,
  );
  return worldToScreen(rotated, viewport);
}

function rotationHandlePosition(
  element: TransformTarget,
  viewport: DrawingViewport,
  bounds?: CanvasBounds,
): Point {
  const offset = ROTATION_HANDLE_OFFSET / Math.max(viewport.zoom, 0.1);
  const rotated = rotatePoint(
    {
      x: element.x + element.width / 2,
      y: element.y - offset,
    },
    { x: element.x + element.width / 2, y: element.y + element.height / 2 },
    element.angle ?? 0,
  );
  const position = worldToScreen(rotated, viewport);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return position;
  return {
    x: Math.min(
      Math.max(position.x, TRANSFORM_HANDLE_MARGIN),
      Math.max(TRANSFORM_HANDLE_MARGIN, bounds.width - TRANSFORM_HANDLE_MARGIN),
    ),
    y: Math.min(
      Math.max(position.y, TRANSFORM_HANDLE_MARGIN),
      Math.max(
        TRANSFORM_HANDLE_MARGIN,
        bounds.height - TRANSFORM_HANDLE_MARGIN,
      ),
    ),
  };
}

function rotationHandleAt(
  element: TransformTarget,
  screen: Point,
  viewport: DrawingViewport,
  bounds?: CanvasBounds,
): boolean {
  const position = rotationHandlePosition(element, viewport, bounds);
  return Math.hypot(screen.x - position.x, screen.y - position.y) <= 13;
}

function canvasBounds(
  canvas: HTMLCanvasElement | null,
): CanvasBounds | undefined {
  if (!canvas) return undefined;
  const rect = canvas.getBoundingClientRect();
  return {
    width: canvas.clientWidth || rect.width,
    height: canvas.clientHeight || rect.height,
  };
}

function linearEndpointPosition(
  element: LinearElement,
  endpoint: LinearEndpoint,
  viewport: DrawingViewport,
): Point {
  return worldToScreen(linearEndpoint(element, endpoint), viewport);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function selectionDocument(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  return {
    ...document,
    elements: document.elements.filter(
      (element) => ids.has(element.id) && !element.isDeleted,
    ),
  };
}

function translateDocument(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
): DrawingDocument {
  return syncBindings(
    updateElements(document, ids, (element) =>
      translateElement(element, dx, dy),
    ),
    ids,
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

function spacingGuidePoints(
  guide: SelectionSpacingGuide,
  viewport: DrawingViewport,
): {
  first: [Point, Point];
  second: [Point, Point];
} {
  const project = (along: number): Point =>
    guide.axis === "horizontal"
      ? worldToScreen({ x: along, y: guide.cross }, viewport)
      : worldToScreen({ x: guide.cross, y: along }, viewport);
  return {
    first: [project(guide.start), project(guide.movingStart)],
    second: [project(guide.movingEnd), project(guide.end)],
  };
}

function keyFor(event: KeyboardEvent): string {
  return event.key.toLowerCase();
}

function midpoint(left: Point, right: Point): Point {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function distance(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

const DRAWING_CLIPBOARD_PREFIX = "doory-drawing:v2:";
const DRAWING_CLIPBOARD_LEGACY_PREFIX = "doory-drawing:v1:";
const MAX_DRAWING_IMPORT_BYTES = 10 * 1024 * 1024;

type DrawingClipboardPayload = {
  elements: DrawingElement[];
  files?: Record<string, DrawingFile>;
};

function isDrawingImport(value: unknown): value is DrawingDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    Array.isArray((value as { elements?: unknown }).elements)
  );
}

function fileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsText(file);
  });
}

function sameDrawingFile(left: DrawingFile, right: DrawingFile): boolean {
  return (
    left.id === right.id &&
    left.mime === right.mime &&
    left.name === right.name &&
    left.url === right.url &&
    left.width === right.width &&
    left.height === right.height
  );
}

function readClipboardPayload(value: string): DrawingClipboardPayload | null {
  const prefix = value.startsWith(DRAWING_CLIPBOARD_PREFIX)
    ? DRAWING_CLIPBOARD_PREFIX
    : value.startsWith(DRAWING_CLIPBOARD_LEGACY_PREFIX)
      ? DRAWING_CLIPBOARD_LEGACY_PREFIX
      : null;
  if (!prefix) return null;
  try {
    const parsed = JSON.parse(value.slice(prefix.length)) as unknown;
    const envelope =
      Array.isArray(parsed) || parsed === null || typeof parsed !== "object"
        ? null
        : (parsed as { elements?: unknown; files?: unknown });
    const restored = restoreDrawing({
      schemaVersion: 1,
      background: "#ffffff",
      elements: Array.isArray(parsed) ? parsed : envelope?.elements,
      ...(envelope?.files !== undefined ? { files: envelope.files } : {}),
    });
    if (restored.elements.length === 0) return null;
    return {
      elements: restored.elements.filter((element) => !element.isDeleted),
      ...(restored.files ? { files: restored.files } : {}),
    };
  } catch {
    return null;
  }
}

async function readClipboardImage(): Promise<File | null> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.read !== "function" ||
    typeof File === "undefined"
  )
    return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const mime = item.types.find((type) => /^image\//iu.test(type));
      if (!mime) continue;
      const blob = await item.getType(mime);
      if (blob.size === 0) continue;
      const subtype = mime.split("/")[1]?.split(";")[0] || "png";
      const extension = subtype.toLowerCase() === "jpeg" ? "jpg" : subtype;
      return new File([blob], `pasted-image.${extension}`, { type: mime });
    }
  } catch {
    // Clipboard permissions and unsupported formats are safe no-ops.
  }
  return null;
}

function prepareClipboardPaste(
  document: DrawingDocument,
  payload: DrawingClipboardPayload,
): DrawingClipboardPayload {
  const files = { ...(document.files ?? {}) };
  const fileIdMap = new Map<string, string>();
  for (const element of payload.elements) {
    if (element.type !== "image" || fileIdMap.has(element.fileId)) continue;
    const sourceFile = payload.files?.[element.fileId];
    if (!sourceFile) continue;
    const normalized =
      sourceFile.id === element.fileId
        ? sourceFile
        : { ...sourceFile, id: element.fileId };
    const existing = files[element.fileId];
    if (!existing) {
      files[element.fileId] = normalized;
    } else if (!sameDrawingFile(existing, normalized)) {
      const nextId = newElementId();
      fileIdMap.set(element.fileId, nextId);
      files[nextId] = { ...normalized, id: nextId };
    }
  }
  const elements = fileIdMap.size
    ? payload.elements.map((element) => {
        if (element.type !== "image") return element;
        const fileId = fileIdMap.get(element.fileId);
        return fileId ? { ...element, fileId } : element;
      })
    : payload.elements;
  return {
    elements,
    ...(Object.keys(files).length > 0 ? { files } : {}),
  };
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
  if (element.customData?.variant === "note")
    return {
      ...next,
      height: Math.max(element.height, noteTextHeight(next)),
    };
  const bounds = textBounds(next);
  return { ...next, width: bounds.width, height: bounds.height };
}

function updateStyledElement(
  element: DrawingElement,
  patch: Partial<DrawingElement["style"]>,
): DrawingElement {
  const next = {
    ...element,
    style: { ...element.style, ...patch },
  };
  if (next.type === "text" && next.customData?.variant === "note")
    return {
      ...next,
      height: Math.max(element.height, noteTextHeight(next)),
    };
  if (next.type !== "text") return next;
  const bounds = textBounds(next);
  return { ...next, width: bounds.width, height: bounds.height };
}

function sameDrawingStyle(left: DrawingStyle, right: DrawingStyle): boolean {
  return (
    left.stroke === right.stroke &&
    left.fill === right.fill &&
    left.strokeWidth === right.strokeWidth &&
    left.strokeStyle === right.strokeStyle &&
    left.opacity === right.opacity &&
    left.roughness === right.roughness &&
    left.roundness === right.roundness &&
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.textAlign === right.textAlign &&
    left.lineHeight === right.lineHeight
  );
}

type VisualStyleClipboard = {
  style: DrawingStyle;
  startArrowhead?: LinearElement["startArrowhead"];
  endArrowhead?: LinearElement["endArrowhead"];
};

function sameVisualStyle(
  element: DrawingElement,
  clipboard: VisualStyleClipboard,
): boolean {
  if (!sameDrawingStyle(element.style, clipboard.style)) return false;
  if (element.type !== "arrow" || clipboard.startArrowhead === undefined)
    return true;
  return (
    (element.startArrowhead ?? null) === clipboard.startArrowhead &&
    (element.endArrowhead ?? null) === (clipboard.endArrowhead ?? null)
  );
}

interface DrawingPropertiesPanelProps {
  elements: readonly DrawingElement[];
  readOnly: boolean;
  onStyleChange: (patch: Partial<DrawingElement["style"]>, key: string) => void;
  onAngleChange: (angle: number) => void;
  onElementChange: (
    patch: Partial<Pick<LinearElement, "startArrowhead" | "endArrowhead">>,
    key: string,
  ) => void;
}

function commonStyleValue<K extends keyof DrawingElement["style"]>(
  elements: readonly DrawingElement[],
  key: K,
): DrawingElement["style"][K] | undefined {
  const first = elements[0]?.style[key];
  return elements.every((element) => element.style[key] === first)
    ? first
    : undefined;
}

function commonElementValue<K extends keyof DrawingElement>(
  elements: readonly DrawingElement[],
  key: K,
): DrawingElement[K] | undefined {
  const first = elements[0]?.[key];
  return elements.every((element) => element[key] === first)
    ? first
    : undefined;
}

function isFillElement(element: DrawingElement): boolean {
  return (
    element.type === "rectangle" ||
    element.type === "ellipse" ||
    element.type === "diamond" ||
    (element.type === "text" && element.customData?.variant === "note")
  );
}

function commonArrowValue<K extends "startArrowhead" | "endArrowhead">(
  elements: readonly DrawingElement[],
  key: K,
): LinearElement[K] | undefined {
  const arrows = elements.filter(
    (element): element is LinearElement => element.type === "arrow",
  );
  if (arrows.length === 0) return undefined;
  const fallback = key === "endArrowhead" ? "arrow" : null;
  const first = arrows[0]?.[key] ?? fallback;
  return arrows.every((element) => (element[key] ?? fallback) === first)
    ? (first as LinearElement[K])
    : undefined;
}

function colorInputValue(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{6}$/iu.test(value) ? value : fallback;
}

function DrawingPropertiesPanel({
  elements,
  readOnly,
  onStyleChange,
  onAngleChange,
  onElementChange,
}: DrawingPropertiesPanelProps) {
  if (elements.length === 0) return null;
  const stroke = commonStyleValue(elements, "stroke");
  const fill = commonStyleValue(elements, "fill");
  const strokeWidthValue = commonStyleValue(elements, "strokeWidth");
  const strokeWidth = strokeWidthValue ?? 2;
  const strokeStyle = commonStyleValue(elements, "strokeStyle");
  const opacityValue = commonStyleValue(elements, "opacity");
  const opacity = opacityValue ?? 1;
  const fontSizeValue = commonStyleValue(elements, "fontSize");
  const fontSize = fontSizeValue ?? 24;
  const fontFamily = commonStyleValue(elements, "fontFamily") ?? "";
  const lineHeightValue = commonStyleValue(elements, "lineHeight");
  const lineHeight = lineHeightValue ?? 1.25;
  const textAlign = commonStyleValue(elements, "textAlign");
  const roundnessValue = commonStyleValue(elements, "roundness");
  const roundness = roundnessValue ?? 8;
  const roughnessValue = commonStyleValue(elements, "roughness");
  const roughness = roughnessValue ?? 1;
  const hasText = elements.some((element) => element.type === "text");
  const hasArrow = elements.some((element) => element.type === "arrow");
  const endArrowhead = commonArrowValue(elements, "endArrowhead");
  const startArrowhead = commonArrowValue(elements, "startArrowhead");
  const hasFill = elements.some(isFillElement);
  const onlyText = elements.every((element) => element.type === "text");
  const angleValue = commonElementValue(elements, "angle");
  const angle = angleValue ?? 0;

  return (
    <aside className={styles.propertiesPanel} aria-label="Selection properties">
      <div className={styles.propertiesHeader}>
        <strong>Properties</strong>
        <span>{elements.length} selected</span>
      </div>
      <div className={styles.propertiesSection}>
        <div className={styles.propertiesSectionTitle}>Transform</div>
        <div className={styles.propertiesRow}>
          <label htmlFor="drawing-rotation">Rotation</label>
          <div className={styles.rangeControl}>
            <input
              id="drawing-rotation"
              type="number"
              min="0"
              max="359"
              step="1"
              value={angle}
              disabled={readOnly}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value)) onAngleChange(value);
              }}
              aria-label="Rotation"
            />
            <output>{angleValue === undefined ? "Mixed" : `${angle}°`}</output>
          </div>
        </div>
      </div>
      <div className={styles.propertiesSection}>
        <div className={styles.propertiesRow}>
          <label htmlFor="drawing-stroke-color">
            {onlyText ? "Text color" : "Stroke color"}
          </label>
          <div className={styles.colorControl}>
            <input
              id="drawing-stroke-color"
              type="color"
              value={colorInputValue(stroke, "#1f2937")}
              disabled={readOnly}
              aria-label={onlyText ? "Text color" : "Stroke color"}
              onChange={(event) =>
                onStyleChange({ stroke: event.currentTarget.value }, "stroke")
              }
            />
            <span>{stroke === undefined ? "Mixed" : stroke}</span>
          </div>
        </div>
        {hasFill ? (
          <div className={styles.propertiesRow}>
            <label htmlFor="drawing-fill-color">Fill</label>
            <div className={styles.colorControl}>
              <input
                id="drawing-fill-color"
                type="color"
                value={colorInputValue(fill, "#ffffff")}
                disabled={readOnly}
                aria-label="Fill color"
                onChange={(event) =>
                  onStyleChange({ fill: event.currentTarget.value }, "fill")
                }
              />
              <button
                type="button"
                className={styles.propertyToggle}
                aria-pressed={fill === "transparent"}
                disabled={readOnly}
                onClick={() => onStyleChange({ fill: "transparent" }, "fill")}
              >
                {fill === "transparent" ? "No fill" : (fill ?? "Mixed")}
              </button>
            </div>
          </div>
        ) : null}
        <div className={styles.propertiesRow}>
          <label htmlFor="drawing-stroke-width">Stroke width</label>
          <div className={styles.rangeControl}>
            <input
              id="drawing-stroke-width"
              type="range"
              min="0.5"
              max="12"
              step="0.5"
              value={strokeWidth}
              disabled={readOnly}
              onChange={(event) =>
                onStyleChange(
                  { strokeWidth: Number(event.currentTarget.value) },
                  "strokeWidth",
                )
              }
            />
            <output>
              {strokeWidthValue === undefined ? "Mixed" : strokeWidth}
            </output>
          </div>
        </div>
        <div className={styles.propertiesRow}>
          <label htmlFor="drawing-opacity">Opacity</label>
          <div className={styles.rangeControl}>
            <input
              id="drawing-opacity"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={opacity}
              disabled={readOnly}
              onChange={(event) =>
                onStyleChange(
                  { opacity: Number(event.currentTarget.value) },
                  "opacity",
                )
              }
            />
            <output>
              {opacityValue === undefined
                ? "Mixed"
                : `${Math.round(opacity * 100)}%`}
            </output>
          </div>
        </div>
        <div className={styles.propertiesRow}>
          <label htmlFor="drawing-stroke-style">Line style</label>
          <select
            id="drawing-stroke-style"
            value={strokeStyle ?? ""}
            disabled={readOnly}
            onChange={(event) => {
              if (event.currentTarget.value)
                onStyleChange(
                  {
                    strokeStyle: event.currentTarget.value as
                      | "solid"
                      | "dashed"
                      | "dotted",
                  },
                  "strokeStyle",
                );
            }}
          >
            <option value="">Mixed</option>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </div>
      </div>
      {hasText ? (
        <div className={styles.propertiesSection}>
          <div className={styles.propertiesSectionTitle}>Text</div>
          <div className={styles.propertiesRow}>
            <label htmlFor="drawing-font-size">Size</label>
            <div className={styles.rangeControl}>
              <input
                id="drawing-font-size"
                type="number"
                min="8"
                max="256"
                step="1"
                value={fontSize}
                disabled={readOnly}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isFinite(value))
                    onStyleChange({ fontSize: value }, "fontSize");
                }}
              />
              <output>
                {fontSizeValue === undefined ? "Mixed" : fontSize}
              </output>
            </div>
          </div>
          <div className={styles.propertiesRow}>
            <label htmlFor="drawing-font-family">Font</label>
            <select
              id="drawing-font-family"
              value={fontFamily}
              disabled={readOnly}
              onChange={(event) => {
                if (event.currentTarget.value)
                  onStyleChange(
                    { fontFamily: event.currentTarget.value },
                    "fontFamily",
                  );
              }}
            >
              <option value="">Mixed</option>
              <option value="Inter, sans-serif">Inter</option>
              <option value="system-ui, sans-serif">System</option>
              <option value="Georgia, serif">Serif</option>
              <option value="ui-monospace, monospace">Mono</option>
            </select>
          </div>
          <div className={styles.propertiesRow}>
            <label htmlFor="drawing-line-height">Line height</label>
            <div className={styles.rangeControl}>
              <input
                id="drawing-line-height"
                type="range"
                min="0.8"
                max="3"
                step="0.05"
                value={lineHeight}
                disabled={readOnly}
                onChange={(event) =>
                  onStyleChange(
                    { lineHeight: Number(event.currentTarget.value) },
                    "lineHeight",
                  )
                }
              />
              <output>
                {lineHeightValue === undefined
                  ? "Mixed"
                  : lineHeight.toFixed(2)}
              </output>
            </div>
          </div>
          <div className={styles.propertiesRow}>
            <span className={styles.propertiesLabel}>Align</span>
            <div
              className={styles.segmentedControl}
              role="group"
              aria-label="Text alignment"
            >
              {(["left", "center", "right"] as const).map((alignment) => (
                <button
                  key={alignment}
                  type="button"
                  className={styles.propertyToggle}
                  aria-pressed={textAlign === alignment}
                  disabled={readOnly}
                  onClick={() =>
                    onStyleChange({ textAlign: alignment }, "textAlign")
                  }
                >
                  {alignment[0].toUpperCase()}
                </button>
              ))}
              <output>{textAlign === undefined ? "Mixed" : textAlign}</output>
            </div>
          </div>
        </div>
      ) : null}
      {hasArrow ? (
        <div className={styles.propertiesSection}>
          <div className={styles.propertiesSectionTitle}>Arrowheads</div>
          <div className={styles.propertiesRow}>
            <label htmlFor="drawing-start-arrowhead">Start</label>
            <select
              id="drawing-start-arrowhead"
              value={
                startArrowhead === undefined ? "" : (startArrowhead ?? "none")
              }
              disabled={readOnly}
              onChange={(event) =>
                onElementChange(
                  {
                    startArrowhead:
                      event.currentTarget.value === "none"
                        ? null
                        : (event.currentTarget.value as "arrow" | "triangle"),
                  },
                  "startArrowhead",
                )
              }
            >
              <option value="">Mixed</option>
              <option value="none">None</option>
              <option value="arrow">Arrow</option>
              <option value="triangle">Triangle</option>
            </select>
          </div>
          <div className={styles.propertiesRow}>
            <label htmlFor="drawing-end-arrowhead">End</label>
            <select
              id="drawing-end-arrowhead"
              value={endArrowhead === undefined ? "" : (endArrowhead ?? "none")}
              disabled={readOnly}
              onChange={(event) =>
                onElementChange(
                  {
                    endArrowhead:
                      event.currentTarget.value === "none"
                        ? null
                        : (event.currentTarget.value as "arrow" | "triangle"),
                  },
                  "endArrowhead",
                )
              }
            >
              <option value="">Mixed</option>
              <option value="none">None</option>
              <option value="arrow">Arrow</option>
              <option value="triangle">Triangle</option>
            </select>
          </div>
        </div>
      ) : null}
      {elements.some(
        (element) =>
          element.type === "rectangle" ||
          element.type === "ellipse" ||
          element.type === "diamond" ||
          (element.type === "text" && element.customData?.variant === "note"),
      ) ? (
        <div className={styles.propertiesSection}>
          <div className={styles.propertiesRow}>
            <label htmlFor="drawing-roundness">Roundness</label>
            <div className={styles.rangeControl}>
              <input
                id="drawing-roundness"
                type="range"
                min="0"
                max="32"
                step="1"
                value={roundness}
                disabled={readOnly}
                onChange={(event) =>
                  onStyleChange(
                    { roundness: Number(event.currentTarget.value) },
                    "roundness",
                  )
                }
              />
              <output>
                {roundnessValue === undefined ? "Mixed" : roundness}
              </output>
            </div>
          </div>
          <div className={styles.propertiesRow}>
            <label htmlFor="drawing-roughness">Roughness</label>
            <div className={styles.rangeControl}>
              <input
                id="drawing-roughness"
                type="range"
                min="0"
                max="3"
                step="0.1"
                value={roughness}
                disabled={readOnly}
                onChange={(event) =>
                  onStyleChange(
                    { roughness: Number(event.currentTarget.value) },
                    "roughness",
                  )
                }
              />
              <output>
                {roughnessValue === undefined ? "Mixed" : roughness}
              </output>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
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
    onUploadImage,
    onResolveImage,
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
  const [canvasSize, setCanvasSize] = useState<CanvasBounds>({
    width: 0,
    height: 0,
  });
  const [preview, setPreview] = useState<DrawingDocument | null>(null);
  const [endpointSnap, setEndpointSnap] = useState<{
    point: Point;
    targetId: string | null;
  } | null>(null);
  const [selectionSnapGuides, setSelectionSnapGuides] = useState<
    readonly SelectionSnapGuide[]
  >([]);
  const [selectionSpacingGuides, setSelectionSpacingGuides] = useState<
    readonly SelectionSpacingGuide[]
  >([]);
  const [draft, setDraft] = useState<DrawingElement | null>(null);
  const [lasso, setLasso] = useState<Rect | null>(null);
  const [editing, setEditing] = useState<TextEditing | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [snapToGridEnabled, setSnapToGridEnabled] = useState(false);
  const [transparentExport, setTransparentExport] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(
    null,
  );
  const [renameOpen, setRenameOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [hasCopiedStyle, setHasCopiedStyle] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageRevision, setImageRevision] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const activeTouchPointersRef = useRef<Map<number, Point>>(new Map());
  const ignoredTouchPointersRef = useRef<Set<number>>(new Set());
  const touchStartToolRef = useRef<DrawingTool | null>(null);
  const pinchRef = useRef<PinchInteraction | null>(null);
  const spacePressedRef = useRef(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const shapeMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuItemsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const importInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageInputActionRef = useRef<ImageInputAction>("insert");
  const imageUrlsRef = useRef(new Map<string, string>());
  const imageSourcesRef = useRef(new Map<string, string>());
  const resolvingImageIdsRef = useRef(
    new Map<
      string,
      { sourceKey: string; promise: Promise<string | undefined> }
    >(),
  );
  const clipboardRef = useRef<DrawingClipboardPayload>({ elements: [] });
  const styleClipboardRef = useRef<VisualStyleClipboard | null>(null);
  const styleDefaultsRef = useRef<Partial<DrawingStyle>>({});
  const selectedIds = useMemo(
    () => expandSelectionToGroups(document, selection),
    [document, selection],
  );
  const selectedGroupIds = useMemo(
    () => groupIdsInSelection(document, selectedIds),
    [document, selectedIds],
  );
  const logicalSelectionCount = useMemo(
    () => selectionUnitCount(document, selectedIds),
    [document, selectedIds],
  );
  const canAlignSelection = logicalSelectionCount > 1;
  const canDistributeSelection = logicalSelectionCount > 2;
  const hasLockedElements = useMemo(
    () =>
      document.elements.some((element) => element.locked && !element.isDeleted),
    [document],
  );
  const hasSelectableElements = useMemo(
    () =>
      document.elements.some(
        (element) => !element.isDeleted && !element.locked,
      ),
    [document],
  );
  const shown = preview ?? document;
  const selectedElements = document.elements.filter(
    (element) => selectedIds.has(element.id) && !element.isDeleted,
  );
  const canOrthogonalizeConnector =
    selectedElements.length === 1 &&
    isOrthogonalizableConnector(selectedElements[0]);
  const canReverseConnector =
    selectedElements.length === 1 && isReversibleConnector(selectedElements[0]);
  const canFlipSelection =
    selectedElements.length > 0 &&
    selectedElements.every(
      (element) => !element.locked && element.type !== "text",
    );
  const canResetRotation = selectedElements.some(
    (element) => !element.locked && element.angle !== 0,
  );
  const canCopyStyle = selectedElements.length > 0;
  const canPasteStyle =
    hasCopiedStyle && selectedElements.some((element) => !element.locked);
  const hasLockedSelection = selectedElements.some((element) => element.locked);
  const canMutateSelection =
    !readOnly && selectedIds.size > 0 && !hasLockedSelection;
  const canReplaceImage =
    !readOnly &&
    !!onUploadImage &&
    !imageBusy &&
    selectedElements.length === 1 &&
    selectedElements[0]?.type === "image" &&
    !selectedElements[0].locked;

  const announce = useCallback((message: string): void => {
    setAnnouncement(message);
  }, []);

  const resetZoom = useCallback((): void => {
    const canvas = canvasRef.current;
    const screen = canvas
      ? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }
      : { x: 0, y: 0 };
    setViewport((value) => viewportAtPoint(value, screen, 1));
    announce("Zoom reset to 100%");
  }, [announce]);

  const zoomToBounds = useCallback((bounds: Rect): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
  }, []);

  const zoomToContent = useCallback((): void => {
    zoomToBounds(documentBounds(documentRef.current));
  }, [zoomToBounds]);

  const zoomToSelection = useCallback((): void => {
    const bounds = selectionBounds(documentRef.current, selectedIds);
    if (bounds) zoomToBounds(bounds);
  }, [selectedIds, zoomToBounds]);

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

  const resolveImageUrls = useCallback(
    async (source: DrawingDocument): Promise<ReadonlyMap<string, string>> => {
      const files = source.files ?? {};
      const imageIds = new Set(
        source.elements
          .filter(
            (element): element is Extract<DrawingElement, { type: "image" }> =>
              element.type === "image" && !element.isDeleted,
          )
          .map((element) => element.fileId),
      );
      const cachedFileIds = new Set([
        ...imageUrlsRef.current.keys(),
        ...imageSourcesRef.current.keys(),
      ]);
      for (const fileId of cachedFileIds) {
        if (!imageIds.has(fileId)) {
          imageUrlsRef.current.delete(fileId);
          imageSourcesRef.current.delete(fileId);
        }
      }
      await Promise.all(
        [...imageIds].map(async (fileId) => {
          const file = files[fileId];
          if (!file) return;
          const sourceKey = `${file.id}:${file.url}`;
          if (
            imageUrlsRef.current.has(fileId) &&
            imageSourcesRef.current.get(fileId) === sourceKey
          )
            return;
          const resolving = resolvingImageIdsRef.current.get(fileId);
          if (resolving?.sourceKey === sourceKey) {
            await resolving.promise;
            return;
          }
          imageUrlsRef.current.delete(fileId);
          imageSourcesRef.current.set(fileId, sourceKey);
          const promise = (async (): Promise<string | undefined> => {
            try {
              const url = onResolveImage
                ? await onResolveImage(file)
                : file.url;
              if (url && imageSourcesRef.current.get(fileId) === sourceKey)
                imageUrlsRef.current.set(fileId, url);
              return url;
            } catch {
              // A missing asset is rendered as a safe placeholder.
              return undefined;
            } finally {
              queueMicrotask(() => {
                const active = resolvingImageIdsRef.current.get(fileId);
                if (active?.sourceKey === sourceKey)
                  resolvingImageIdsRef.current.delete(fileId);
              });
            }
          })();
          resolvingImageIdsRef.current.set(fileId, { sourceKey, promise });
          await promise;
        }),
      );
      setImageRevision((value) => value + 1);
      return imageUrlsRef.current;
    },
    [onResolveImage],
  );

  const openImagePicker = useCallback(
    (action: ImageInputAction): void => {
      if (readOnly || !onUploadImage || imageBusy) return;
      imageInputActionRef.current = action;
      imageInputRef.current?.click();
    },
    [imageBusy, onUploadImage, readOnly],
  );

  const chooseImage = useCallback((): void => {
    openImagePicker("insert");
  }, [openImagePicker]);

  const insertImageFile = useCallback(
    async (file: File, dropPoint?: Point): Promise<void> => {
      if (readOnly || !onUploadImage || imageBusy) return;
      setImageBusy(true);
      announce("Uploading image…");
      try {
        const metadata = await onUploadImage(file);
        const naturalWidth = Math.max(1, metadata.width ?? 512);
        const naturalHeight = Math.max(1, metadata.height ?? 512);
        const maxSize = 360;
        const scale = Math.min(
          1,
          maxSize / naturalWidth,
          maxSize / naturalHeight,
        );
        const width = Math.max(20, Math.round(naturalWidth * scale));
        const height = Math.max(20, Math.round(naturalHeight * scale));
        const canvas = canvasRef.current;
        const viewportWidth = (canvas?.clientWidth || 800) / viewport.zoom;
        const viewportHeight = (canvas?.clientHeight || 600) / viewport.zoom;
        const x = dropPoint
          ? dropPoint.x - width / 2
          : viewport.scrollX + Math.max(0, (viewportWidth - width) / 2);
        const y = dropPoint
          ? dropPoint.y - height / 2
          : viewport.scrollY + Math.max(0, (viewportHeight - height) / 2);
        const image = createElement("image", {
          fileId: metadata.id,
          x,
          y,
          width,
          height,
        });
        const current = documentRef.current;
        const next: DrawingDocument = {
          ...current,
          files: { ...(current.files ?? {}), [metadata.id]: metadata },
          elements: [...current.elements, image],
        };
        markChange(next, "Add image");
        setSelection(new Set([image.id]));
        setTool("select");
        announce("Inserted image");
      } catch {
        announce("Could not add that image");
      } finally {
        setImageBusy(false);
      }
    },
    [announce, imageBusy, markChange, onUploadImage, readOnly, viewport],
  );

  const handleImageDragOver = useCallback(
    (event: ReactDragEvent<HTMLCanvasElement>): void => {
      if (readOnly || !onUploadImage || imageBusy) return;
      if ([...event.dataTransfer.items].some((item) => item.kind === "file")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    },
    [imageBusy, onUploadImage, readOnly],
  );

  const handleImageDrop = useCallback(
    (event: ReactDragEvent<HTMLCanvasElement>): void => {
      if (readOnly || !onUploadImage || imageBusy) return;
      const file = [...event.dataTransfer.files].find((item) =>
        /^image\//iu.test(item.type),
      );
      if (!file) return;
      event.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const point = movement(
        {
          clientX: Number.isFinite(event.clientX)
            ? event.clientX
            : rect.left + rect.width / 2,
          clientY: Number.isFinite(event.clientY)
            ? event.clientY
            : rect.top + rect.height / 2,
        },
        rect,
        viewport,
      );
      void insertImageFile(file, point);
    },
    [imageBusy, insertImageFile, onUploadImage, readOnly, viewport],
  );

  const replaceImageFile = useCallback(
    async (file: File, targetId: string): Promise<void> => {
      if (readOnly || !onUploadImage || imageBusy) return;
      const current = documentRef.current;
      const target = current.elements.find(
        (element): element is Extract<DrawingElement, { type: "image" }> =>
          element.id === targetId &&
          element.type === "image" &&
          !element.isDeleted,
      );
      if (!target || target.locked) return;
      setImageBusy(true);
      announce("Uploading replacement…");
      try {
        const metadata = await onUploadImage(file);
        const next: DrawingDocument = {
          ...current,
          files: { ...(current.files ?? {}), [metadata.id]: metadata },
          elements: current.elements.map((element) =>
            element.id === target.id
              ? {
                  ...element,
                  fileId: metadata.id,
                  version: element.version + 1,
                  versionNonce: versionNonce(),
                }
              : element,
          ),
        };
        markChange(next, "Replace image");
        setSelection(new Set([target.id]));
        setTool("select");
        announce("Replaced image");
      } catch {
        announce("Could not replace that image");
      } finally {
        setImageBusy(false);
      }
    },
    [announce, imageBusy, markChange, onUploadImage, readOnly],
  );

  const chooseImageReplacement = useCallback((): void => {
    const target =
      selectedElements.length === 1 && selectedElements[0]?.type === "image"
        ? selectedElements[0]
        : null;
    if (!target || target.locked) return;
    openImagePicker({ replaceId: target.id });
  }, [openImagePicker, selectedElements]);

  const groupSelected = useCallback((): void => {
    if (readOnly || selectedIds.size < 2) return;
    const result = groupElements(documentRef.current, selectedIds);
    markChange(result.document, "Group selection");
    setSelection(selectedIds);
    announce(`Grouped ${selectedIds.size} elements`);
  }, [announce, markChange, readOnly, selectedIds]);

  const selectAllElements = useCallback((): void => {
    const ids = new Set(
      documentRef.current.elements
        .filter((element) => !element.isDeleted && !element.locked)
        .map((element) => element.id),
    );
    setSelection(ids);
    onPresenceChange?.({ cursor: null, selection: [...ids] });
    announce(
      ids.size === 0
        ? "No elements to select"
        : ids.size === 1
          ? "Selected 1 element"
          : `Selected ${ids.size} elements`,
    );
  }, [announce, onPresenceChange]);

  const clearSelection = useCallback((): void => {
    if (selectedIds.size === 0) return;
    setSelection(new Set());
    onPresenceChange?.({ cursor: null, selection: [] });
    announce("Cleared selection");
  }, [announce, onPresenceChange, selectedIds]);

  const openContextMenuAt = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    setMenuOpen(false);
    setShapeMenuOpen(false);
    setContextMenu({
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  }, []);

  const openContextMenuFromSelection = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const bounds = selectionBounds(documentRef.current, selectedIds);
    const point = bounds
      ? worldToScreen(
          {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
          },
          viewport,
        )
      : {
          x: (canvas.clientWidth || rect.width || 0) / 2,
          y: (canvas.clientHeight || rect.height || 0) / 2,
        };
    openContextMenuAt(rect.left + point.x, rect.top + point.y);
  }, [openContextMenuAt, selectedIds, viewport]);

  const closeContextMenu = useCallback((): void => {
    setContextMenu(null);
    contextMenuItemsRef.current = [];
  }, []);

  const executeContextAction = useCallback(
    (action: () => void | Promise<void>): void => {
      closeContextMenu();
      void action();
    },
    [closeContextMenu],
  );

  const copySelectedElements = useCallback(
    (ids: ReadonlySet<string> = selectedIds): void => {
      const copied = documentRef.current.elements.filter(
        (element) => ids.has(element.id) && !element.isDeleted,
      );
      if (copied.length === 0) return;
      const files: Record<string, DrawingFile> = {};
      for (const element of copied) {
        if (element.type !== "image") continue;
        const file = documentRef.current.files?.[element.fileId];
        if (file) files[element.fileId] = file;
      }
      const payload: DrawingClipboardPayload = {
        elements: copied,
        ...(Object.keys(files).length > 0 ? { files } : {}),
      };
      clipboardRef.current = payload;
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard
          .writeText(
            DRAWING_CLIPBOARD_PREFIX +
              JSON.stringify({ version: 2, ...payload }),
          )
          .catch(() => undefined);
      }
      announce("Copied selection");
    },
    [announce, selectedIds],
  );

  const cutSelectedElements = useCallback((): void => {
    if (readOnly || selectedIds.size === 0) return;
    const cutIds = new Set(
      selectedElements
        .filter((element) => !element.locked)
        .map((element) => element.id),
    );
    if (cutIds.size === 0) {
      announce("No unlocked elements to cut");
      return;
    }
    copySelectedElements(cutIds);
    markChange(deleteElements(documentRef.current, cutIds), "Cut selection");
    setSelection(new Set());
    onPresenceChange?.({ cursor: null, selection: [] });
    announce("Cut selection");
  }, [
    announce,
    copySelectedElements,
    markChange,
    onPresenceChange,
    readOnly,
    selectedElements,
    selectedIds,
  ]);

  const pasteSelectedElements = useCallback(
    async (offset = 24, inPlace = false): Promise<void> => {
      if (readOnly) return;
      let payload = clipboardRef.current;
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        let clipboardText = "";
        let systemTextRead = false;
        try {
          clipboardText = await navigator.clipboard.readText();
          systemTextRead = true;
        } catch {
          // Clipboard permissions can fail; keep the in-editor fallback.
        }
        const systemPayload = readClipboardPayload(clipboardText);
        if (systemPayload) payload = systemPayload;
        if (!systemPayload && onUploadImage) {
          const image = await readClipboardImage();
          if (image) {
            await insertImageFile(image);
            return;
          }
        }
        if (systemTextRead && clipboardText.trim() && !systemPayload)
          payload = { elements: [] };
      }
      if (payload.elements.length === 0) {
        announce("No drawing in clipboard");
        return;
      }
      const prepared = prepareClipboardPaste(documentRef.current, payload);
      const result = pasteElements(
        documentRef.current,
        prepared.elements,
        offset,
      );
      const next = {
        ...result.document,
        ...(prepared.files ? { files: prepared.files } : {}),
      };
      markChange(
        next,
        inPlace ? "Paste selection in place" : "Paste selection",
      );
      setSelection(new Set(result.ids));
      const count =
        result.ids.length === 1 ? "1 element" : `${result.ids.length} elements`;
      announce(inPlace ? `Pasted ${count} in place` : `Pasted ${count}`);
    },
    [announce, insertImageFile, markChange, onUploadImage, readOnly],
  );

  const duplicateSelected = useCallback((): void => {
    if (readOnly || selectedIds.size === 0) return;
    const result = duplicateElements(documentRef.current, selectedIds);
    markChange(result.document, "Duplicate selection");
    setSelection(new Set(result.ids));
    announce(
      selectedIds.size === 1
        ? "Duplicated 1 element"
        : `Duplicated ${selectedIds.size} elements`,
    );
  }, [announce, markChange, readOnly, selectedIds]);

  const deleteSelected = useCallback((): void => {
    if (readOnly || selectedIds.size === 0) return;
    markChange(
      deleteElements(documentRef.current, selectedIds),
      "Delete selection",
    );
    setSelection(new Set());
    onPresenceChange?.({ cursor: null, selection: [] });
    announce("Deleted selection");
  }, [announce, markChange, onPresenceChange, readOnly, selectedIds]);

  const ungroupSelected = useCallback((): void => {
    if (readOnly || selectedIds.size === 0 || selectedGroupIds.length === 0)
      return;
    const next = ungroupElements(documentRef.current, selectedIds);
    if (next === documentRef.current) return;
    markChange(next, "Ungroup selection");
    setSelection(selectedIds);
    announce("Ungrouped selection");
  }, [announce, markChange, readOnly, selectedGroupIds, selectedIds]);

  const changeLayer = useCallback(
    (action: "forward" | "backward" | "front" | "back"): void => {
      if (readOnly || selectedIds.size === 0) return;
      const current = documentRef.current;
      const next =
        action === "forward"
          ? bringForward(current, selectedIds)
          : action === "backward"
            ? sendBackward(current, selectedIds)
            : action === "front"
              ? bringToFront(current, selectedIds)
              : sendToBack(current, selectedIds);
      const changed = next.elements.some(
        (element, index) => element.id !== current.elements[index]?.id,
      );
      if (!changed) return;
      markChange(next, "Arrange selection");
      setSelection(selectedIds);
      announce(
        action === "forward" || action === "front"
          ? "Moved selection forward"
          : "Moved selection backward",
      );
    },
    [announce, markChange, readOnly, selectedIds],
  );

  const alignSelection = useCallback(
    (alignment: Alignment): void => {
      if (readOnly || !canAlignSelection) return;
      const next = alignElements(documentRef.current, selectedIds, alignment);
      if (next === documentRef.current) return;
      markChange(next, "Align selection");
      setSelection(selectedIds);
      announce(
        alignment === "left"
          ? "Aligned left"
          : alignment === "center"
            ? "Centered horizontally"
            : alignment === "right"
              ? "Aligned right"
              : alignment === "top"
                ? "Aligned top"
                : alignment === "middle"
                  ? "Centered vertically"
                  : "Aligned bottom",
      );
    },
    [announce, canAlignSelection, markChange, readOnly, selectedIds],
  );

  const distributeSelection = useCallback(
    (axis: "horizontal" | "vertical"): void => {
      if (readOnly || !canDistributeSelection) return;
      const next = distributeElements(documentRef.current, selectedIds, axis);
      if (next === documentRef.current) return;
      markChange(next, "Distribute selection");
      setSelection(selectedIds);
      announce(
        axis === "horizontal"
          ? "Distributed horizontally"
          : "Distributed vertically",
      );
    },
    [announce, canDistributeSelection, markChange, readOnly, selectedIds],
  );

  const orthogonalizeSelectedConnector = useCallback((): void => {
    if (readOnly || !canOrthogonalizeConnector || selectedIds.size !== 1)
      return;
    const elementId = [...selectedIds][0];
    if (!elementId) return;
    const next = orthogonalizeConnector(documentRef.current, elementId);
    if (next === documentRef.current) return;
    markChange(next, "Orthogonalize connector");
    setSelection(selectedIds);
    announce("Orthogonalized connector");
  }, [announce, canOrthogonalizeConnector, markChange, readOnly, selectedIds]);

  const reverseSelectedConnector = useCallback((): void => {
    if (readOnly || !canReverseConnector || selectedIds.size !== 1) return;
    const elementId = [...selectedIds][0];
    if (!elementId) return;
    const next = reverseConnector(documentRef.current, elementId);
    if (next === documentRef.current) return;
    markChange(next, "Reverse connector direction");
    setSelection(selectedIds);
    announce("Reversed connector direction");
  }, [announce, canReverseConnector, markChange, readOnly, selectedIds]);

  const flipSelection = useCallback(
    (axis: "horizontal" | "vertical"): void => {
      if (readOnly || !canFlipSelection) return;
      const next = flipElements(documentRef.current, selectedIds, axis);
      if (next === documentRef.current) return;
      markChange(next, "Flip selection");
      setSelection(selectedIds);
      announce(
        axis === "horizontal"
          ? "Flipped selection horizontally"
          : "Flipped selection vertically",
      );
    },
    [announce, canFlipSelection, markChange, readOnly, selectedIds],
  );

  const updateSelectedRotation = useCallback(
    (angle: number): void => {
      if (readOnly || selectedIds.size === 0 || !Number.isFinite(angle)) return;
      const normalized = ((angle % 360) + 360) % 360;
      const current = documentRef.current;
      let changed = false;
      const next = updateElements(current, selectedIds, (element) => {
        if (element.angle === normalized) return element;
        changed = true;
        return rotateElement(element, normalized);
      });
      if (!changed) return;
      markChange(next, "Rotate selection", "rotation");
      setSelection(selectedIds);
      announce(`Rotated selection to ${normalized}°`);
    },
    [announce, markChange, readOnly, selectedIds],
  );

  const rotateSelectedBy = useCallback(
    (delta: number): void => {
      if (readOnly || selectedIds.size === 0 || !Number.isFinite(delta)) return;
      const current = documentRef.current;
      const bounds = selectionBounds(current, selectedIds);
      if (!bounds) return;
      const next = rotateElements(current, selectedIds, delta, {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      });
      if (next === current) return;
      markChange(next, "Rotate selection", "rotation");
      setSelection(selectedIds);
      announce(
        delta < 0
          ? "Rotated selection counterclockwise"
          : "Rotated selection clockwise",
      );
    },
    [announce, markChange, readOnly, selectedIds],
  );

  const resetSelectionRotation = useCallback((): void => {
    if (readOnly || !canResetRotation) return;
    const current = documentRef.current;
    const next = updateElements(current, selectedIds, (element) =>
      element.angle === 0 ? element : updateElement(element, { angle: 0 }),
    );
    if (
      next.elements.every(
        (element, index) => element === current.elements[index],
      )
    )
      return;
    markChange(next, "Reset selection rotation");
    setSelection(selectedIds);
    announce("Reset selection rotation");
  }, [announce, canResetRotation, markChange, readOnly, selectedIds]);

  const lockSelection = useCallback((): void => {
    if (readOnly || selectedIds.size === 0) return;
    const next = updateElements(documentRef.current, selectedIds, (element) =>
      updateElement(element, { locked: true }),
    );
    markChange(next, "Lock selection");
    setSelection(new Set());
    onPresenceChange?.({ cursor: null, selection: [] });
    announce("Locked selection");
  }, [announce, markChange, onPresenceChange, readOnly, selectedIds]);

  const unlockAll = useCallback((): void => {
    if (readOnly || !hasLockedElements) return;
    const lockedIds = new Set(
      documentRef.current.elements
        .filter((element) => element.locked && !element.isDeleted)
        .map((element) => element.id),
    );
    if (lockedIds.size === 0) return;
    const next = updateElements(documentRef.current, lockedIds, (element) =>
      updateElement(element, { locked: false }),
    );
    markChange(next, "Unlock all elements");
    announce("Unlocked all elements");
  }, [announce, hasLockedElements, markChange, readOnly]);

  const updateSelectedStyle = useCallback(
    (patch: Partial<DrawingElement["style"]>, key: string): void => {
      if (readOnly || selectedIds.size === 0) return;
      styleDefaultsRef.current = { ...styleDefaultsRef.current, ...patch };
      const next = updateElements(
        documentRef.current,
        selectedIds,
        (element) => ({
          ...updateStyledElement(element, patch),
          version: element.version + 1,
          versionNonce: versionNonce(),
        }),
      );
      markChange(next, "Change style", "style:" + key);
    },
    [markChange, readOnly, selectedIds],
  );

  const copySelectedStyle = useCallback((): void => {
    const source = selectedElements[0];
    if (!source) return;
    styleClipboardRef.current = {
      style: { ...source.style },
      ...(source.type === "arrow"
        ? {
            startArrowhead: source.startArrowhead ?? null,
            endArrowhead: source.endArrowhead ?? null,
          }
        : {}),
    };
    setHasCopiedStyle(true);
    announce("Copied visual style");
  }, [announce, selectedElements]);

  const pasteSelectedStyle = useCallback((): void => {
    const style = styleClipboardRef.current;
    if (readOnly || !style || selectedIds.size === 0) return;
    let changed = false;
    const next = updateElements(documentRef.current, selectedIds, (element) => {
      if (
        element.isDeleted ||
        element.locked ||
        sameVisualStyle(element, style)
      )
        return element;
      changed = true;
      const styled = updateStyledElement(element, style.style);
      return {
        ...styled,
        ...(styled.type === "arrow" && style.startArrowhead !== undefined
          ? {
              startArrowhead: style.startArrowhead,
              endArrowhead: style.endArrowhead ?? null,
            }
          : {}),
        version: element.version + 1,
        versionNonce: versionNonce(),
      };
    });
    if (!changed) return;
    styleDefaultsRef.current = { ...style.style };
    markChange(next, "Paste visual style", "style:paste");
    setSelection(selectedIds);
    announce("Pasted visual style");
  }, [announce, markChange, readOnly, selectedIds]);

  const resetSelectedStyle = useCallback((): void => {
    if (readOnly || selectedIds.size === 0) return;
    let changed = false;
    const next = updateElements(documentRef.current, selectedIds, (element) => {
      if (
        element.isDeleted ||
        element.locked ||
        sameDrawingStyle(element.style, DEFAULT_STYLE)
      )
        return element;
      changed = true;
      return {
        ...updateStyledElement(element, DEFAULT_STYLE),
        version: element.version + 1,
        versionNonce: versionNonce(),
      };
    });
    if (!changed) return;
    styleDefaultsRef.current = { ...DEFAULT_STYLE };
    markChange(next, "Reset visual style", "style:reset");
    setSelection(selectedIds);
    announce("Reset visual style");
  }, [announce, markChange, readOnly, selectedIds]);

  const updateSelectedElement = useCallback(
    (
      patch: Partial<Pick<LinearElement, "startArrowhead" | "endArrowhead">>,
      key: string,
    ): void => {
      if (readOnly || selectedIds.size === 0) return;
      const next = updateElements(documentRef.current, selectedIds, (element) =>
        element.type === "arrow"
          ? {
              ...element,
              ...patch,
              version: element.version + 1,
              versionNonce: versionNonce(),
            }
          : element,
      );
      markChange(next, "Change arrowhead", "arrowhead:" + key);
    },
    [markChange, readOnly, selectedIds],
  );

  function setPreviewDocument(next: DrawingDocument): void {
    setPreview(next);
  }

  const cancelInteraction = useCallback((pointerId?: number): void => {
    const interaction = interactionRef.current;
    const pinch = pinchRef.current;
    if (
      interaction &&
      pointerId !== undefined &&
      interaction.pointerId !== pointerId
    )
      return;
    if (
      pinch &&
      pointerId !== undefined &&
      !pinch.pointerIds.includes(pointerId)
    )
      return;
    const canvas = canvasRef.current;
    const capturedPointers = new Set<number>();
    if (interaction) capturedPointers.add(interaction.pointerId);
    if (pinch)
      for (const pinchPointerId of pinch.pointerIds) {
        capturedPointers.add(pinchPointerId);
        ignoredTouchPointersRef.current.add(pinchPointerId);
      }
    interactionRef.current = null;
    pinchRef.current = null;
    for (const capturedPointerId of capturedPointers) {
      if (canvas?.hasPointerCapture(capturedPointerId))
        canvas.releasePointerCapture(capturedPointerId);
    }
    activeTouchPointersRef.current.clear();
    touchStartToolRef.current = null;
    setPreview(null);
    setEndpointSnap(null);
    setSelectionSnapGuides([]);
    setSelectionSpacingGuides([]);
    setDraft(null);
    setLasso(null);
    setEraserTargets(new Set());
    setEraserTrail([]);
    setIsPanning(false);
  }, []);

  const resetTo = useCallback(
    (next: DrawingDocument): void => {
      const rebased = rebaseDrawingHistory(documentRef.current, next);
      documentRef.current = rebased;
      setDocument(rebased);
      setPreview(null);
      setDraft(null);
      setDirty(true);
      onSaveStateChange?.(true);
      onDocumentChange?.(rebased, "Edit drawing");
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
      const nextSelection = new Set(
        [...selection].filter((id) =>
          restored.elements.some(
            (element) => element.id === id && !element.isDeleted,
          ),
        ),
      );
      let nextEditing = editing;
      if (editing) {
        const localEditingElement = documentRef.current.elements.find(
          (element): element is TextElement =>
            element.id === editing.id && element.type === "text",
        );
        const remoteElement = restored.elements.find(
          (element): element is TextElement =>
            element.id === editing.id &&
            element.type === "text" &&
            !element.isDeleted,
        );
        if (!remoteElement) nextEditing = null;
        else {
          const remoteIsNewer =
            !localEditingElement ||
            remoteElement.version > localEditingElement.version ||
            (remoteElement.version === localEditingElement.version &&
              remoteElement.versionNonce > localEditingElement.versionNonce);
          nextEditing = {
            ...editing,
            historyReset: true,
            ...(!editing.isNew && remoteIsNewer
              ? { cancelText: remoteElement.text }
              : {}),
          };
        }
      }
      documentRef.current = restored;
      historyRef.current.clear(restored);
      setDocument(restored);
      setPreview(null);
      setDraft(null);
      setLasso(null);
      setEditing(nextEditing);
      setSelection(nextSelection);
      setEraserTargets(new Set());
      setEraserTrail([]);
      setDirty(false);
      onSaveStateChange?.(false);
      if (nextSelection.size !== selection.size)
        onPresenceChange?.({ cursor: null, selection: [...nextSelection] });
    },
    [
      cancelInteraction,
      editing,
      onPresenceChange,
      onSaveStateChange,
      selection,
    ],
  );

  const saveNow = useCallback(async (): Promise<void> => {
    await onSaveNow?.(documentRef.current);
    setDirty(false);
    onSaveStateChange?.(false);
  }, [onSaveNow, onSaveStateChange]);

  const exportAs = useCallback(
    async (
      format: "json" | "png" | "svg",
      scope: "document" | "selection" = "document",
    ): Promise<void> => {
      const drawing =
        scope === "selection"
          ? selectionDocument(documentRef.current, selectedIds)
          : documentRef.current;
      if (scope === "selection" && drawing.elements.length === 0) return;
      try {
        const imageUrls = await resolveImageUrls(drawing);
        const blob = await exportDrawing(
          drawing,
          viewport,
          {
            format,
            bounds: "content",
            padding: 40,
            scale: 2,
            transparent: transparentExport,
          },
          { imageUrls },
        );
        download(
          blob,
          (title || "drawing") +
            (scope === "selection" ? "-selection" : "") +
            "." +
            (format === "json" ? "doory-drawing.json" : format),
        );
      } catch {
        announce(
          scope === "selection"
            ? "Could not export the selection"
            : "Could not export the drawing",
        );
      }
    },
    [
      announce,
      resolveImageUrls,
      selectedIds,
      title,
      transparentExport,
      viewport,
    ],
  );

  const copySelectionAsImage = useCallback(async (): Promise<void> => {
    if (selectedIds.size === 0) return;
    if (
      typeof ClipboardItem === "undefined" ||
      typeof navigator === "undefined" ||
      !navigator.clipboard?.write
    ) {
      announce("Copying images is not supported in this browser");
      return;
    }
    try {
      const drawing = selectionDocument(documentRef.current, selectedIds);
      const imageUrls = await resolveImageUrls(drawing);
      const blobPromise = exportDrawing(
        drawing,
        viewport,
        {
          format: "png",
          bounds: "content",
          padding: 40,
          scale: 2,
          transparent: transparentExport,
        },
        { imageUrls },
      );
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blobPromise }),
      ]);
      announce("Copied selection as image");
    } catch {
      announce("Could not copy the selection as an image");
    }
  }, [announce, resolveImageUrls, selectedIds, transparentExport, viewport]);

  const changeBackground = useCallback(
    (background: string): void => {
      if (readOnly || background === documentRef.current.background) return;
      markChange(
        { ...documentRef.current, background },
        "Change board background",
      );
      announce("Changed board background");
    },
    [announce, markChange, readOnly],
  );

  const importDrawing = useCallback(
    async (file: File): Promise<void> => {
      if (readOnly) return;
      if (file.size > MAX_DRAWING_IMPORT_BYTES) {
        announce("That drawing file is too large to import");
        return;
      }
      try {
        const value: unknown = JSON.parse(await fileText(file));
        if (!isDrawingImport(value)) throw new Error("invalid_drawing");
        const next = restoreDrawing(value);
        markChange(next, "Import drawing");
        setSelection(new Set());
        announce("Imported drawing");
      } catch {
        announce("Could not import that drawing file");
      }
    },
    [announce, markChange, readOnly],
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
      export: async (options) => {
        const imageUrls = await resolveImageUrls(documentRef.current);
        return exportDrawing(documentRef.current, viewport, options, {
          imageUrls,
        });
      },
    }),
    [
      applyRemoteDocument,
      dirty,
      redo,
      replaceDocument,
      resolveImageUrls,
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
    void resolveImageUrls(shown);
  }, [resolveImageUrls, shown]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell) return undefined;
    const draw = () =>
      renderDrawing(canvas, shown, viewport, {
        selection: selectedIds,
        eraserTargets,
        eraserTrail,
        draft,
        showGrid,
        imageUrls: imageUrlsRef.current,
        onImageLoaded: () => setImageRevision((value) => value + 1),
      });
    const redraw = (): void => {
      const bounds = canvasBounds(canvas);
      if (bounds)
        setCanvasSize((current) =>
          current.width === bounds.width && current.height === bounds.height
            ? current
            : bounds,
        );
      draw();
    };
    const observer = new ResizeObserver(redraw);
    observer.observe(shell);
    redraw();
    return () => observer.disconnect();
  }, [
    shown,
    viewport,
    selectedIds,
    eraserTargets,
    eraserTrail,
    draft,
    showGrid,
    imageRevision,
  ]);

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
        cancelText: element.text,
        historyReset: false,
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
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        (event.key === "ContextMenu" ||
          event.code === "ContextMenu" ||
          (event.shiftKey && event.key === "F10"))
      ) {
        event.preventDefault();
        openContextMenuFromSelection();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (!spacePressedRef.current) {
          spacePressedRef.current = true;
          setSpacePressed(true);
        }
        return;
      }
      const key = keyFor(event);
      if (key === "g" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        if (event.shiftKey) {
          setSnapToGridEnabled((value) => !value);
          announce(
            snapToGridEnabled ? "Grid snapping off" : "Grid snapping on",
          );
        } else {
          setShowGrid((value) => !value);
          announce(showGrid ? "Grid hidden" : "Grid shown");
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "a") {
        event.preventDefault();
        selectAllElements();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        key === "c" &&
        selectedIds.size > 0
      ) {
        event.preventDefault();
        copySelectedElements();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        key === "x" &&
        selectedIds.size > 0 &&
        !readOnly
      ) {
        event.preventDefault();
        cutSelectedElements();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        key === "v" &&
        !readOnly
      ) {
        event.preventDefault();
        void pasteSelectedElements(0, true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "v" && !readOnly) {
        event.preventDefault();
        void pasteSelectedElements();
        return;
      }
      if (
        event.altKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        key === "c" &&
        canCopyStyle
      ) {
        event.preventDefault();
        copySelectedStyle();
        return;
      }
      if (
        event.altKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        key === "p" &&
        canPasteStyle &&
        !readOnly
      ) {
        event.preventDefault();
        pasteSelectedStyle();
        return;
      }
      if (
        event.altKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        key === "0" &&
        selectedIds.size > 0 &&
        !readOnly
      ) {
        event.preventDefault();
        resetSelectedStyle();
        return;
      }
      if (event.key === "Enter" && selectedIds.size === 1 && !readOnly) {
        const selected = documentRef.current.elements.find(
          (element): element is TextElement =>
            selectedIds.has(element.id) && element.type === "text",
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
      if (key === "i" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        chooseImage();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        key === "l" &&
        selectedIds.size > 0 &&
        !readOnly
      ) {
        event.preventDefault();
        lockSelection();
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
        selectedIds.size > 0 &&
        !readOnly
      ) {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (
        event.altKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        canAlignSelection &&
        !readOnly
      ) {
        const alignment: Alignment | undefined =
          key === "arrowleft"
            ? "left"
            : key === "arrowright"
              ? "right"
              : key === "arrowup"
                ? "top"
                : key === "arrowdown"
                  ? "bottom"
                  : key === "h"
                    ? "center"
                    : key === "v"
                      ? "middle"
                      : undefined;
        if (alignment) {
          event.preventDefault();
          alignSelection(alignment);
          return;
        }
      }
      if (
        event.altKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        key === "r" &&
        canReverseConnector &&
        !readOnly
      ) {
        event.preventDefault();
        reverseSelectedConnector();
        return;
      }
      if (
        event.altKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        canFlipSelection &&
        !readOnly
      ) {
        const axis =
          key === "f" ? "horizontal" : key === "m" ? "vertical" : undefined;
        if (axis) {
          event.preventDefault();
          flipSelection(axis);
          return;
        }
      }
      if (
        event.altKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        canDistributeSelection &&
        !readOnly
      ) {
        const axis =
          key === "x" ? "horizontal" : key === "y" ? "vertical" : undefined;
        if (axis) {
          event.preventDefault();
          distributeSelection(axis);
          return;
        }
      }
      if (
        event.altKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        key === "o" &&
        canOrthogonalizeConnector &&
        !readOnly
      ) {
        event.preventDefault();
        orthogonalizeSelectedConnector();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        key === "g" &&
        selectedIds.size > 0 &&
        !readOnly
      ) {
        event.preventDefault();
        if (event.shiftKey) ungroupSelected();
        else groupSelected();
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        selectedIds.size > 0 &&
        !readOnly
      ) {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (key === "escape") {
        if (contextMenu) {
          closeContextMenu();
          return;
        }
        if (menuOpen || shapeMenuOpen) {
          setMenuOpen(false);
          setShapeMenuOpen(false);
          return;
        }
        cancelInteraction();
        clearSelection();
        return;
      }
      if (key === "0") {
        event.preventDefault();
        zoomToContent();
        return;
      }
      if (key === "1") {
        event.preventDefault();
        resetZoom();
        return;
      }
      if (key === "2" && selectedIds.size > 0) {
        event.preventDefault();
        zoomToSelection();
        return;
      }
      if (key === "+" || key === "=") {
        event.preventDefault();
        setViewport((value) => zoomViewport(value, { x: 0, y: 0 }, "in"));
        return;
      }
      if (key === "-") {
        event.preventDefault();
        setViewport((value) => zoomViewport(value, { x: 0, y: 0 }, "out"));
        return;
      }
      const nextTool = TOOL_KEYS[key];
      if (nextTool && !event.metaKey && !event.ctrlKey) setTool(nextTool);
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.code === "BracketRight" || key === "]" || key === "}")
      ) {
        event.preventDefault();
        changeLayer(event.shiftKey ? "front" : "forward");
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.code === "BracketLeft" || key === "[" || key === "{")
      ) {
        event.preventDefault();
        changeLayer(event.shiftKey ? "back" : "backward");
        return;
      }
      if (
        selectedIds.size > 0 &&
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
          translateDocument(documentRef.current, selectedIds, dx, dy),
          "Move selection",
          "nudge",
        );
      }
    };
    const releaseSpace = () => {
      spacePressedRef.current = false;
      setSpacePressed(false);
    };
    const cancelOnBlur = () => {
      releaseSpace();
      cancelInteraction();
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", releaseSpace);
    window.addEventListener("blur", cancelOnBlur);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", releaseSpace);
      window.removeEventListener("blur", cancelOnBlur);
    };
  }, [
    beginTextEditing,
    alignSelection,
    announce,
    canCopyStyle,
    canPasteStyle,
    canAlignSelection,
    canDistributeSelection,
    canOrthogonalizeConnector,
    canReverseConnector,
    canFlipSelection,
    changeLayer,
    cancelInteraction,
    closeContextMenu,
    clearSelection,
    copySelectedElements,
    copySelectedStyle,
    cutSelectedElements,
    editing,
    deleteSelected,
    duplicateSelected,
    exportAs,
    chooseImage,
    distributeSelection,
    groupSelected,
    lockSelection,
    markChange,
    menuOpen,
    contextMenu,
    onPresenceChange,
    openContextMenuFromSelection,
    orthogonalizeSelectedConnector,
    pasteSelectedStyle,
    pasteSelectedElements,
    resetSelectedStyle,
    reverseSelectedConnector,
    flipSelection,
    readOnly,
    redo,
    saveNow,
    selectAllElements,
    shapeMenuOpen,
    resetZoom,
    selection,
    selectedIds,
    showGrid,
    snapToGridEnabled,
    ungroupSelected,
    undo,
    unlockAll,
    zoomToContent,
    zoomToSelection,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        setViewport((value) =>
          zoomViewport(
            value,
            { x: event.clientX - rect.left, y: event.clientY - rect.top },
            event.deltaY > 0 ? "out" : "in",
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

  useEffect(() => {
    if (!contextMenu) return undefined;
    const closeMenus = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!contextMenuRef.current?.contains(target)) closeContextMenu();
    };
    window.addEventListener("pointerdown", closeMenus);
    return () => window.removeEventListener("pointerdown", closeMenus);
  }, [closeContextMenu, contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu) return;
    const menu = contextMenuRef.current;
    const container = canvasRef.current?.parentElement;
    if (!menu || !container) return;
    const margin = 8;
    const width =
      container.clientWidth || container.getBoundingClientRect().width;
    const height =
      container.clientHeight || container.getBoundingClientRect().height;
    const menuWidth = menu.offsetWidth || 240;
    const menuHeight = menu.offsetHeight || 360;
    const maxX = Math.max(margin, width - menuWidth - margin);
    const maxY = Math.max(margin, height - menuHeight - margin);
    const x = Math.min(Math.max(contextMenu.x, margin), maxX);
    const y = Math.min(Math.max(contextMenu.y, margin), maxY);
    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu({ x, y });
      return;
    }
    const firstItem = contextMenuItemsRef.current.find(
      (item) => item && !item.disabled,
    );
    (firstItem ?? menu).focus();
  }, [contextMenu]);

  function contextMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    event.stopPropagation();
    const items = contextMenuItemsRef.current.filter(
      (item): item is HTMLButtonElement => Boolean(item && !item.disabled),
    );
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      closeContextMenu();
      return;
    }
    if (items.length === 0) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const activeIndex = items.indexOf(
      window.document.activeElement as HTMLButtonElement,
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (activeIndex +
              (event.key === "ArrowDown" ? 1 : -1) +
              items.length) %
            items.length;
    items[nextIndex]?.focus();
  }

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

  function beginResize(
    event: ReactPointerEvent<HTMLElement>,
    handle: ResizeHandle,
  ): void {
    if (readOnly || editing || !canResizeSelection(selectedElements)) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    const start = movement(event, canvas.getBoundingClientRect(), viewport);
    canvas.setPointerCapture(event.pointerId);
    interactionRef.current = {
      kind: "resize",
      pointerId: event.pointerId,
      start,
      current: start,
      document: documentRef.current,
      elements: selectedElements,
      handle,
      keepAspectRatio: event.shiftKey,
    };
  }

  function beginEndpoint(
    event: ReactPointerEvent<HTMLElement>,
    endpoint: LinearEndpoint,
  ): void {
    if (readOnly || editing || selectedElements.length !== 1) return;
    const canvas = canvasRef.current;
    const element = selectedElements[0];
    if (
      !canvas ||
      !element ||
      (element.type !== "line" && element.type !== "arrow")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const start = movement(event, canvas.getBoundingClientRect(), viewport);
    canvas.setPointerCapture(event.pointerId);
    setEndpointSnap(null);
    interactionRef.current = {
      kind: "endpoint",
      pointerId: event.pointerId,
      start,
      current: start,
      document: documentRef.current,
      element,
      endpoint,
      targetId: null,
    };
  }

  function beginWaypoint(
    event: ReactPointerEvent<HTMLElement>,
    index: number,
    segmentIndex?: number,
    point?: Point,
  ): void {
    if (readOnly || editing || selectedElements.length !== 1) return;
    const canvas = canvasRef.current;
    const element = selectedElements[0];
    if (
      !canvas ||
      !element ||
      (element.type !== "line" && element.type !== "arrow")
    )
      return;
    const baseDocument = documentRef.current;
    const initialPoint = point ?? linearPoint(element, index);
    const inserted =
      segmentIndex === undefined
        ? { document: baseDocument, index, point: initialPoint }
        : insertLinearWaypoint(
            baseDocument,
            element.id,
            segmentIndex,
            initialPoint,
          );
    if (!inserted) return;
    event.preventDefault();
    event.stopPropagation();
    canvas.setPointerCapture(event.pointerId);
    if (segmentIndex !== undefined) setPreviewDocument(inserted.document);
    interactionRef.current = {
      kind: "waypoint",
      pointerId: event.pointerId,
      document: inserted.document,
      baseDocument,
      elementId: element.id,
      index: inserted.index,
    };
  }

  function addWaypointFromKeyboard(
    elementId: string,
    segmentIndex: number,
    point: Point,
  ): void {
    if (readOnly || editing) return;
    const inserted = insertLinearWaypoint(
      documentRef.current,
      elementId,
      segmentIndex,
      point,
    );
    if (inserted)
      markChange(
        inserted.document,
        "Add connector point",
        "waypoint:" + elementId,
      );
  }

  function handleWaypointKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    elementId: string,
    index: number,
  ): void {
    const point = documentRef.current.elements.find(
      (element): element is LinearElement =>
        element.id === elementId &&
        (element.type === "line" || element.type === "arrow"),
    );
    if (!point) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      const next = removeLinearWaypoint(documentRef.current, elementId, index);
      if (next)
        markChange(next, "Remove connector point", "waypoint:" + elementId);
      return;
    }
    const delta = event.shiftKey ? 10 : 1;
    const dx =
      event.key === "ArrowLeft"
        ? -delta
        : event.key === "ArrowRight"
          ? delta
          : 0;
    const dy =
      event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const current = linearPoint(point, index);
    const moved = moveLinearPoint(documentRef.current, elementId, index, {
      x: current.x + dx,
      y: current.y + dy,
    });
    if (moved)
      markChange(
        moved.document,
        "Move connector point",
        "waypoint:" + elementId,
      );
  }

  function handleEndpointKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    elementId: string,
    endpoint: LinearEndpoint,
  ): void {
    const delta = event.shiftKey ? 10 : 1;
    const dx =
      event.key === "ArrowLeft"
        ? -delta
        : event.key === "ArrowRight"
          ? delta
          : 0;
    const dy =
      event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const element = documentRef.current.elements.find(
      (candidate): candidate is LinearElement =>
        candidate.id === elementId &&
        (candidate.type === "line" || candidate.type === "arrow"),
    );
    if (!element) return;
    const current = linearEndpoint(element, endpoint);
    const moved = moveLinearEndpoint(documentRef.current, elementId, endpoint, {
      x: current.x + dx,
      y: current.y + dy,
    });
    if (moved)
      markChange(
        moved.document,
        "Move connector endpoint",
        "endpoint:" + elementId + ":" + endpoint,
      );
  }

  function beginRotate(event: ReactPointerEvent<HTMLElement>): void {
    if (readOnly || editing || selectedElements.length === 0) return;
    const canvas = canvasRef.current;
    const bounds = selectionBounds(documentRef.current, selectedIds);
    if (!canvas || !bounds || !canRotateSelection(selectedElements)) return;
    event.preventDefault();
    event.stopPropagation();
    const start = movement(event, canvas.getBoundingClientRect(), viewport);
    canvas.setPointerCapture(event.pointerId);
    interactionRef.current = {
      kind: "rotate",
      pointerId: event.pointerId,
      start,
      current: start,
      centre: {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      },
      document: documentRef.current,
      ids: new Set(selectedIds),
    };
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
        const next = deleteElements(documentRef.current, new Set([editing.id]));
        markChange(next, "Cancel text");
        if (editing.historyReset) historyRef.current.clear(next);
      } else if (editing.changed) {
        if (editing.historyReset) {
          if (current.text !== editing.cancelText) {
            const restored = updateElements(
              documentRef.current,
              new Set([editing.id]),
              (element) =>
                element.type === "text"
                  ? {
                      ...updateTextElement(element, editing.cancelText),
                      version: element.version + 1,
                      versionNonce: versionNonce(),
                    }
                  : element,
            );
            markChange(restored, "Cancel text edit");
            historyRef.current.clear(restored);
          } else {
            setDirty(editing.wasDirty);
            onSaveStateChange?.(editing.wasDirty);
          }
        } else {
          let target = historyRef.current.canUndo
            ? historyRef.current.undo()
            : null;
          const targetText = (
            candidate: DrawingDocument | null,
          ): string | null => {
            const element = candidate?.elements.find(
              (item): item is TextElement =>
                item.id === editing.id && item.type === "text",
            );
            return element?.text ?? null;
          };
          while (
            target &&
            targetText(target) !== editing.cancelText &&
            historyRef.current.canUndo
          ) {
            target = historyRef.current.undo();
          }
          if (!target || targetText(target) !== editing.cancelText) {
            target = updateElements(
              documentRef.current,
              new Set([editing.id]),
              (element) =>
                element.type === "text"
                  ? { ...element, text: editing.cancelText }
                  : element,
            );
          }
          if (target) {
            const restored = rebaseDrawingHistory(documentRef.current, target);
            documentRef.current = restored;
            setDocument(restored);
            setPreview(null);
            setDirty(editing.wasDirty);
            onSaveStateChange?.(editing.wasDirty);
            historyRef.current.replaceCurrent(restored, "Cancel text edit");
            onDocumentChange?.(restored, "Cancel text edit");
          } else {
            setDirty(editing.wasDirty);
            onSaveStateChange?.(editing.wasDirty);
          }
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
                versionNonce: versionNonce(),
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
    if (event.button !== 0 && event.button !== 1) return;
    setSelectionSnapGuides([]);
    setSelectionSpacingGuides([]);
    const rect = canvas.getBoundingClientRect();
    if (event.pointerType === "touch") {
      ignoredTouchPointersRef.current.delete(event.pointerId);
      if (pinchRef.current) {
        ignoredTouchPointersRef.current.add(event.pointerId);
        return;
      }
      const screenPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      if (activeTouchPointersRef.current.size === 0)
        touchStartToolRef.current = tool;
      activeTouchPointersRef.current.set(event.pointerId, screenPoint);
      if (activeTouchPointersRef.current.size >= 2) {
        const entries = [...activeTouchPointersRef.current.entries()].slice(-2);
        const first = entries[0];
        const second = entries[1];
        if (!first || !second) return;
        if (
          touchStartToolRef.current === "text" ||
          touchStartToolRef.current === "note"
        ) {
          activeTouchPointersRef.current.delete(event.pointerId);
          return;
        }
        if (interactionRef.current) cancelInteraction();
        activeTouchPointersRef.current.clear();
        activeTouchPointersRef.current.set(first[0], first[1]);
        activeTouchPointersRef.current.set(second[0], second[1]);
        const startMidpoint = midpoint(first[1], second[1]);
        pinchRef.current = {
          pointerIds: [first[0], second[0]],
          startDistance: Math.max(distance(first[1], second[1]), 1),
          startMidpoint,
          startWorld: screenToWorld(startMidpoint, viewport),
          startViewport: viewport,
        };
        canvas.setPointerCapture(first[0]);
        canvas.setPointerCapture(second[0]);
        event.preventDefault();
        setIsPanning(true);
        return;
      }
    }
    if (interactionRef.current) return;
    const rawStart = movement(event, rect, viewport);
    const start =
      snapToGridEnabled &&
      tool !== "select" &&
      tool !== "hand" &&
      tool !== "eraser" &&
      tool !== "freedraw"
        ? snapToGrid(rawStart)
        : rawStart;
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
      const canResize = canShowResizeHandles(selectedElements);
      const canRotate = canRotateSelection(selectedElements);
      if (!editing && (canResize || canRotate)) {
        const bounds = selectionBounds(documentRef.current, selectedIds);
        const screenPoint = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        const handleTarget =
          selectedElements.length === 1
            ? transformTargetFor(selectedElements[0]!)
            : bounds;
        if (
          handleTarget &&
          canRotate &&
          rotationHandleAt(
            handleTarget,
            screenPoint,
            viewport,
            canvasBounds(canvas),
          )
        ) {
          beginRotate(event);
          return;
        }
        const handle =
          canResize && bounds
            ? resizeHandleAt(handleTarget!, screenPoint, viewport)
            : null;
        if (handle) {
          beginResize(event, handle);
          return;
        }
      }
      const hit = hitTestScene(documentRef.current, start, 10 / viewport.zoom);
      if (hit) {
        const hitIds = expandSelectionToGroups(
          documentRef.current,
          new Set([hit.id]),
        );
        const next = new Set(selection);
        if (event.shiftKey) {
          const alreadySelected = [...hitIds].every((id) => next.has(id));
          for (const id of hitIds) {
            if (alreadySelected) next.delete(id);
            else next.add(id);
          }
        } else if (![...hitIds].every((id) => next.has(id))) {
          next.clear();
          for (const id of hitIds) next.add(id);
        }
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
      const text = createText(start.x, start.y, styleDefaultsRef.current);
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
        cancelText: text.text,
        historyReset: false,
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
      const note = createNote(start.x, start.y, styleDefaultsRef.current);
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
        cancelText: note.text,
        historyReset: false,
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
    if (event.pointerType === "touch") {
      if (ignoredTouchPointersRef.current.has(event.pointerId)) return;
      const screenPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      activeTouchPointersRef.current.set(event.pointerId, screenPoint);
      const pinch = pinchRef.current;
      if (pinch) {
        const first = activeTouchPointersRef.current.get(pinch.pointerIds[0]);
        const second = activeTouchPointersRef.current.get(pinch.pointerIds[1]);
        if (!first || !second) return;
        const currentMidpoint = midpoint(first, second);
        const zoom = Math.max(
          0.1,
          Math.min(
            8,
            pinch.startViewport.zoom *
              (distance(first, second) / pinch.startDistance),
          ),
        );
        setViewport({
          ...pinch.startViewport,
          zoom,
          scrollX: pinch.startWorld.x - currentMidpoint.x / zoom,
          scrollY: pinch.startWorld.y - currentMidpoint.y / zoom,
        });
        event.preventDefault();
        return;
      }
    }
    const interaction = interactionRef.current;
    if (interaction && interaction.pointerId !== event.pointerId) return;
    onPresenceChange?.({ cursor: current, selection: [...selectedIds] });
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
    } else if (interaction.kind === "resize") {
      const resizePoint = snapToGridEnabled ? snapToGrid(current) : current;
      interaction.current = resizePoint;
      interaction.keepAspectRatio = event.shiftKey;
      if (interaction.elements.length === 1) {
        const element = interaction.elements[0]!;
        const centre = {
          x: element.x + element.width / 2,
          y: element.y + element.height / 2,
        };
        const next = updateElements(
          interaction.document,
          new Set([element.id]),
          (currentElement) =>
            resizeElement(
              currentElement,
              interaction.handle,
              rotatePoint(resizePoint, centre, -element.angle),
              interaction.keepAspectRatio,
            ),
        );
        setPreviewDocument(syncBindings(next, new Set([element.id])));
      } else {
        setPreviewDocument(
          resizeElements(
            interaction.document,
            new Set(interaction.elements.map((element) => element.id)),
            interaction.handle,
            resizePoint,
            interaction.keepAspectRatio,
          ),
        );
      }
    } else if (interaction.kind === "endpoint") {
      const endpointPoint = snapToGridEnabled ? snapToGrid(current) : current;
      interaction.current = endpointPoint;
      const moved = moveLinearEndpoint(
        interaction.document,
        interaction.element.id,
        interaction.endpoint,
        endpointPoint,
      );
      interaction.targetId = moved.targetId;
      setEndpointSnap({ point: moved.point, targetId: moved.targetId });
      setPreviewDocument(moved.document);
    } else if (interaction.kind === "waypoint") {
      const waypointPoint = snapToGridEnabled ? snapToGrid(current) : current;
      const moved = moveLinearPoint(
        interaction.document,
        interaction.elementId,
        interaction.index,
        waypointPoint,
      );
      if (moved) setPreviewDocument(moved.document);
    } else if (interaction.kind === "rotate") {
      interaction.current = current;
      const startRadians = Math.atan2(
        interaction.start.y - interaction.centre.y,
        interaction.start.x - interaction.centre.x,
      );
      const currentRadians = Math.atan2(
        current.y - interaction.centre.y,
        current.x - interaction.centre.x,
      );
      const deltaDegrees = ((currentRadians - startRadians) * 180) / Math.PI;
      const snappedDelta = event.shiftKey
        ? Math.round(deltaDegrees / ROTATION_SNAP_DEGREES) *
          ROTATION_SNAP_DEGREES
        : deltaDegrees;
      const next = rotateElements(
        interaction.document,
        interaction.ids,
        snappedDelta,
        interaction.centre,
      );
      setPreviewDocument(next);
    } else if (interaction.kind === "drag") {
      interaction.current = current;
      const delta = snapSelectionTranslation(
        interaction.document,
        interaction.ids,
        current.x - interaction.start.x,
        current.y - interaction.start.y,
        {
          tolerance: OBJECT_SNAP_TOLERANCE_PX / Math.max(viewport.zoom, 0.1),
          snapToGrid: snapToGridEnabled,
          disabled: event.altKey,
        },
      );
      setSelectionSnapGuides(delta.guides);
      setSelectionSpacingGuides(delta.spacingGuides);
      setPreviewDocument(
        translateDocument(
          interaction.document,
          interaction.ids,
          delta.dx,
          delta.dy,
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
      const drawPoint =
        snapToGridEnabled && interaction.tool !== "freedraw"
          ? snapToGrid(current)
          : current;
      interaction.points.push(drawPoint);
      if (interaction.tool === "freedraw")
        setDraft(createFreedraw(interaction.points, styleDefaultsRef.current));
      else if (interaction.tool === "line" || interaction.tool === "arrow")
        setDraft(
          createLinear(
            interaction.tool,
            interaction.start,
            drawPoint,
            styleDefaultsRef.current,
          ),
        );
      else
        setDraft(
          createShape(
            interaction.tool,
            interaction.start,
            drawPoint,
            styleDefaultsRef.current,
          ),
        );
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    if (event.pointerType === "touch") {
      if (ignoredTouchPointersRef.current.delete(event.pointerId)) return;
      activeTouchPointersRef.current.delete(event.pointerId);
      const pinch = pinchRef.current;
      if (pinch && pinch.pointerIds.includes(event.pointerId)) {
        const pinchPointerIds = pinch.pointerIds;
        pinchRef.current = null;
        interactionRef.current = null;
        activeTouchPointersRef.current.clear();
        touchStartToolRef.current = null;
        for (const pinchPointerId of pinchPointerIds) {
          if (pinchPointerId !== event.pointerId)
            ignoredTouchPointersRef.current.add(pinchPointerId);
          if (canvas?.hasPointerCapture(pinchPointerId))
            canvas.releasePointerCapture(pinchPointerId);
        }
        setPreview(null);
        setEndpointSnap(null);
        setSelectionSnapGuides([]);
        setSelectionSpacingGuides([]);
        setDraft(null);
        setLasso(null);
        setIsPanning(false);
        if (canvas?.hasPointerCapture(event.pointerId))
          canvas.releasePointerCapture(event.pointerId);
        return;
      }
      if (activeTouchPointersRef.current.size === 0)
        touchStartToolRef.current = null;
    }
    const interaction = interactionRef.current;
    if (interaction && interaction.pointerId !== event.pointerId) return;
    if (!canvas || !interaction) {
      if (canvas?.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      setSelectionSnapGuides([]);
      setSelectionSpacingGuides([]);
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
        expandSelectionToGroups(
          documentRef.current,
          new Set(
            elementsInRect(
              documentRef.current,
              normalizeRect(interaction.start, interaction.current),
            ),
          ),
        ),
      );
      setSelection(next);
      onPresenceChange?.({
        cursor: movement(event, canvas.getBoundingClientRect(), viewport),
        selection: [...next],
      });
      setLasso(null);
    } else if (interaction.kind === "resize") {
      if (preview && preview !== interaction.document)
        markChange(preview, "Resize selection", "resize");
      historyRef.current.seal();
      setPreview(null);
    } else if (interaction.kind === "endpoint") {
      if (preview && preview !== interaction.document)
        markChange(
          preview,
          interaction.targetId ? "Connect endpoint" : "Move connector endpoint",
          "endpoint:" + interaction.element.id + ":" + interaction.endpoint,
        );
      historyRef.current.seal();
      setPreview(null);
      setEndpointSnap(null);
    } else if (interaction.kind === "waypoint") {
      const next = preview ?? interaction.document;
      if (next !== interaction.baseDocument)
        markChange(
          next,
          "Edit connector path",
          "waypoint:" + interaction.elementId,
        );
      historyRef.current.seal();
      setPreview(null);
    } else if (interaction.kind === "rotate") {
      if (preview && preview !== interaction.document)
        markChange(preview, "Rotate selection", "rotate");
      historyRef.current.seal();
      setPreview(null);
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
        const nextElement =
          current.type === "line" || current.type === "arrow"
            ? bindLinearElement(documentRef.current, current)
            : current;
        markChange(
          {
            ...documentRef.current,
            elements: [...documentRef.current.elements, nextElement],
          },
          "Add " + interaction.tool,
        );
        setSelection(new Set([nextElement.id]));
        onPresenceChange?.({
          cursor: movement(event, canvas.getBoundingClientRect(), viewport),
          selection: [nextElement.id],
        });
      }
    }
    setSelectionSnapGuides([]);
    setSelectionSpacingGuides([]);
  }

  function pointerCancel(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (event.pointerType === "touch") {
      const pinch = pinchRef.current;
      if (pinch) {
        if (pinch.pointerIds.includes(event.pointerId)) {
          cancelInteraction();
          ignoredTouchPointersRef.current.delete(event.pointerId);
        } else ignoredTouchPointersRef.current.delete(event.pointerId);
        return;
      }
      activeTouchPointersRef.current.delete(event.pointerId);
      ignoredTouchPointersRef.current.delete(event.pointerId);
      if (activeTouchPointersRef.current.size === 0)
        touchStartToolRef.current = null;
    }
    cancelInteraction(event.pointerId);
  }

  function lostPointerCapture(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): void {
    if (event.pointerType === "touch") {
      const pinch = pinchRef.current;
      if (pinch) {
        if (pinch.pointerIds.includes(event.pointerId)) cancelInteraction();
        return;
      }
      activeTouchPointersRef.current.delete(event.pointerId);
      if (activeTouchPointersRef.current.size === 0)
        touchStartToolRef.current = null;
    }
    cancelInteraction(event.pointerId);
  }

  function pointerLeave(): void {
    onPresenceChange?.({ cursor: null, selection: [...selectedIds] });
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

  function canvasContextMenu(event: ReactMouseEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = movement(event, canvas.getBoundingClientRect(), viewport);
    const hit = hitTestScene(
      documentRef.current,
      point,
      10 / Math.max(viewport.zoom, 0.1),
    );
    if (hit) {
      const hitIds = expandSelectionToGroups(
        documentRef.current,
        new Set([hit.id]),
      );
      const alreadySelected = [...hitIds].every((id) => selection.has(id));
      if (!alreadySelected) {
        const next = new Set(hitIds);
        setSelection(next);
        onPresenceChange?.({ cursor: point, selection: [...next] });
      }
    } else {
      setSelection(new Set());
      onPresenceChange?.({ cursor: point, selection: [] });
    }
    openContextMenuAt(event.clientX, event.clientY);
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
  const editingNote = editingElement?.customData?.variant === "note";
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
    ? editingNote
      ? Math.max(40, editingBounds.width - editingPadding * 2)
      : Math.max(1, editingBounds.width)
    : 1;
  const editingHeight = editingBounds
    ? editingNote
      ? Math.max(40, editingBounds.height - editingPadding * 2)
      : Math.max(editingElement?.style.fontSize ?? 24, editingBounds.height)
    : 24;
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
  const selectedBounds = selectionBounds(shown, selectedIds);
  const shownSelectedElements = selectedElements.map(
    (element) =>
      shown.elements.find((candidate) => candidate.id === element.id) ??
      element,
  );
  const showResizeHandles =
    !readOnly &&
    !editing &&
    canShowResizeHandles(selectedElements) &&
    selectedBounds !== null;
  const showRotateHandle =
    !readOnly &&
    !editing &&
    canRotateSelection(selectedElements) &&
    selectedBounds !== null;
  const transformTarget: TransformTarget | null =
    shownSelectedElements.length === 1
      ? transformTargetFor(shownSelectedElements[0]!)
      : selectedBounds;
  const selectedLinearElement: LinearElement | null =
    shownSelectedElements.length === 1 &&
    (shownSelectedElements[0]?.type === "line" ||
      shownSelectedElements[0]?.type === "arrow")
      ? (shownSelectedElements[0] as LinearElement)
      : null;
  const selectedLinearPoints = selectedLinearElement
    ? selectedLinearElement.points.map((_, index) =>
        linearPoint(selectedLinearElement, index),
      )
    : [];
  const showConnectorHandles =
    !readOnly &&
    !editing &&
    selectedLinearElement !== null &&
    selectedBounds !== null;
  const rotateHandle = showRotateHandle
    ? rotationHandlePosition(
        transformTarget!,
        viewport,
        canvasSize.width > 0 && canvasSize.height > 0
          ? canvasSize
          : canvasBounds(canvasRef.current),
      )
    : null;
  const bindingTarget = endpointSnap?.targetId
    ? shown.elements.find((element) => element.id === endpointSnap.targetId)
    : null;
  const bindingTargetBounds = bindingTarget
    ? elementBounds(bindingTarget)
    : null;
  const contextMenuItems: Array<
    | {
        kind: "item";
        key: string;
        label: string;
        icon: typeof Copy;
        shortcut?: string;
        disabled: boolean;
        action: () => void | Promise<void>;
      }
    | { kind: "divider"; key: string }
  > = [
    {
      kind: "item",
      key: "copy",
      label: "Copy selection",
      icon: Copy,
      shortcut: "⌘C",
      disabled: selectedIds.size === 0,
      action: copySelectedElements,
    },
    {
      kind: "item",
      key: "cut",
      label: "Cut selection",
      icon: Scissors,
      shortcut: "⌘X",
      disabled: !canMutateSelection,
      action: cutSelectedElements,
    },
    {
      kind: "item",
      key: "paste",
      label: "Paste selection",
      icon: Clipboard,
      shortcut: "⌘V",
      disabled: readOnly,
      action: () => pasteSelectedElements(),
    },
    {
      kind: "item",
      key: "replace-image",
      label: "Replace image",
      icon: ImageIcon,
      disabled: !canReplaceImage,
      action: chooseImageReplacement,
    },
    {
      kind: "item",
      key: "duplicate",
      label: "Duplicate selection",
      icon: Copy,
      shortcut: "⌘D",
      disabled: !canMutateSelection,
      action: duplicateSelected,
    },
    {
      kind: "item",
      key: "delete",
      label: "Delete selection",
      icon: Trash2,
      shortcut: "⌫",
      disabled: !canMutateSelection,
      action: deleteSelected,
    },
    { kind: "divider", key: "clipboard-divider" },
    {
      kind: "item",
      key: "group",
      label: "Group selection",
      icon: Menu,
      shortcut: "⌘G",
      disabled: !canMutateSelection || selectedIds.size < 2,
      action: groupSelected,
    },
    {
      kind: "item",
      key: "ungroup",
      label: "Ungroup selection",
      icon: Menu,
      shortcut: "⌘⇧G",
      disabled: !canMutateSelection || selectedGroupIds.length === 0,
      action: ungroupSelected,
    },
    {
      kind: "item",
      key: "lock",
      label: "Lock selection",
      icon: Lock,
      shortcut: "⌘⇧L",
      disabled: !canMutateSelection,
      action: lockSelection,
    },
    {
      kind: "item",
      key: "unlock",
      label: "Unlock all",
      icon: LockOpen,
      disabled: readOnly || !hasLockedElements,
      action: unlockAll,
    },
    { kind: "divider", key: "arrange-divider" },
    {
      kind: "item",
      key: "forward",
      label: "Bring forward",
      icon: ArrowUp,
      shortcut: "⌘]",
      disabled: !canMutateSelection,
      action: () => changeLayer("forward"),
    },
    {
      kind: "item",
      key: "backward",
      label: "Send backward",
      icon: ArrowDown,
      shortcut: "⌘[",
      disabled: !canMutateSelection,
      action: () => changeLayer("backward"),
    },
    {
      kind: "item",
      key: "front",
      label: "Bring to front",
      icon: ChevronsUp,
      shortcut: "⌘⇧]",
      disabled: !canMutateSelection,
      action: () => changeLayer("front"),
    },
    {
      kind: "item",
      key: "back",
      label: "Send to back",
      icon: ChevronsDown,
      shortcut: "⌘⇧[",
      disabled: !canMutateSelection,
      action: () => changeLayer("back"),
    },
    { kind: "divider", key: "alignment-divider" },
    {
      kind: "item",
      key: "align-left",
      label: "Align left",
      icon: AlignHorizontalJustifyStart,
      disabled: !canMutateSelection || !canAlignSelection,
      action: () => alignSelection("left"),
    },
    {
      kind: "item",
      key: "align-center",
      label: "Center horizontally",
      icon: AlignHorizontalJustifyCenter,
      disabled: !canMutateSelection || !canAlignSelection,
      action: () => alignSelection("center"),
    },
    {
      kind: "item",
      key: "align-right",
      label: "Align right",
      icon: AlignHorizontalJustifyEnd,
      disabled: !canMutateSelection || !canAlignSelection,
      action: () => alignSelection("right"),
    },
    {
      kind: "item",
      key: "align-top",
      label: "Align top",
      icon: AlignVerticalJustifyStart,
      disabled: !canMutateSelection || !canAlignSelection,
      action: () => alignSelection("top"),
    },
    {
      kind: "item",
      key: "align-middle",
      label: "Center vertically",
      icon: AlignVerticalJustifyCenter,
      disabled: !canMutateSelection || !canAlignSelection,
      action: () => alignSelection("middle"),
    },
    {
      kind: "item",
      key: "align-bottom",
      label: "Align bottom",
      icon: AlignVerticalJustifyEnd,
      disabled: !canMutateSelection || !canAlignSelection,
      action: () => alignSelection("bottom"),
    },
    {
      kind: "item",
      key: "distribute-horizontal",
      label: "Distribute horizontally",
      icon: AlignHorizontalSpaceBetween,
      disabled: !canMutateSelection || !canDistributeSelection,
      action: () => distributeSelection("horizontal"),
    },
    {
      kind: "item",
      key: "distribute-vertical",
      label: "Distribute vertically",
      icon: AlignVerticalSpaceBetween,
      disabled: !canMutateSelection || !canDistributeSelection,
      action: () => distributeSelection("vertical"),
    },
    { kind: "divider", key: "export-divider" },
    {
      kind: "item",
      key: "copy-image",
      label: "Copy selection as image",
      icon: Copy,
      disabled: selectedIds.size === 0,
      action: copySelectionAsImage,
    },
    {
      kind: "item",
      key: "download-selection",
      label: "Download selection PNG",
      icon: Download,
      disabled: selectedIds.size === 0,
      action: () => exportAs("png", "selection"),
    },
    {
      kind: "item",
      key: "clear",
      label: "Clear selection",
      icon: X,
      disabled: selectedIds.size === 0,
      action: clearSelection,
    },
  ];

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
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !historyRef.current.canUndo}
                  aria-keyshortcuts="Control+Z Meta+Z"
                  onClick={() => {
                    undo();
                    setMenuOpen(false);
                  }}
                >
                  <Undo2 size={15} aria-hidden="true" />
                  <span>Undo</span>
                  <kbd>⌘Z</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !historyRef.current.canRedo}
                  aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
                  onClick={() => {
                    redo();
                    setMenuOpen(false);
                  }}
                >
                  <Redo2 size={15} aria-hidden="true" />
                  <span>Redo</span>
                  <kbd>⌘⇧Z</kbd>
                </button>
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
                  role="menuitemcheckbox"
                  aria-checked={snapToGridEnabled}
                  className={styles.menuItem}
                  onClick={() => {
                    setSnapToGridEnabled((value) => !value);
                    setMenuOpen(false);
                  }}
                >
                  <Grid3x3 size={15} aria-hidden="true" />
                  <span>Snap to grid</span>
                  <kbd>⇧G</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  aria-keyshortcuts="0"
                  onClick={() => {
                    zoomToContent();
                    setMenuOpen(false);
                  }}
                >
                  <Maximize2 size={15} aria-hidden="true" />
                  <span>Fit to content</span>
                  <kbd>0</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={selectedIds.size === 0}
                  onClick={() => {
                    zoomToSelection();
                    setMenuOpen(false);
                  }}
                  aria-keyshortcuts="2"
                >
                  <Maximize2 size={15} aria-hidden="true" />
                  <span>Fit selection</span>
                  <kbd>2</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  aria-keyshortcuts="1"
                  onClick={() => {
                    resetZoom();
                    setMenuOpen(false);
                  }}
                >
                  <ZoomIn size={15} aria-hidden="true" />
                  <span>Reset zoom</span>
                  <kbd>1</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={!hasSelectableElements}
                  aria-keyshortcuts="Control+A Meta+A"
                  onClick={() => {
                    selectAllElements();
                    setMenuOpen(false);
                  }}
                >
                  <MousePointer2 size={15} aria-hidden="true" />
                  <span>Select all</span>
                  <kbd>⌘A</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={selectedIds.size === 0}
                  aria-keyshortcuts="Escape"
                  onClick={() => {
                    clearSelection();
                    setMenuOpen(false);
                  }}
                >
                  <X size={15} aria-hidden="true" />
                  <span>Clear selection</span>
                  <kbd>Esc</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={selectedIds.size === 0}
                  aria-keyshortcuts="Control+C Meta+C"
                  onClick={() => {
                    copySelectedElements();
                    setMenuOpen(false);
                  }}
                >
                  <Copy size={15} aria-hidden="true" />
                  <span>Copy selection</span>
                  <kbd>⌘C</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || selectedIds.size === 0}
                  aria-keyshortcuts="Control+X Meta+X"
                  onClick={() => {
                    cutSelectedElements();
                    setMenuOpen(false);
                  }}
                >
                  <Scissors size={15} aria-hidden="true" />
                  <span>Cut selection</span>
                  <kbd>⌘X</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly}
                  aria-keyshortcuts="Control+V Meta+V"
                  onClick={() => {
                    void pasteSelectedElements();
                    setMenuOpen(false);
                  }}
                >
                  <Clipboard size={15} aria-hidden="true" />
                  <span>Paste selection</span>
                  <kbd>⌘V</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly}
                  aria-keyshortcuts="Control+Shift+V Meta+Shift+V"
                  onClick={() => {
                    void pasteSelectedElements(0, true);
                    setMenuOpen(false);
                  }}
                >
                  <Clipboard size={15} aria-hidden="true" />
                  <span>Paste in place</span>
                  <kbd>⌘⇧V</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={!canReplaceImage}
                  onClick={() => {
                    chooseImageReplacement();
                    setMenuOpen(false);
                  }}
                >
                  <ImageIcon size={15} aria-hidden="true" />
                  <span>Replace image</span>
                </button>
                <div className={styles.menuDivider} />
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || selectedIds.size < 2}
                  aria-keyshortcuts="Control+G Meta+G"
                  onClick={() => {
                    groupSelected();
                    setMenuOpen(false);
                  }}
                >
                  <Menu size={15} aria-hidden="true" />
                  <span>Group selection</span>
                  <kbd>⌘G</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || selectedGroupIds.length === 0}
                  aria-keyshortcuts="Control+Shift+G Meta+Shift+G"
                  onClick={() => {
                    ungroupSelected();
                    setMenuOpen(false);
                  }}
                >
                  <Menu size={15} aria-hidden="true" />
                  <span>Ungroup selection</span>
                  <kbd>⌘⇧G</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || selectedIds.size === 0}
                  aria-keyshortcuts="Control+D Meta+D"
                  onClick={() => {
                    duplicateSelected();
                    setMenuOpen(false);
                  }}
                >
                  <Copy size={15} aria-hidden="true" />
                  <span>Duplicate selection</span>
                  <kbd>⌘D</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || selectedIds.size === 0}
                  aria-keyshortcuts="Backspace Delete"
                  onClick={() => {
                    deleteSelected();
                    setMenuOpen(false);
                  }}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  <span>Delete selection</span>
                  <kbd>⌫</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || selectedIds.size === 0}
                  aria-keyshortcuts="Control+Shift+L Meta+Shift+L"
                  onClick={() => {
                    lockSelection();
                    setMenuOpen(false);
                  }}
                >
                  <Lock size={15} aria-hidden="true" />
                  <span>Lock selection</span>
                  <kbd>⌘⇧L</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !hasLockedElements}
                  onClick={() => {
                    unlockAll();
                    setMenuOpen(false);
                  }}
                >
                  <LockOpen size={15} aria-hidden="true" />
                  <span>Unlock all</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={!canCopyStyle}
                  aria-keyshortcuts="Alt+Shift+C"
                  onClick={() => {
                    copySelectedStyle();
                    setMenuOpen(false);
                  }}
                >
                  <Paintbrush size={15} aria-hidden="true" />
                  <span>Copy visual style</span>
                  <kbd>⌥⇧C</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canPasteStyle}
                  aria-keyshortcuts="Alt+Shift+P"
                  onClick={() => {
                    pasteSelectedStyle();
                    setMenuOpen(false);
                  }}
                >
                  <Clipboard size={15} aria-hidden="true" />
                  <span>Paste visual style</span>
                  <kbd>⌥⇧P</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || selectedIds.size === 0}
                  aria-keyshortcuts="Alt+Shift+0"
                  onClick={() => {
                    resetSelectedStyle();
                    setMenuOpen(false);
                  }}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  <span>Reset visual style</span>
                  <kbd>⌥⇧0</kbd>
                </button>
                <div className={styles.menuDivider} />
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canAlignSelection}
                  aria-keyshortcuts="Alt+Shift+ArrowLeft"
                  onClick={() => {
                    alignSelection("left");
                    setMenuOpen(false);
                  }}
                >
                  <AlignHorizontalJustifyStart size={15} aria-hidden="true" />
                  <span>Align left</span>
                  <kbd>⌥⇧←</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canAlignSelection}
                  aria-keyshortcuts="Alt+Shift+H"
                  onClick={() => {
                    alignSelection("center");
                    setMenuOpen(false);
                  }}
                >
                  <AlignHorizontalJustifyCenter size={15} aria-hidden="true" />
                  <span>Center horizontally</span>
                  <kbd>⌥⇧H</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canAlignSelection}
                  aria-keyshortcuts="Alt+Shift+ArrowRight"
                  onClick={() => {
                    alignSelection("right");
                    setMenuOpen(false);
                  }}
                >
                  <AlignHorizontalJustifyEnd size={15} aria-hidden="true" />
                  <span>Align right</span>
                  <kbd>⌥⇧→</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canAlignSelection}
                  aria-keyshortcuts="Alt+Shift+ArrowUp"
                  onClick={() => {
                    alignSelection("top");
                    setMenuOpen(false);
                  }}
                >
                  <AlignVerticalJustifyStart size={15} aria-hidden="true" />
                  <span>Align top</span>
                  <kbd>⌥⇧↑</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canAlignSelection}
                  aria-keyshortcuts="Alt+Shift+V"
                  onClick={() => {
                    alignSelection("middle");
                    setMenuOpen(false);
                  }}
                >
                  <AlignVerticalJustifyCenter size={15} aria-hidden="true" />
                  <span>Center vertically</span>
                  <kbd>⌥⇧V</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canAlignSelection}
                  aria-keyshortcuts="Alt+Shift+ArrowDown"
                  onClick={() => {
                    alignSelection("bottom");
                    setMenuOpen(false);
                  }}
                >
                  <AlignVerticalJustifyEnd size={15} aria-hidden="true" />
                  <span>Align bottom</span>
                  <kbd>⌥⇧↓</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canDistributeSelection}
                  aria-keyshortcuts="Alt+Shift+X"
                  onClick={() => {
                    distributeSelection("horizontal");
                    setMenuOpen(false);
                  }}
                >
                  <AlignHorizontalSpaceBetween size={15} aria-hidden="true" />
                  <span>Distribute horizontally</span>
                  <kbd>⌥⇧X</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canDistributeSelection}
                  aria-keyshortcuts="Alt+Shift+Y"
                  onClick={() => {
                    distributeSelection("vertical");
                    setMenuOpen(false);
                  }}
                >
                  <AlignVerticalSpaceBetween size={15} aria-hidden="true" />
                  <span>Distribute vertically</span>
                  <kbd>⌥⇧Y</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canOrthogonalizeConnector}
                  aria-keyshortcuts="Alt+Shift+O"
                  onClick={() => {
                    orthogonalizeSelectedConnector();
                    setMenuOpen(false);
                  }}
                >
                  <Route size={15} aria-hidden="true" />
                  <span>Orthogonalize connector</span>
                  <kbd>⌥⇧O</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canReverseConnector}
                  aria-keyshortcuts="Alt+Shift+R"
                  onClick={() => {
                    reverseSelectedConnector();
                    setMenuOpen(false);
                  }}
                >
                  <ArrowLeftRight size={15} aria-hidden="true" />
                  <span>Reverse connector direction</span>
                  <kbd>⌥⇧R</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canFlipSelection}
                  aria-keyshortcuts="Alt+Shift+F"
                  onClick={() => {
                    flipSelection("horizontal");
                    setMenuOpen(false);
                  }}
                >
                  <FlipHorizontal2 size={15} aria-hidden="true" />
                  <span>Flip horizontally</span>
                  <kbd>⌥⇧F</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canFlipSelection}
                  aria-keyshortcuts="Alt+Shift+M"
                  onClick={() => {
                    flipSelection("vertical");
                    setMenuOpen(false);
                  }}
                >
                  <FlipVertical2 size={15} aria-hidden="true" />
                  <span>Flip vertically</span>
                  <kbd>⌥⇧M</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || !canResetRotation}
                  onClick={() => {
                    resetSelectionRotation();
                    setMenuOpen(false);
                  }}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  <span>Reset rotation</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || selectedIds.size === 0}
                  aria-keyshortcuts="Control+] Meta+]"
                  onClick={() => {
                    changeLayer("forward");
                    setMenuOpen(false);
                  }}
                >
                  <ArrowUp size={15} aria-hidden="true" />
                  <span>Bring forward</span>
                  <kbd>⌘]</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || selectedIds.size === 0}
                  aria-keyshortcuts="Control+[ Meta+["
                  onClick={() => {
                    changeLayer("backward");
                    setMenuOpen(false);
                  }}
                >
                  <ArrowDown size={15} aria-hidden="true" />
                  <span>Send backward</span>
                  <kbd>⌘[</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || selectedIds.size === 0}
                  aria-keyshortcuts="Control+Shift+] Meta+Shift+]"
                  onClick={() => {
                    changeLayer("front");
                    setMenuOpen(false);
                  }}
                >
                  <ChevronsUp size={15} aria-hidden="true" />
                  <span>Bring to front</span>
                  <kbd>⌘⇧]</kbd>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly || selectedIds.size === 0}
                  aria-keyshortcuts="Control+Shift+[ Meta+Shift+["
                  onClick={() => {
                    changeLayer("back");
                    setMenuOpen(false);
                  }}
                >
                  <ChevronsDown size={15} aria-hidden="true" />
                  <span>Send to back</span>
                  <kbd>⌘⇧[</kbd>
                </button>
                <div className={styles.menuDivider} />
                <label
                  className={styles.menuItem}
                  role="menuitem"
                  aria-label="Background color"
                >
                  <Circle size={15} aria-hidden="true" />
                  <span>Background color</span>
                  <input
                    type="color"
                    value={colorInputValue(document.background, "#ffffff")}
                    disabled={readOnly}
                    aria-label="Background color picker"
                    onChange={(event) =>
                      changeBackground(event.currentTarget.value)
                    }
                  />
                </label>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  className={styles.menuItem}
                  aria-checked={transparentExport}
                  onClick={() => setTransparentExport((value) => !value)}
                >
                  <Grid3x3 size={15} aria-hidden="true" />
                  <span>Transparent background</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    void exportAs("png");
                    setMenuOpen(false);
                  }}
                  aria-keyshortcuts="Control+Shift+E Meta+Shift+E"
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
                  disabled={selectedIds.size === 0}
                  onClick={() => {
                    void exportAs("png", "selection");
                    setMenuOpen(false);
                  }}
                >
                  <Download size={15} aria-hidden="true" />
                  <span>Download selection PNG</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={selectedIds.size === 0}
                  onClick={() => {
                    void copySelectionAsImage();
                    setMenuOpen(false);
                  }}
                >
                  <Copy size={15} aria-hidden="true" />
                  <span>Copy selection as image</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={selectedIds.size === 0}
                  onClick={() => {
                    void exportAs("svg", "selection");
                    setMenuOpen(false);
                  }}
                >
                  <Download size={15} aria-hidden="true" />
                  <span>Export selection SVG</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={selectedIds.size === 0}
                  onClick={() => {
                    void exportAs("json", "selection");
                    setMenuOpen(false);
                  }}
                >
                  <Menu size={15} aria-hidden="true" />
                  <span>Export selection JSON</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={readOnly}
                  onClick={() => {
                    importInputRef.current?.click();
                    setMenuOpen(false);
                  }}
                >
                  <Upload size={15} aria-hidden="true" />
                  <span>Import source JSON</span>
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
        <button
          type="button"
          className={styles.toolButton}
          title="Insert image (I)"
          aria-label="Insert image (I)"
          aria-keyshortcuts="I"
          data-tooltip="Insert image (I)"
          disabled={readOnly || !onUploadImage || imageBusy}
          onClick={chooseImage}
        >
          <ImageIcon size={17} aria-hidden="true" />
          <kbd className={styles.toolShortcut} aria-hidden="true">
            I
          </kbd>
        </button>
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
          onLostPointerCapture={lostPointerCapture}
          onDragOver={handleImageDragOver}
          onDrop={handleImageDrop}
          onDoubleClick={doubleClick}
          onContextMenu={canvasContextMenu}
        />
        {contextMenu ? (
          <div
            ref={contextMenuRef}
            className={styles.contextMenu}
            role="menu"
            aria-label="Canvas context menu"
            tabIndex={-1}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onKeyDown={contextMenuKeyDown}
          >
            {contextMenuItems.map((item) => {
              if (item.kind === "divider")
                return <div key={item.key} className={styles.menuDivider} />;
              const Icon = item.icon;
              const itemIndex = contextMenuItems
                .slice(0, contextMenuItems.indexOf(item))
                .filter((entry) => entry.kind === "item").length;
              return (
                <button
                  key={item.key}
                  ref={(element) => {
                    contextMenuItemsRef.current[itemIndex] = element;
                  }}
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={item.disabled}
                  onClick={() => executeContextAction(item.action)}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {selectionSnapGuides.map((guide, index) => {
          const position = worldToScreen(
            guide.axis === "vertical"
              ? { x: guide.position, y: viewport.scrollY }
              : { x: viewport.scrollX, y: guide.position },
            viewport,
          );
          return (
            <div
              key={`${guide.axis}-${guide.targetId}-${index}`}
              className={styles.snapGuide}
              data-axis={guide.axis}
              data-testid={`selection-snap-guide-${guide.axis}`}
              data-target-id={guide.targetId}
              aria-hidden="true"
              style={{ left: position.x, top: position.y }}
            />
          );
        })}
        {selectionSpacingGuides.map((guide, index) => {
          const points = spacingGuidePoints(guide, viewport);
          const horizontal = guide.axis === "horizontal";
          const lineStyle = (start: Point, end: Point) =>
            horizontal
              ? {
                  left: Math.min(start.x, end.x),
                  top: start.y,
                  width: Math.max(1, Math.abs(end.x - start.x)),
                }
              : {
                  left: start.x,
                  top: Math.min(start.y, end.y),
                  height: Math.max(1, Math.abs(end.y - start.y)),
                };
          const labelPoint = {
            x: (points.first[0].x + points.first[1].x) / 2,
            y: (points.first[0].y + points.first[1].y) / 2,
          };
          return (
            <div
              key={`${guide.axis}-${guide.start}-${guide.end}-${index}`}
              className={styles.spacingGuide}
              data-axis={guide.axis}
              data-testid={`selection-spacing-guide-${guide.axis}`}
              aria-hidden="true"
            >
              <span
                className={styles.spacingGuideLine}
                data-axis={guide.axis}
                style={lineStyle(points.first[0], points.first[1])}
              />
              <span
                className={styles.spacingGuideLine}
                data-axis={guide.axis}
                style={lineStyle(points.second[0], points.second[1])}
              />
              <span
                className={styles.spacingGuideLabel}
                style={
                  horizontal
                    ? { left: labelPoint.x, top: labelPoint.y - 8 }
                    : { left: labelPoint.x + 8, top: labelPoint.y }
                }
              >
                {Math.round(guide.gap)}
              </span>
            </div>
          );
        })}
        {(showResizeHandles || showRotateHandle || showConnectorHandles) &&
        selectedBounds ? (
          <div
            className={styles.selectionHandles}
            aria-label={
              selectedLinearElement ? "Edit connector path" : "Resize selection"
            }
          >
            {showRotateHandle ? (
              <button
                type="button"
                className={styles.rotateHandle}
                aria-label="Rotate selection"
                aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"
                data-tooltip="Rotate selection (←/→; Shift = 15°)"
                style={
                  rotateHandle
                    ? { left: rotateHandle.x, top: rotateHandle.y }
                    : undefined
                }
                onPointerDown={beginRotate}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  const step = event.shiftKey ? 15 : 1;
                  rotateSelectedBy(event.key === "ArrowLeft" ? -step : step);
                }}
              >
                <RotateCw size={12} aria-hidden="true" />
              </button>
            ) : null}
            {showResizeHandles
              ? RESIZE_HANDLES.map((handle) => {
                  const position = resizeHandlePosition(
                    transformTarget!,
                    handle,
                    viewport,
                  );
                  return (
                    <button
                      key={handle}
                      type="button"
                      className={styles.resizeHandle}
                      data-handle={handle}
                      aria-label={`Resize selection ${handle}`}
                      style={{ left: position.x, top: position.y }}
                      onPointerDown={(event) => beginResize(event, handle)}
                    />
                  );
                })
              : null}
            {selectedLinearElement
              ? (["start", "end"] as LinearEndpoint[]).map((endpoint) => {
                  const binding =
                    endpoint === "start"
                      ? selectedLinearElement.startBinding
                      : selectedLinearElement.endBinding;
                  const position = linearEndpointPosition(
                    selectedLinearElement,
                    endpoint,
                    viewport,
                  );
                  return (
                    <button
                      key={endpoint}
                      type="button"
                      className={styles.endpointHandle}
                      data-bound={binding ? "true" : "false"}
                      aria-label={`Connector endpoint ${endpoint}`}
                      title={`Move connector endpoint ${endpoint} with arrow keys`}
                      style={{ left: position.x, top: position.y }}
                      onPointerDown={(event) => beginEndpoint(event, endpoint)}
                      onKeyDown={(event) =>
                        handleEndpointKeyDown(
                          event,
                          selectedLinearElement.id,
                          endpoint,
                        )
                      }
                    />
                  );
                })
              : null}
            {selectedLinearElement
              ? selectedLinearPoints.slice(1, -1).map((point, offset) => {
                  const index = offset + 1;
                  const position = worldToScreen(point, viewport);
                  return (
                    <button
                      key={`waypoint-${index}`}
                      type="button"
                      className={styles.waypointHandle}
                      aria-label={`Move connector point ${index}`}
                      title="Move connector point. Arrow keys nudge it; Delete removes it."
                      style={{ left: position.x, top: position.y }}
                      onPointerDown={(event) => beginWaypoint(event, index)}
                      onKeyDown={(event) =>
                        handleWaypointKeyDown(
                          event,
                          selectedLinearElement.id,
                          index,
                        )
                      }
                    />
                  );
                })
              : null}
            {selectedLinearElement
              ? selectedLinearPoints.slice(0, -1).map((point, index) => {
                  const next = selectedLinearPoints[index + 1]!;
                  const midpoint = {
                    x: (point.x + next.x) / 2,
                    y: (point.y + next.y) / 2,
                  };
                  const position = worldToScreen(midpoint, viewport);
                  return (
                    <button
                      key={`waypoint-add-${index}`}
                      type="button"
                      className={styles.waypointAddHandle}
                      aria-label={`Add connector point ${index + 1}`}
                      title="Add connector point"
                      style={{ left: position.x, top: position.y }}
                      onPointerDown={(event) =>
                        beginWaypoint(event, index + 1, index, midpoint)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          addWaypointFromKeyboard(
                            selectedLinearElement.id,
                            index,
                            midpoint,
                          );
                        }
                      }}
                    >
                      +
                    </button>
                  );
                })
              : null}
          </div>
        ) : null}
        {endpointSnap && bindingTargetBounds
          ? (() => {
              const topLeft = worldToScreen(
                { x: bindingTargetBounds.x, y: bindingTargetBounds.y },
                viewport,
              );
              const bottomRight = worldToScreen(
                {
                  x: bindingTargetBounds.x + bindingTargetBounds.width,
                  y: bindingTargetBounds.y + bindingTargetBounds.height,
                },
                viewport,
              );
              return (
                <div
                  className={styles.bindingGuide}
                  style={{
                    left: topLeft.x,
                    top: topLeft.y,
                    width: bottomRight.x - topLeft.x,
                    height: bottomRight.y - topLeft.y,
                  }}
                >
                  <span>Connected</span>
                </div>
              );
            })()
          : null}
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
              height: editingHeight * viewport.zoom,
              fontFamily: editingElement.style.fontFamily,
              fontSize: editingElement.style.fontSize * viewport.zoom,
              lineHeight: editingElement.style.lineHeight,
              textAlign: editingElement.style.textAlign,
              transform: `rotate(${editingElement.angle}deg)`,
              transformOrigin: "center center",
            }}
            aria-label="Edit text"
          />
        ) : null}
        <DrawingPropertiesPanel
          elements={selectedElements}
          readOnly={readOnly}
          onStyleChange={updateSelectedStyle}
          onAngleChange={updateSelectedRotation}
          onElementChange={updateSelectedElement}
        />
      </main>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        tabIndex={-1}
        aria-hidden="true"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void importDrawing(file);
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          const action = imageInputActionRef.current;
          imageInputActionRef.current = "insert";
          if (!file) return;
          if (action === "insert") void insertImageFile(file);
          else void replaceImageFile(file, action.replaceId);
        }}
      />
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
            setViewport((value) => zoomViewport(value, { x: 0, y: 0 }, "out"))
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
          aria-label="Reset zoom"
          data-tooltip="Reset zoom (1)"
          onClick={resetZoom}
        >
          1:1
        </button>
        <button
          type="button"
          className={styles.zoomButton}
          aria-label="Zoom in"
          data-tooltip="Zoom in"
          onClick={() =>
            setViewport((value) => zoomViewport(value, { x: 0, y: 0 }, "in"))
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
              : selectedIds.size
                ? selectedIds.size + " selected"
                : "Click and drag to draw"}
        </span>
        <span className={styles.srOnly} aria-live="polite">
          {announcement}
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
