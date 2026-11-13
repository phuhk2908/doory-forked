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
  locked?: boolean;
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

export type ImageElement = DrawingElementBase & {
  type: "image";
  /** References a metadata entry in `DrawingDocument.files`; image bytes stay outside the document. */
  fileId: string;
};

export type DrawingElement =
  | ShapeElement
  | LinearElement
  | FreedrawElement
  | TextElement
  | ImageElement;

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
  /** Explicit z-order metadata; omitted for legacy documents that never reordered layers. */
  order?: string[];
  orderVersion?: number;
  orderVersionNonce?: number;
}

/** A version-aware partial document used by the realtime transport. */
export interface DrawingDelta {
  schemaVersion: typeof DRAWING_SCHEMA_VERSION;
  elements: DrawingElement[];
  background?: string;
  /** Files are sent as a complete map because file removal is not element-mergeable. */
  files?: Record<string, DrawingFile>;
  /** Versioned z-order metadata, sent only when the layer order changed. */
  order?: string[];
  orderVersion?: number;
  orderVersionNonce?: number;
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

function safeFile(value: unknown): DrawingFile | null {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    typeof value.mime !== "string" ||
    typeof value.name !== "string" ||
    typeof value.url !== "string" ||
    value.id.length === 0 ||
    value.mime.length === 0 ||
    value.name.length === 0 ||
    value.url.length === 0 ||
    /^data:/iu.test(value.url)
  )
    return null;
  const width =
    finite(value.width) && value.width >= 0 ? value.width : undefined;
  const height =
    finite(value.height) && value.height >= 0 ? value.height : undefined;
  return {
    id: value.id.slice(0, 128),
    mime: value.mime.slice(0, 128),
    name: value.name.slice(0, 256),
    url: value.url.slice(0, 4096),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

function restoreFiles(value: unknown): Record<string, DrawingFile> | undefined {
  if (!record(value)) return undefined;
  const files: Record<string, DrawingFile> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (key.length === 0 || key.length > 128) continue;
    const file = safeFile(candidate);
    if (file) files[key] = file;
  }
  return Object.keys(files).length > 0 ? files : undefined;
}

function restoreOrder(
  value: unknown,
  elements: readonly DrawingElement[],
): Pick<DrawingDocument, "order" | "orderVersion" | "orderVersionNonce"> {
  if (!record(value) || !Array.isArray(value.order)) return {};
  const ids = new Set(elements.map((element) => element.id));
  const seen = new Set<string>();
  const order = value.order
    .filter(
      (id): id is string =>
        typeof id === "string" && id.length > 0 && id.length <= 128,
    )
    .filter((id) => {
      if (!ids.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, MAX_DRAWING_ELEMENTS);
  for (const element of elements)
    if (!seen.has(element.id)) order.push(element.id);
  if (order.length !== elements.length) return {};
  return {
    order,
    orderVersion:
      finite(value.orderVersion) && value.orderVersion >= 0
        ? Math.floor(value.orderVersion)
        : 0,
    orderVersionNonce:
      finite(value.orderVersionNonce) && value.orderVersionNonce >= 0
        ? Math.floor(value.orderVersionNonce)
        : 0,
  };
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
      "image",
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
    ...(value.locked === true ? { locked: true } : {}),
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
  if (value.type === "image") {
    if (
      typeof value.fileId !== "string" ||
      value.fileId.length === 0 ||
      value.fileId.length > 128
    )
      return null;
    return { ...common, type: "image", fileId: value.fileId };
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
  const order = restoreOrder(value, elements);
  return {
    schemaVersion: DRAWING_SCHEMA_VERSION,
    elements,
    background:
      typeof value.background === "string" ? value.background : "#ffffff",
    ...(restoreFiles(value.files) ? { files: restoreFiles(value.files) } : {}),
    ...order,
  };
}

/** Returns a complete, duplicate-free z-order for both legacy and new documents. */
export function drawingOrder(document: DrawingDocument): string[] {
  const ids = new Set(document.elements.map((element) => element.id));
  const seen = new Set<string>();
  const order = (document.order ?? [])
    .filter((id) => ids.has(id) && !seen.has(id))
    .map((id) => {
      seen.add(id);
      return id;
    });
  for (const element of document.elements)
    if (!seen.has(element.id)) order.push(element.id);
  return order;
}

/** Records a layer reorder as a versioned document-level mutation. */
export function updateDrawingOrder(
  document: DrawingDocument,
  elements: readonly DrawingElement[],
): DrawingDocument {
  const order = elements.map((element) => element.id);
  if (sameJson(drawingOrder(document), order)) return document;
  return {
    ...document,
    elements: [...elements],
    order,
    orderVersion: (document.orderVersion ?? 0) + 1,
    orderVersionNonce: versionNonce(),
  };
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

function reconcileIncomingFiles(
  localFiles: Readonly<Record<string, DrawingFile>> | undefined,
  incomingFiles: Readonly<Record<string, DrawingFile>> | undefined,
  incomingElements: readonly DrawingElement[],
): { files?: Record<string, DrawingFile>; elements: DrawingElement[] } {
  const files: Record<string, DrawingFile> = {};
  for (const [fileId, file] of Object.entries(localFiles ?? {}))
    files[fileId] = file.id === fileId ? file : { ...file, id: fileId };

  const fileIdMap = new Map<string, string>();
  for (const [fileId, file] of Object.entries(incomingFiles ?? {})) {
    const incoming = file.id === fileId ? file : { ...file, id: fileId };
    const existing = files[fileId];
    if (!existing) {
      files[fileId] = incoming;
      continue;
    }
    if (sameDrawingFile(existing, incoming)) continue;
    let nextId = newElementId();
    while (files[nextId] || fileIdMap.has(nextId)) nextId = newElementId();
    fileIdMap.set(fileId, nextId);
    files[nextId] = { ...incoming, id: nextId };
  }

  const elements = fileIdMap.size
    ? incomingElements.map((element) => {
        if (element.type !== "image") return element;
        const fileId = fileIdMap.get(element.fileId);
        return fileId ? { ...element, fileId } : element;
      })
    : [...incomingElements];
  return {
    ...(Object.keys(files).length > 0 ? { files } : {}),
    elements,
  };
}

function orderVersion(document: DrawingDocument): readonly [number, number] {
  return [document.orderVersion ?? 0, document.orderVersionNonce ?? 0];
}

function newerOrder(
  incoming: DrawingDocument,
  current: DrawingDocument,
): boolean {
  const [incomingVersion, incomingNonce] = orderVersion(incoming);
  const [currentVersion, currentNonce] = orderVersion(current);
  return (
    incomingVersion > currentVersion ||
    (incomingVersion === currentVersion && incomingNonce >= currentNonce)
  );
}

function orderElements(
  order: readonly string[],
  elements: readonly DrawingElement[],
): DrawingElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const seen = new Set<string>();
  const ordered: DrawingElement[] = [];
  for (const id of order) {
    const element = byId.get(id);
    if (!element || seen.has(id)) continue;
    seen.add(id);
    ordered.push(element);
  }
  for (const element of elements) {
    if (seen.has(element.id)) continue;
    seen.add(element.id);
    ordered.push(element);
  }
  return ordered;
}

/** Merge independent room snapshots without resurrecting a deleted element. */
export function mergeDrawingDocuments(
  current: DrawingDocument,
  incoming: DrawingDocument,
): DrawingDocument {
  const local = restoreDrawing(current);
  const remote = restoreDrawing(incoming);
  const reconciled = reconcileIncomingFiles(
    local.files,
    remote.files,
    remote.elements,
  );
  const remoteById = new Map(
    reconciled.elements.map((element) => [element.id, element]),
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
    ...reconciled.elements.filter((element) => !localIds.has(element.id)),
  );
  const incomingHasOrder = remote.order !== undefined;
  const currentHasOrder = local.order !== undefined;
  const selectedOrderDocument =
    incomingHasOrder && (!currentHasOrder || newerOrder(remote, local))
      ? remote
      : currentHasOrder
        ? local
        : null;
  const selectedOrder = selectedOrderDocument
    ? drawingOrder({ ...selectedOrderDocument, elements })
    : undefined;
  const orderedElements = selectedOrder
    ? orderElements(selectedOrder, elements)
    : elements;
  const merged: DrawingDocument = {
    ...remote,
    elements: orderedElements,
    files: reconciled.files,
  };
  if (selectedOrder && selectedOrderDocument) {
    merged.order = selectedOrder;
    merged.orderVersion = selectedOrderDocument.orderVersion ?? 0;
    merged.orderVersionNonce = selectedOrderDocument.orderVersionNonce ?? 0;
  } else {
    delete merged.order;
    delete merged.orderVersion;
    delete merged.orderVersionNonce;
  }
  return merged;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameElementContent(
  left: DrawingElement,
  right: DrawingElement,
): boolean {
  const {
    version: _leftVersion,
    versionNonce: _leftNonce,
    ...leftContent
  } = left;
  const {
    version: _rightVersion,
    versionNonce: _rightNonce,
    ...rightContent
  } = right;
  return sameJson(leftContent, rightContent);
}

/**
 * Applies a history snapshot as a new collaborative mutation.
 *
 * History stores old immutable snapshots, while room merging only accepts a
 * newer element version and keeps ids omitted from an incoming document. A
 * direct history restore would therefore be invisible remotely (or fail to
 * delete a newly-created element). Rebase the desired values onto the current
 * document, advancing every changed element and emitting tombstones for live
 * ids that the target snapshot no longer contains.
 */
export function rebaseDrawingHistory(
  current: DrawingDocument,
  target: DrawingDocument,
): DrawingDocument {
  const currentDocument = restoreDrawing(current);
  const targetDocument = restoreDrawing(target);
  const currentById = new Map(
    currentDocument.elements.map((element) => [element.id, element]),
  );
  const targetIds = new Set(
    targetDocument.elements.map((element) => element.id),
  );
  const elements = targetDocument.elements.map((targetElement) => {
    const currentElement = currentById.get(targetElement.id);
    if (!currentElement) {
      return {
        ...targetElement,
        version: targetElement.version + 1,
        versionNonce: versionNonce(),
      };
    }
    if (sameElementContent(currentElement, targetElement))
      return currentElement;
    return {
      ...targetElement,
      version: Math.max(currentElement.version, targetElement.version) + 1,
      versionNonce: versionNonce(),
    };
  });

  for (const currentElement of currentDocument.elements) {
    if (targetIds.has(currentElement.id)) continue;
    if (currentElement.isDeleted) {
      elements.push(currentElement);
      continue;
    }
    elements.push({
      ...currentElement,
      isDeleted: true,
      version: currentElement.version + 1,
      versionNonce: versionNonce(),
    });
  }

  const files = {
    ...(currentDocument.files ?? {}),
    ...(targetDocument.files ?? {}),
  };
  const currentOrder = drawingOrder(currentDocument);
  const targetOrder = drawingOrder(targetDocument);
  const orderChanged = !sameJson(currentOrder, targetOrder);
  const rebasedOrder = orderChanged ? targetOrder : currentOrder;
  const rebasedElements = orderElements(rebasedOrder, elements);
  const result: DrawingDocument = {
    ...targetDocument,
    elements: rebasedElements,
    ...(Object.keys(files).length > 0 ? { files } : {}),
  };
  if (
    rebasedOrder.length > 0 ||
    currentDocument.order !== undefined ||
    targetDocument.order !== undefined
  ) {
    result.order = rebasedOrder;
    result.orderVersion = orderChanged
      ? Math.max(
          currentDocument.orderVersion ?? 0,
          targetDocument.orderVersion ?? 0,
        ) + 1
      : (currentDocument.orderVersion ?? targetDocument.orderVersion ?? 0);
    result.orderVersionNonce = orderChanged
      ? versionNonce()
      : (currentDocument.orderVersionNonce ??
        targetDocument.orderVersionNonce ??
        0);
  }
  return result;
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
  const currentOrder = drawingOrder(current);
  const incomingOrder = drawingOrder(incoming);
  if (!sameJson(currentOrder, incomingOrder)) {
    delta.order = incomingOrder;
    delta.orderVersion = incoming.orderVersion ?? current.orderVersion ?? 0;
    delta.orderVersionNonce =
      incoming.orderVersionNonce ?? current.orderVersionNonce ?? 0;
  }
  return delta;
}

export function applyDrawingDelta(
  current: DrawingDocument,
  delta: DrawingDelta,
): DrawingDocument {
  const incoming: DrawingDocument = {
    schemaVersion: DRAWING_SCHEMA_VERSION,
    elements: delta.elements,
    background: delta.background ?? current.background,
    // A delta's file map is authoritative and complete. Apply it after the
    // element merge so a coincident ID cannot be remapped and then disappear
    // from the authoritative map.
  };
  const merged = mergeDrawingDocuments(current, incoming);
  const withOrder = { ...merged };
  if ("order" in delta && Array.isArray(delta.order)) {
    const candidate = {
      ...merged,
      order: delta.order,
      orderVersion: delta.orderVersion ?? 0,
      orderVersionNonce: delta.orderVersionNonce ?? 0,
    };
    if (current.order === undefined || newerOrder(candidate, current)) {
      const order = drawingOrder(candidate);
      withOrder.order = order;
      withOrder.orderVersion = candidate.orderVersion;
      withOrder.orderVersionNonce = candidate.orderVersionNonce;
      withOrder.elements = orderElements(order, merged.elements);
    }
  }
  if (!("files" in delta)) return withOrder;
  return {
    ...withOrder,
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
