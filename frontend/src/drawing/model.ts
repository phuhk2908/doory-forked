import { uuid } from "../lib/uuid";

export const DRAWING_SCHEMA_VERSION = 1 as const;
export const MAX_DRAWING_ELEMENTS = 10_000;
export const MAX_FREEHAND_POINTS = 20_000;
export const MAX_DRAWING_TEXT = 100_000;
export const DRAWING_NOTE_DEFAULT_TEXT = "New note";
export const DRAWING_NOTE_PADDING = 16;
export const DRAWING_NOTE_DATE_FONT_SIZE = 11;

export type DrawingTool =
  | "select"
  | "hand"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "line"
  | "arrow"
  | "freedraw"
  | "text"
  | "eraser"
  | "note";

export interface DrawingPoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface DrawingStyle {
  stroke: string;
  fill: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  opacity: number;
  roughness: number;
  roundness: number;
  fontFamily: string;
  fontSize: number;
  textAlign: "left" | "center" | "right";
  lineHeight: number;
}

interface DrawingElementBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  style: DrawingStyle;
  groupIds?: string[];
  isDeleted?: boolean;
  version: number;
  versionNonce: number;
  customData?: Record<string, unknown>;
}

export type ShapeElement = DrawingElementBase & {
  type: "rectangle" | "ellipse" | "diamond";
};

export type LinearElement = DrawingElementBase & {
  type: "line" | "arrow";
  points: DrawingPoint[];
  startArrowhead?: "arrow" | "triangle" | null;
  endArrowhead?: "arrow" | "triangle" | null;
  startBinding?: DrawingBinding | null;
  endBinding?: DrawingBinding | null;
};

export type FreedrawElement = DrawingElementBase & {
  type: "freedraw";
  points: DrawingPoint[];
};

export type TextElement = DrawingElementBase & {
  type: "text";
  text: string;
  originalText?: string;
};

export type DrawingElement =
  | ShapeElement
  | LinearElement
  | FreedrawElement
  | TextElement;

export interface DrawingBinding {
  elementId: string;
  focus: number;
  gap: number;
}

export interface DrawingFile {
  id: string;
  mime: string;
  name: string;
  url: string;
  width?: number;
  height?: number;
}

export interface DrawingDocument {
  schemaVersion: typeof DRAWING_SCHEMA_VERSION;
  elements: DrawingElement[];
  files?: Record<string, DrawingFile>;
  background: string;
}

/** A version-aware partial document used by the realtime transport. */
export interface DrawingDelta {
  schemaVersion: typeof DRAWING_SCHEMA_VERSION;
  elements: DrawingElement[];
  background?: string;
  /** Files are sent as a complete map because file removal is not element-mergeable. */
  files?: Record<string, DrawingFile>;
}

export interface DrawingChange {
  document: DrawingDocument;
  label: string;
  coalesceKey?: string;
}

export interface DrawingViewport {
  zoom: number;
  scrollX: number;
  scrollY: number;
}

export interface DrawingExportOptions {
  format: "json" | "png" | "svg";
  bounds?: "content" | "viewport";
  padding?: number;
  scale?: number;
  transparent?: boolean;
}

export const DEFAULT_STYLE: DrawingStyle = {
  stroke: "#1f2937",
  fill: "transparent",
  strokeWidth: 2,
  strokeStyle: "solid",
  opacity: 1,
  roughness: 1,
  roundness: 8,
  fontFamily: "Inter, sans-serif",
  fontSize: 24,
  textAlign: "left",
  lineHeight: 1.25,
};

export function blankDrawing(): DrawingDocument {
  return {
    schemaVersion: DRAWING_SCHEMA_VERSION,
    elements: [],
    background: "#ffffff",
  };
}

export function newElementId(): string {
  return uuid();
}

export function versionNonce(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function styleWith(overrides: Partial<DrawingStyle> = {}): DrawingStyle {
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<DrawingStyle>;
  return { ...DEFAULT_STYLE, ...definedOverrides };
}

export function createElement<T extends DrawingElement["type"]>(
  type: T,
  overrides: Record<string, unknown> = {},
): DrawingElement {
  const base = {
    id: newElementId(),
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    style: styleWith(),
    version: 1,
    versionNonce: versionNonce(),
    ...overrides,
  };
  return base as DrawingElement;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function point(value: unknown): value is DrawingPoint {
  return (
    record(value) &&
    finite(value.x) &&
    finite(value.y) &&
    (value.pressure === undefined || finite(value.pressure))
  );
}

function safeStyle(value: unknown): DrawingStyle {
  const source = record(value) ? value : {};
  return styleWith({
    stroke: typeof source.stroke === "string" ? source.stroke : undefined,
    fill: typeof source.fill === "string" ? source.fill : undefined,
    strokeWidth: finite(source.strokeWidth)
      ? Math.max(0.5, Math.min(64, source.strokeWidth))
      : undefined,
    strokeStyle:
      source.strokeStyle === "dashed" || source.strokeStyle === "dotted"
        ? source.strokeStyle
        : undefined,
    opacity: finite(source.opacity)
      ? Math.max(0, Math.min(1, source.opacity))
      : undefined,
    roughness: finite(source.roughness)
      ? Math.max(0, Math.min(3, source.roughness))
      : undefined,
    roundness: finite(source.roundness)
      ? Math.max(0, Math.min(64, source.roundness))
      : undefined,
    fontFamily:
      typeof source.fontFamily === "string"
        ? source.fontFamily.slice(0, 200)
        : undefined,
    fontSize: finite(source.fontSize)
      ? Math.max(8, Math.min(256, source.fontSize))
      : undefined,
    textAlign:
      source.textAlign === "center" || source.textAlign === "right"
        ? source.textAlign
        : undefined,
    lineHeight: finite(source.lineHeight)
      ? Math.max(0.8, Math.min(3, source.lineHeight))
      : undefined,
  });
}

function restoreElement(value: unknown): DrawingElement | null {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.type !== "string"
  )
    return null;
  if (
    ![
      "rectangle",
      "ellipse",
      "diamond",
      "line",
      "arrow",
      "freedraw",
      "text",
    ].includes(value.type)
  )
    return null;
  const x = value.x;
  const y = value.y;
  const width = value.width;
  const height = value.height;
  const angle = value.angle;
  if (
    !finite(x) ||
    !finite(y) ||
    !finite(width) ||
    !finite(height) ||
    !finite(angle)
  )
    return null;
  const common = {
    id: value.id.slice(0, 128),
    x,
    y,
    width,
    height,
    angle,
    style: safeStyle(value.style),
    groupIds: Array.isArray(value.groupIds)
      ? value.groupIds
          .filter((id): id is string => typeof id === "string")
          .slice(0, 32)
      : undefined,
    isDeleted: value.isDeleted === true,
    version: finite(value.version) ? Math.max(1, Math.floor(value.version)) : 1,
    versionNonce: finite(value.versionNonce)
      ? Math.floor(value.versionNonce)
      : versionNonce(),
    customData: record(value.customData) ? value.customData : undefined,
  };
  if (value.type === "text") {
    if (typeof value.text !== "string" || value.text.length > MAX_DRAWING_TEXT)
      return null;
    return {
      ...common,
      type: "text",
      text: value.text,
      originalText:
        typeof value.originalText === "string" ? value.originalText : undefined,
    };
  }
  if (
    value.type === "freedraw" ||
    value.type === "line" ||
    value.type === "arrow"
  ) {
    if (
      !Array.isArray(value.points) ||
      value.points.length === 0 ||
      value.points.length > MAX_FREEHAND_POINTS ||
      !value.points.every(point)
    )
      return null;
    const bindings = (
      candidate: unknown,
    ): DrawingBinding | null | undefined => {
      if (candidate === null) return null;
      if (
        !record(candidate) ||
        typeof candidate.elementId !== "string" ||
        !finite(candidate.focus) ||
        !finite(candidate.gap)
      )
        return undefined;
      return {
        elementId: candidate.elementId,
        focus: candidate.focus,
        gap: candidate.gap,
      };
    };
    return {
      ...common,
      type: value.type,
      points: value.points,
      ...(value.startArrowhead === "arrow" ||
      value.startArrowhead === "triangle"
        ? { startArrowhead: value.startArrowhead }
        : {}),
      ...(value.endArrowhead === "arrow" || value.endArrowhead === "triangle"
        ? { endArrowhead: value.endArrowhead }
        : {}),
      startBinding: bindings(value.startBinding),
      endBinding: bindings(value.endBinding),
    } as LinearElement | FreedrawElement;
  }
  return { ...common, type: value.type } as ShapeElement;
}

export function restoreDrawing(value: unknown): DrawingDocument {
  if (
    !record(value) ||
    value.schemaVersion !== DRAWING_SCHEMA_VERSION ||
    !Array.isArray(value.elements)
  )
    return blankDrawing();
  const ids = new Set<string>();
  const elements = value.elements
    .slice(0, MAX_DRAWING_ELEMENTS)
    .map(restoreElement)
    .filter((item): item is DrawingElement => {
      if (item === null || ids.has(item.id)) return false;
      ids.add(item.id);
      return true;
    });
  return {
    schemaVersion: DRAWING_SCHEMA_VERSION,
    elements,
    background:
      typeof value.background === "string" ? value.background : "#ffffff",
    ...(record(value.files)
      ? { files: value.files as Record<string, DrawingFile> }
      : {}),
  };
}

/** Merge independent room snapshots without resurrecting a deleted element. */
export function mergeDrawingDocuments(
  current: DrawingDocument,
  incoming: DrawingDocument,
): DrawingDocument {
  const local = restoreDrawing(current);
  const remote = restoreDrawing(incoming);
  const remoteById = new Map(
    remote.elements.map((element) => [element.id, element]),
  );
  const localIds = new Set(local.elements.map((element) => element.id));
  const elements = local.elements.map((element) => {
    const candidate = remoteById.get(element.id);
    if (!candidate) return element;
    const localVersion = [element.version, element.versionNonce] as const;
    const remoteVersion = [candidate.version, candidate.versionNonce] as const;
    return remoteVersion[0] > localVersion[0] ||
      (remoteVersion[0] === localVersion[0] &&
        remoteVersion[1] >= localVersion[1])
      ? candidate
      : element;
  });
  elements.push(
    ...remote.elements.filter((element) => !localIds.has(element.id)),
  );
  return {
    ...remote,
    elements,
    files:
      local.files || remote.files
        ? { ...(local.files ?? {}), ...(remote.files ?? {}) }
        : undefined,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function computeDrawingDelta(
  current: DrawingDocument,
  incoming: DrawingDocument,
): DrawingDelta {
  const currentById = new Map(
    current.elements.map((element) => [element.id, element]),
  );
  const elements = incoming.elements.filter(
    (element) => !sameJson(currentById.get(element.id), element),
  );
  const delta: DrawingDelta = {
    schemaVersion: DRAWING_SCHEMA_VERSION,
    elements,
  };
  if (current.background !== incoming.background) {
    delta.background = incoming.background;
  }
  if (!sameJson(current.files ?? {}, incoming.files ?? {})) {
    delta.files = incoming.files ?? {};
  }
  return delta;
}

export function applyDrawingDelta(
  current: DrawingDocument,
  delta: DrawingDelta,
): DrawingDocument {
  const merged = mergeDrawingDocuments(current, {
    schemaVersion: DRAWING_SCHEMA_VERSION,
    elements: delta.elements,
    background: delta.background ?? current.background,
    ...(delta.files ? { files: delta.files } : {}),
  });
  if (!("files" in delta)) return merged;
  return {
    ...merged,
    files:
      delta.files && Object.keys(delta.files).length > 0
        ? delta.files
        : undefined,
  };
}

export function updateElement(
  element: DrawingElement,
  patch: Partial<DrawingElement>,
): DrawingElement {
  return {
    ...element,
    ...patch,
    version: element.version + 1,
    versionNonce: versionNonce(),
  } as DrawingElement;
}
