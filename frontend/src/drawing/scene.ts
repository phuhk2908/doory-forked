import {
  createElement,
  styleWith,
  type DrawingDocument,
  type DrawingElement,
  type DrawingPoint,
  type DrawingStyle,
  newElementId,
  DRAWING_NOTE_DEFAULT_TEXT,
  type LinearElement,
  type TextElement,
  updateDrawingOrder,
  updateElement,
  versionNonce,
} from "./model";
import {
  snapToGrid,
  elementBounds,
  elementFrame,
  noteTextHeight,
  rotatePoint,
  selectionBounds,
} from "./geometry";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type LinearEndpoint = "start" | "end";

export type SelectionSnapGuideAxis = "vertical" | "horizontal";

export interface SelectionSnapGuide {
  axis: SelectionSnapGuideAxis;
  position: number;
  targetId: string;
}

export interface SelectionSpacingGuide {
  axis: SelectionSnapGuideAxis;
  start: number;
  movingStart: number;
  movingEnd: number;
  end: number;
  cross: number;
  gap: number;
}

export interface SelectionSnapResult {
  dx: number;
  dy: number;
  guides: SelectionSnapGuide[];
  spacingGuides: SelectionSpacingGuide[];
}

export interface SelectionSnapOptions {
  /** Distance in world units at which an object anchor can attract the selection. */
  tolerance?: number;
  /** Fall back to the document grid on an axis without an object snap. */
  snapToGrid?: boolean;
  gridSize?: number;
  /** Disable both object and grid snapping for precision movement. */
  disabled?: boolean;
}

const MIN_RESIZE_SIZE = 20;

const BINDING_TOLERANCE = 14;
const DEFAULT_SELECTION_SNAP_TOLERANCE = 8;

function hasHandlePart(handle: ResizeHandle, part: "n" | "e" | "s" | "w") {
  return handle.includes(part);
}

function isBindingTarget(element: DrawingElement): boolean {
  return (
    element.type === "rectangle" ||
    element.type === "ellipse" ||
    element.type === "diamond" ||
    element.type === "text"
  );
}

export function linearEndpoint(
  element: LinearElement,
  endpoint: LinearEndpoint,
): DrawingPoint {
  const index = endpoint === "start" ? 0 : element.points.length - 1;
  const point = element.points[index] ?? { x: 0, y: 0 };
  return { x: element.x + point.x, y: element.y + point.y };
}

export function linearPoint(
  element: LinearElement,
  index: number,
): DrawingPoint {
  const point = element.points[index] ?? { x: 0, y: 0 };
  return { x: element.x + point.x, y: element.y + point.y };
}

function pointsAreOrthogonal(points: readonly DrawingPoint[]): boolean {
  return (
    points.length >= 2 &&
    points.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    ) &&
    points.slice(1).every((point, index) => {
      const previous = points[index]!;
      return point.x === previous.x || point.y === previous.y;
    })
  );
}

function samePoint(left: DrawingPoint, right: DrawingPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function samePointList(
  left: readonly DrawingPoint[],
  right: readonly DrawingPoint[],
): boolean {
  return (
    left.length === right.length &&
    left.every((point, index) => samePoint(point, right[index]!))
  );
}

function bindingAnchor(
  target: DrawingElement,
  binding: NonNullable<LinearElement["startBinding"]>,
): DrawingPoint {
  const width = Math.max(1, target.width);
  const height = Math.max(1, target.height);
  const centre = {
    x: target.x + width / 2,
    y: target.y + height / 2,
  };
  const local = {
    x: target.x + Math.max(0, Math.min(1, binding.focus)) * width,
    y: target.y + Math.max(0, Math.min(1, binding.gap)) * height,
  };
  const dx = local.x - centre.x;
  const dy = local.y - centre.y;
  const normalizedX = dx / (width / 2);
  const normalizedY = dy / (height / 2);
  const scale =
    target.type === "ellipse"
      ? 1 / Math.max(0.001, Math.hypot(normalizedX, normalizedY))
      : target.type === "diamond"
        ? 1 / Math.max(0.001, Math.abs(normalizedX) + Math.abs(normalizedY))
        : 1 / Math.max(0.001, Math.abs(normalizedX), Math.abs(normalizedY));
  return rotatePoint(
    {
      x: centre.x + dx * scale,
      y: centre.y + dy * scale,
    },
    centre,
    target.angle,
  );
}

function bindingForPoint(
  target: DrawingElement,
  point: DrawingPoint,
): NonNullable<LinearElement["startBinding"]> {
  const centre = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  };
  const local = rotatePoint(point, centre, -target.angle);
  return {
    elementId: target.id,
    focus: Math.max(
      0,
      Math.min(1, (local.x - target.x) / Math.max(1, target.width)),
    ),
    gap: Math.max(
      0,
      Math.min(1, (local.y - target.y) / Math.max(1, target.height)),
    ),
  };
}

function findBindingTarget(
  document: DrawingDocument,
  point: DrawingPoint,
  excludedId: string,
): DrawingElement | null {
  return (
    [...document.elements].reverse().find((element) => {
      if (
        element.id === excludedId ||
        element.isDeleted ||
        !isBindingTarget(element)
      )
        return false;
      const centre = {
        x: element.x + element.width / 2,
        y: element.y + element.height / 2,
      };
      const local = rotatePoint(point, centre, -element.angle);
      return (
        local.x >= element.x - BINDING_TOLERANCE &&
        local.x <= element.x + element.width + BINDING_TOLERANCE &&
        local.y >= element.y - BINDING_TOLERANCE &&
        local.y <= element.y + element.height + BINDING_TOLERANCE
      );
    }) ?? null
  );
}

function withEndpoint(
  element: LinearElement,
  index: number,
  point: DrawingPoint,
): LinearElement {
  const points = element.points.map((item, pointIndex) =>
    pointIndex === index ? { ...item, x: point.x, y: point.y } : { ...item },
  );
  const worldPoints = points.map((item) => ({
    x: element.x + item.x,
    y: element.y + item.y,
  }));
  worldPoints[index] = point;
  const x = Math.min(...worldPoints.map((item) => item.x));
  const y = Math.min(...worldPoints.map((item) => item.y));
  return {
    ...element,
    x,
    y,
    width: Math.max(...worldPoints.map((item) => item.x)) - x,
    height: Math.max(...worldPoints.map((item) => item.y)) - y,
    points: worldPoints.map((item) => ({
      x: item.x - x,
      y: item.y - y,
    })),
  };
}

function withLinearPoints(
  element: LinearElement,
  worldPoints: readonly DrawingPoint[],
): LinearElement {
  const x = Math.min(...worldPoints.map((point) => point.x));
  const y = Math.min(...worldPoints.map((point) => point.y));
  return {
    ...element,
    x,
    y,
    width: Math.max(...worldPoints.map((point) => point.x)) - x,
    height: Math.max(...worldPoints.map((point) => point.y)) - y,
    points: worldPoints.map((point) => ({
      x: point.x - x,
      y: point.y - y,
    })),
  };
}

/**
 * Replace a connector's path with a deterministic Manhattan route.
 *
 * This is intentionally a one-shot edit: it preserves the endpoints and
 * connector metadata, but it does not avoid shapes or reroute after a target
 * moves. Unsupported, locked, rotated, already-orthogonal, and degenerate
 * connectors return the original document so callers can safely use this as a
 * command seam without creating a history entry for a no-op.
 */
export function orthogonalizeConnector(
  document: DrawingDocument,
  elementId: string,
): DrawingDocument {
  const element = document.elements.find(
    (candidate): candidate is LinearElement =>
      candidate.id === elementId &&
      !candidate.isDeleted &&
      !candidate.locked &&
      candidate.angle === 0 &&
      (candidate.type === "line" || candidate.type === "arrow"),
  );
  if (!element || element.points.length < 2) return document;

  const start = linearEndpoint(element, "start");
  const end = linearEndpoint(element, "end");
  if (
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y) ||
    samePoint(start, end) ||
    pointsAreOrthogonal(element.points)
  )
    return document;

  const horizontalDistance = Math.abs(end.x - start.x);
  const verticalDistance = Math.abs(end.y - start.y);
  const route =
    horizontalDistance >= verticalDistance
      ? [start, { x: end.x, y: start.y }, end]
      : [start, { x: start.x, y: end.y }, end];
  const points = route.filter(
    (point, index) => index === 0 || !samePoint(point, route[index - 1]!),
  );
  if (
    points.length < 2 ||
    samePointList(
      points,
      element.points.map((point) => ({
        x: element.x + point.x,
        y: element.y + point.y,
      })),
    )
  )
    return document;

  const nextElement = {
    ...withLinearPoints(element, points),
    version: element.version + 1,
    versionNonce: versionNonce(),
  };
  return replaceElements(
    document,
    document.elements.map((candidate) =>
      candidate.id === elementId ? nextElement : candidate,
    ),
  );
}

/** Reverse a connector's direction while preserving its path and metadata. */
export function reverseConnector(
  document: DrawingDocument,
  elementId: string,
): DrawingDocument {
  const element = document.elements.find(
    (candidate): candidate is LinearElement =>
      candidate.id === elementId &&
      !candidate.isDeleted &&
      !candidate.locked &&
      candidate.angle === 0 &&
      (candidate.type === "line" || candidate.type === "arrow"),
  );
  if (!element || element.points.length < 2) return document;

  const worldPoints = element.points.map((_, index) =>
    linearPoint(element, index),
  );
  const nextElement = {
    ...withLinearPoints(element, [...worldPoints].reverse()),
    startBinding: element.endBinding ?? null,
    endBinding: element.startBinding ?? null,
    startArrowhead: element.endArrowhead ?? null,
    endArrowhead: element.startArrowhead ?? null,
    version: element.version + 1,
    versionNonce: versionNonce(),
  };
  return replaceElements(
    document,
    document.elements.map((candidate) =>
      candidate.id === elementId ? nextElement : candidate,
    ),
  );
}

function isFlippableElement(element: DrawingElement): boolean {
  return (
    element.type === "rectangle" ||
    element.type === "ellipse" ||
    element.type === "diamond" ||
    element.type === "image" ||
    element.type === "line" ||
    element.type === "arrow" ||
    element.type === "freedraw"
  );
}

function reflectedPoint(
  point: DrawingPoint,
  centre: DrawingPoint,
  axis: "horizontal" | "vertical",
): DrawingPoint {
  return axis === "horizontal"
    ? { x: 2 * centre.x - point.x, y: point.y }
    : { x: point.x, y: 2 * centre.y - point.y };
}

function reflectedAngle(angle: number): number {
  return ((-angle % 360) + 360) % 360;
}

/** Mirror supported drawing elements around the visible selection bounds. */
export function flipElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
  axis: "horizontal" | "vertical",
): DrawingDocument {
  const selectedIds = expandSelectionToGroups(document, ids);
  const selected = document.elements.filter(
    (element) => selectedIds.has(element.id) && !element.isDeleted,
  );
  if (
    selected.length === 0 ||
    selected.some((element) => element.locked || !isFlippableElement(element))
  )
    return document;
  const bounds = selectionBounds(document, selectedIds);
  if (!bounds) return document;
  const selectionCentre = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  let changed = false;
  const elements = document.elements.map((element) => {
    if (!selectedIds.has(element.id) || element.isDeleted) return element;
    const elementCentre = {
      x: element.x + element.width / 2,
      y: element.y + element.height / 2,
    };
    const nextCentre = reflectedPoint(elementCentre, selectionCentre, axis);
    const nextAngle = reflectedAngle(element.angle);
    const nextX = nextCentre.x - element.width / 2;
    const nextY = nextCentre.y - element.height / 2;
    let next: DrawingElement = {
      ...element,
      x: nextX,
      y: nextY,
      angle: nextAngle,
    };
    if ("points" in element) {
      const nextPoints = element.points.map((point) => {
        const unrotated = {
          x: element.x + point.x,
          y: element.y + point.y,
        };
        const rendered = rotatePoint(unrotated, elementCentre, element.angle);
        const reflected = reflectedPoint(rendered, selectionCentre, axis);
        const nextUnrotated = rotatePoint(reflected, nextCentre, -nextAngle);
        return {
          ...point,
          x: nextUnrotated.x - nextX,
          y: nextUnrotated.y - nextY,
        };
      });
      next = { ...next, points: nextPoints } as DrawingElement;
    }
    const geometryChanged =
      element.x !== next.x ||
      element.y !== next.y ||
      element.angle !== next.angle ||
      ("points" in element &&
        "points" in next &&
        !samePointList(element.points, next.points));
    if (!geometryChanged) return element;
    changed = true;
    return {
      ...next,
      version: element.version + 1,
      versionNonce: versionNonce(),
    };
  });
  if (!changed) return document;
  const movedTargetIds = new Set(
    selected
      .filter((element) => isBindingTarget(element))
      .map((element) => element.id),
  );
  const detached = elements.map((element) => {
    if (
      !selectedIds.has(element.id) ||
      (element.type !== "line" && element.type !== "arrow")
    )
      return element;
    const startBinding =
      element.startBinding && movedTargetIds.has(element.startBinding.elementId)
        ? element.startBinding
        : null;
    const endBinding =
      element.endBinding && movedTargetIds.has(element.endBinding.elementId)
        ? element.endBinding
        : null;
    if (
      startBinding === element.startBinding &&
      endBinding === element.endBinding
    )
      return element;
    return {
      ...element,
      startBinding,
      endBinding,
      version: element.version + 1,
      versionNonce: versionNonce(),
    };
  });
  return syncBindings(replaceElements(document, detached), movedTargetIds);
}

function updateBoundEndpoints(
  element: LinearElement,
  document: DrawingDocument,
): LinearElement {
  let next = element;
  const bindings: Array<{
    index: number;
    key: "startBinding" | "endBinding";
  }> = [
    { index: 0, key: "startBinding" },
    { index: element.points.length - 1, key: "endBinding" },
  ];
  for (const { index, key } of bindings) {
    const binding = next[key];
    if (!binding) continue;
    const target = document.elements.find(
      (candidate) => candidate.id === binding.elementId && !candidate.isDeleted,
    );
    if (!target || !isBindingTarget(target)) {
      next = { ...next, [key]: null };
      continue;
    }
    next = withEndpoint(next, index, bindingAnchor(target, binding));
  }
  return next;
}

export function bindLinearElement(
  document: DrawingDocument,
  element: LinearElement,
): LinearElement {
  if (element.points.length < 2) return element;
  const start = linearEndpoint(element, "start");
  const end = linearEndpoint(element, "end");
  const startTarget = findBindingTarget(document, start, element.id);
  const endTarget = findBindingTarget(document, end, element.id);
  let next: LinearElement = {
    ...element,
    startBinding: startTarget ? bindingForPoint(startTarget, start) : null,
    endBinding: endTarget ? bindingForPoint(endTarget, end) : null,
  };
  next = updateBoundEndpoints(next, document);
  return next;
}

export function moveLinearEndpoint(
  document: DrawingDocument,
  elementId: string,
  endpoint: LinearEndpoint,
  point: DrawingPoint,
): { document: DrawingDocument; point: DrawingPoint; targetId: string | null } {
  const element = document.elements.find(
    (candidate): candidate is LinearElement =>
      candidate.id === elementId &&
      !candidate.isDeleted &&
      (candidate.type === "line" || candidate.type === "arrow"),
  );
  if (!element || element.points.length < 2)
    return { document, point, targetId: null };

  const index = endpoint === "start" ? 0 : element.points.length - 1;
  const bindingKey = endpoint === "start" ? "startBinding" : "endBinding";
  const moved = withEndpoint({ ...element, [bindingKey]: null }, index, point);
  const bound = bindLinearElement(document, moved);
  const nextElement = {
    ...bound,
    version: element.version + 1,
    versionNonce: versionNonce(),
  };
  const nextDocument = replaceElements(
    document,
    document.elements.map((candidate) =>
      candidate.id === elementId ? nextElement : candidate,
    ),
  );
  return {
    document: nextDocument,
    point: linearEndpoint(nextElement, endpoint),
    targetId: nextElement[bindingKey]?.elementId ?? null,
  };
}

export function insertLinearWaypoint(
  document: DrawingDocument,
  elementId: string,
  segmentIndex: number,
  point: DrawingPoint,
): { document: DrawingDocument; index: number; point: DrawingPoint } | null {
  const element = document.elements.find(
    (candidate): candidate is LinearElement =>
      candidate.id === elementId &&
      !candidate.isDeleted &&
      (candidate.type === "line" || candidate.type === "arrow"),
  );
  if (
    !element ||
    element.points.length < 2 ||
    segmentIndex < 0 ||
    segmentIndex >= element.points.length - 1
  )
    return null;
  const worldPoints = element.points.map((_, index) =>
    linearPoint(element, index),
  );
  const index = segmentIndex + 1;
  worldPoints.splice(index, 0, { x: point.x, y: point.y });
  const nextElement = {
    ...withLinearPoints(element, worldPoints),
    version: element.version + 1,
    versionNonce: versionNonce(),
  };
  return {
    document: replaceElements(
      document,
      document.elements.map((candidate) =>
        candidate.id === elementId ? nextElement : candidate,
      ),
    ),
    index,
    point: linearPoint(nextElement, index),
  };
}

export function moveLinearPoint(
  document: DrawingDocument,
  elementId: string,
  index: number,
  point: DrawingPoint,
): { document: DrawingDocument; point: DrawingPoint } | null {
  const element = document.elements.find(
    (candidate): candidate is LinearElement =>
      candidate.id === elementId &&
      !candidate.isDeleted &&
      (candidate.type === "line" || candidate.type === "arrow"),
  );
  if (!element || index < 0 || index >= element.points.length) return null;
  if (index === 0 || index === element.points.length - 1) {
    const moved = moveLinearEndpoint(
      document,
      elementId,
      index === 0 ? "start" : "end",
      point,
    );
    return { document: moved.document, point: moved.point };
  }
  const worldPoints = element.points.map((_, pointIndex) =>
    linearPoint(element, pointIndex),
  );
  worldPoints[index] = { x: point.x, y: point.y };
  const nextElement = {
    ...withLinearPoints(element, worldPoints),
    version: element.version + 1,
    versionNonce: versionNonce(),
  };
  return {
    document: replaceElements(
      document,
      document.elements.map((candidate) =>
        candidate.id === elementId ? nextElement : candidate,
      ),
    ),
    point: linearPoint(nextElement, index),
  };
}

export function removeLinearWaypoint(
  document: DrawingDocument,
  elementId: string,
  index: number,
): DrawingDocument | null {
  const element = document.elements.find(
    (candidate): candidate is LinearElement =>
      candidate.id === elementId &&
      !candidate.isDeleted &&
      (candidate.type === "line" || candidate.type === "arrow"),
  );
  if (
    !element ||
    element.points.length <= 2 ||
    index <= 0 ||
    index >= element.points.length - 1
  )
    return null;
  const worldPoints = element.points.map((_, pointIndex) =>
    linearPoint(element, pointIndex),
  );
  worldPoints.splice(index, 1);
  const nextElement = {
    ...withLinearPoints(element, worldPoints),
    version: element.version + 1,
    versionNonce: versionNonce(),
  };
  return replaceElements(
    document,
    document.elements.map((candidate) =>
      candidate.id === elementId ? nextElement : candidate,
    ),
  );
}

export function syncBindings(
  document: DrawingDocument,
  movedIds: ReadonlySet<string>,
): DrawingDocument {
  if (movedIds.size === 0) return document;
  let changed = false;
  const elements = document.elements.map((element) => {
    if (
      element.isDeleted ||
      (element.type !== "line" && element.type !== "arrow")
    )
      return element;
    const connectorMoved = movedIds.has(element.id);
    const targetMoved = [
      element.startBinding?.elementId,
      element.endBinding?.elementId,
    ].some((id) => id !== undefined && movedIds.has(id));
    if (!connectorMoved && !targetMoved) return element;
    const next = connectorMoved
      ? bindLinearElement(document, element)
      : updateBoundEndpoints(element, document);
    if (JSON.stringify(next) === JSON.stringify(element)) return element;
    changed = true;
    return {
      ...next,
      version: element.version + 1,
      versionNonce: versionNonce(),
    };
  });
  return changed ? replaceElements(document, elements) : document;
}

export function rotateElement(
  element: DrawingElement,
  angle: number,
): DrawingElement {
  if (!Number.isFinite(angle)) return element;
  const normalized = ((angle % 360) + 360) % 360;
  return {
    ...element,
    angle: normalized,
    version: element.version + 1,
    versionNonce: versionNonce(),
  };
}

type SnapAxis = "x" | "y";

function rectAnchors(
  rect: ReturnType<typeof elementBounds>,
  axis: SnapAxis,
): number[] {
  const start = axis === "x" ? rect.x : rect.y;
  const size = axis === "x" ? rect.width : rect.height;
  return [start, start + size / 2, start + size];
}

function closestSelectionSnap(
  document: DrawingDocument,
  excludedIds: ReadonlySet<string>,
  selection: ReturnType<typeof selectionBounds>,
  delta: number,
  axis: SnapAxis,
  tolerance: number,
): { delta: number; guide: SelectionSnapGuide } | null {
  if (!selection) return null;
  const moved = {
    x: selection.x + (axis === "x" ? delta : 0),
    y: selection.y + (axis === "y" ? delta : 0),
    width: selection.width,
    height: selection.height,
  };
  let best:
    | {
        distance: number;
        delta: number;
        position: number;
        targetId: string;
      }
    | undefined;
  for (const element of document.elements) {
    if (element.isDeleted || excludedIds.has(element.id)) continue;
    const target = elementBounds(element);
    const targetAnchors = rectAnchors(target, axis);
    const movingAnchors = rectAnchors(moved, axis);
    for (const movingAnchor of movingAnchors) {
      for (const targetAnchor of targetAnchors) {
        const adjustment = targetAnchor - movingAnchor;
        const distance = Math.abs(adjustment);
        if (distance > tolerance) continue;
        if (!best || distance < best.distance) {
          best = {
            distance,
            delta: delta + adjustment,
            position: targetAnchor,
            targetId: element.id,
          };
        }
      }
    }
  }
  if (!best) return null;
  return {
    delta: best.delta,
    guide: {
      axis: axis === "x" ? "vertical" : "horizontal",
      position: best.position,
      targetId: best.targetId,
    },
  };
}

function selectionSnapExclusions(
  document: DrawingDocument,
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const selectedGroups = new Set(
    document.elements
      .filter((element) => selectedIds.has(element.id))
      .flatMap((element) => element.groupIds ?? []),
  );
  return new Set(
    document.elements
      .filter(
        (element) =>
          selectedIds.has(element.id) ||
          (element.groupIds ?? []).some((groupId) =>
            selectedGroups.has(groupId),
          ),
      )
      .map((element) => element.id),
  );
}

function overlapsOnPerpendicularAxis(
  first: ReturnType<typeof elementBounds>,
  second: ReturnType<typeof elementBounds>,
  axis: SnapAxis,
): boolean {
  const firstStart = axis === "x" ? first.y : first.x;
  const firstEnd =
    axis === "x" ? first.y + first.height : first.x + first.width;
  const secondStart = axis === "x" ? second.y : second.x;
  const secondEnd =
    axis === "x" ? second.y + second.height : second.x + second.width;
  return Math.min(firstEnd, secondEnd) > Math.max(firstStart, secondStart);
}

function closestSelectionSpacing(
  document: DrawingDocument,
  excludedIds: ReadonlySet<string>,
  selection: ReturnType<typeof selectionBounds>,
  delta: number,
  axis: SnapAxis,
  tolerance: number,
): { delta: number; guide: SelectionSpacingGuide } | null {
  if (!selection) return null;
  const moved = {
    x: selection.x + (axis === "x" ? delta : 0),
    y: selection.y + (axis === "y" ? delta : 0),
    width: selection.width,
    height: selection.height,
  };
  const movedStart = axis === "x" ? moved.x : moved.y;
  const movedEnd =
    axis === "x" ? moved.x + moved.width : moved.y + moved.height;
  let left: number | undefined;
  let right: number | undefined;
  for (const element of document.elements) {
    if (element.isDeleted || excludedIds.has(element.id)) continue;
    const bounds = elementBounds(element);
    if (!overlapsOnPerpendicularAxis(bounds, moved, axis)) continue;
    const targetStart = axis === "x" ? bounds.x : bounds.y;
    const targetEnd =
      axis === "x" ? bounds.x + bounds.width : bounds.y + bounds.height;
    if (targetEnd < movedStart && (left === undefined || targetEnd > left))
      left = targetEnd;
    if (targetStart > movedEnd && (right === undefined || targetStart < right))
      right = targetStart;
  }
  if (left === undefined || right === undefined) return null;
  const available = right - left;
  const size = movedEnd - movedStart;
  const currentGap = Math.min(movedStart - left, right - movedEnd);
  if (available <= size || currentGap <= 0) return null;
  const desiredStart = left + (available - size) / 2;
  const adjustment = desiredStart - movedStart;
  if (Math.abs(adjustment) > tolerance) return null;
  const snappedStart = movedStart + adjustment;
  const snappedEnd = snappedStart + size;
  const cross =
    axis === "x" ? moved.y + moved.height / 2 : moved.x + moved.width / 2;
  const gap = snappedStart - left;
  if (gap <= 0) return null;
  return {
    delta: delta + adjustment,
    guide: {
      axis: axis === "x" ? "horizontal" : "vertical",
      start: left,
      movingStart: snappedStart,
      movingEnd: snappedEnd,
      end: right,
      cross,
      gap,
    },
  };
}

/**
 * Snap a selection translation to nearby object anchors, with grid fallback.
 *
 * The calculation is pure and works from the original document so a drag can
 * be previewed repeatedly without accumulating rounding or snap offsets.
 */
export function snapSelectionTranslation(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
  options: SelectionSnapOptions = {},
): SelectionSnapResult {
  if (!Number.isFinite(dx) || !Number.isFinite(dy))
    return { dx, dy, guides: [], spacingGuides: [] };
  if (options.disabled) return { dx, dy, guides: [], spacingGuides: [] };
  const selectedIds = expandSelectionToGroups(document, ids);
  const bounds = selectionBounds(document, selectedIds);
  if (!bounds) return { dx, dy, guides: [], spacingGuides: [] };
  const excludedIds = selectionSnapExclusions(document, selectedIds);
  const tolerance = Number.isFinite(options.tolerance)
    ? Math.max(0, options.tolerance ?? 0)
    : DEFAULT_SELECTION_SNAP_TOLERANCE;
  let nextDx = dx;
  let nextDy = dy;
  const guides: SelectionSnapGuide[] = [];
  const spacingGuides: SelectionSpacingGuide[] = [];
  const canUseSpacing = selectionUnitCount(document, selectedIds) === 1;
  let xSpacing = false;
  const xSnap = closestSelectionSnap(
    document,
    excludedIds,
    bounds,
    dx,
    "x",
    tolerance,
  );
  if (xSnap) {
    nextDx = xSnap.delta;
    guides.push(xSnap.guide);
  } else if (canUseSpacing) {
    const spacing = closestSelectionSpacing(
      document,
      excludedIds,
      bounds,
      dx,
      "x",
      tolerance,
    );
    if (spacing) {
      nextDx = spacing.delta;
      spacingGuides.push(spacing.guide);
      xSpacing = true;
    }
  }
  if (!xSnap && !xSpacing && options.snapToGrid) {
    const snapped = snapToGrid(
      { x: bounds.x + dx, y: bounds.y },
      options.gridSize,
    );
    nextDx += snapped.x - (bounds.x + dx);
  }
  const ySnap = closestSelectionSnap(
    document,
    excludedIds,
    bounds,
    dy,
    "y",
    tolerance,
  );
  let ySpacing = false;
  if (ySnap) {
    nextDy = ySnap.delta;
    guides.push(ySnap.guide);
  } else if (canUseSpacing) {
    const spacing = closestSelectionSpacing(
      document,
      excludedIds,
      bounds,
      dy,
      "y",
      tolerance,
    );
    if (spacing) {
      nextDy = spacing.delta;
      spacingGuides.push(spacing.guide);
      ySpacing = true;
    }
  }
  if (!ySnap && !ySpacing && options.snapToGrid) {
    const snapped = snapToGrid(
      { x: bounds.x, y: bounds.y + dy },
      options.gridSize,
    );
    nextDy += snapped.y - (bounds.y + dy);
  }
  return { dx: nextDx, dy: nextDy, guides, spacingGuides };
}

/** Rotate a selection around a shared world-space centre without mutating it. */
export function rotateElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
  delta: number,
  centre?: DrawingPoint,
): DrawingDocument {
  if (!Number.isFinite(delta) || delta === 0) return document;
  const selected = document.elements.filter(
    (element) => ids.has(element.id) && !element.isDeleted && !element.locked,
  );
  if (selected.length === 0) return document;
  const bounds = selectionBounds(
    document,
    new Set(selected.map(({ id }) => id)),
  );
  if (!bounds && !centre) return document;
  const pivot = centre ?? {
    x: bounds!.x + bounds!.width / 2,
    y: bounds!.y + bounds!.height / 2,
  };
  const movedIds = new Set(selected.map(({ id }) => id));
  const next = updateElements(document, movedIds, (element) => {
    const frame = elementFrame(element);
    const elementCentre = {
      x: frame.x + frame.width / 2,
      y: frame.y + frame.height / 2,
    };
    if ("points" in element) {
      const points = element.points.map((point) =>
        rotatePoint(
          rotatePoint(
            { x: element.x + point.x, y: element.y + point.y },
            elementCentre,
            element.angle,
          ),
          pivot,
          delta,
        ),
      );
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return updateElement(element, {
        x,
        y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
        angle: 0,
        points: points.map((point, index) => ({
          ...element.points[index]!,
          x: point.x - x,
          y: point.y - y,
        })),
      });
    }
    const rotatedCentre = rotatePoint(elementCentre, pivot, delta);
    const angle = (((element.angle + delta) % 360) + 360) % 360;
    return updateElement(element, {
      angle,
      x: element.x + rotatedCentre.x - elementCentre.x,
      y: element.y + rotatedCentre.y - elementCentre.y,
    });
  });
  return syncBindings(next, movedIds);
}

export function resizeElement(
  element: DrawingElement,
  handle: ResizeHandle,
  point: DrawingPoint,
  keepAspectRatio = false,
): DrawingElement {
  const canResize =
    element.type === "rectangle" ||
    element.type === "ellipse" ||
    element.type === "diamond" ||
    element.type === "image" ||
    element.type === "line" ||
    element.type === "arrow" ||
    element.type === "freedraw" ||
    (element.type === "text" && element.customData?.variant === "note");
  if (!canResize) return element;

  const originalRight = element.x + element.width;
  const originalBottom = element.y + element.height;
  let left = element.x;
  let nextRight = originalRight;
  let top = element.y;
  let nextBottom = originalBottom;
  const horizontalActive =
    hasHandlePart(handle, "w") || hasHandlePart(handle, "e");
  const verticalActive =
    hasHandlePart(handle, "n") || hasHandlePart(handle, "s");
  const horizontalAnchor = hasHandlePart(handle, "w")
    ? originalRight
    : element.x;
  const verticalAnchor = hasHandlePart(handle, "n")
    ? originalBottom
    : element.y;
  const horizontalDirection = hasHandlePart(handle, "w")
    ? point.x <= horizontalAnchor
      ? -1
      : 1
    : point.x >= horizontalAnchor
      ? 1
      : -1;
  const verticalDirection = hasHandlePart(handle, "n")
    ? point.y <= verticalAnchor
      ? -1
      : 1
    : point.y >= verticalAnchor
      ? 1
      : -1;
  let width = horizontalActive
    ? Math.max(MIN_RESIZE_SIZE, Math.abs(point.x - horizontalAnchor))
    : element.width;
  let height = verticalActive
    ? Math.max(MIN_RESIZE_SIZE, Math.abs(point.y - verticalAnchor))
    : element.height;

  if (keepAspectRatio && handle.length === 2) {
    const aspect = Math.max(0.01, element.width / Math.max(1, element.height));
    width = Math.max(width, height * aspect);
    height = width / aspect;
  }

  if (horizontalActive) {
    const edge = horizontalAnchor + horizontalDirection * width;
    left = Math.min(horizontalAnchor, edge);
    nextRight = Math.max(horizontalAnchor, edge);
  }
  if (verticalActive) {
    const edge = verticalAnchor + verticalDirection * height;
    top = Math.min(verticalAnchor, edge);
    nextBottom = Math.max(verticalAnchor, edge);
  }

  const nextX = Math.min(left, nextRight);
  const nextY = Math.min(top, nextBottom);
  const next = {
    ...element,
    x: nextX,
    y: nextY,
    width: Math.max(MIN_RESIZE_SIZE, Math.abs(nextRight - left)),
    height: Math.max(MIN_RESIZE_SIZE, Math.abs(nextBottom - top)),
    version: element.version + 1,
    versionNonce: versionNonce(),
  };
  const fitted =
    next.type === "text" && next.customData?.variant === "note"
      ? { ...next, height: Math.max(next.height, noteTextHeight(next)) }
      : next;
  if ("points" in element) {
    const scaleX = element.width === 0 ? 1 : next.width / element.width;
    const scaleY = element.height === 0 ? 1 : next.height / element.height;
    return {
      ...fitted,
      points: element.points.map((item) => ({
        ...item,
        x: item.x * scaleX,
        y: item.y * scaleY,
      })),
    } as DrawingElement;
  }
  return fitted;
}

export function resizeElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
  handle: ResizeHandle,
  point: DrawingPoint,
  keepAspectRatio = false,
): DrawingDocument {
  const selected = document.elements.filter(
    (element) => ids.has(element.id) && !element.isDeleted,
  );
  if (
    selected.length === 0 ||
    selected.some(
      (element) =>
        !(
          element.type === "rectangle" ||
          element.type === "ellipse" ||
          element.type === "diamond" ||
          element.type === "image" ||
          element.type === "line" ||
          element.type === "arrow" ||
          element.type === "freedraw" ||
          (element.type === "text" && element.customData?.variant === "note")
        ) || element.angle !== 0,
    )
  )
    return document;
  const bounds = selectionBounds(document, ids);
  if (!bounds) return document;
  const frame = resizeElement(
    {
      ...selected[0],
      type: "rectangle",
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      angle: 0,
    } as DrawingElement,
    handle,
    point,
    keepAspectRatio,
  );
  const scaleX = frame.width / Math.max(1, bounds.width);
  const scaleY = frame.height / Math.max(1, bounds.height);
  const resized = updateElements(document, ids, (element) => {
    const oldBounds = elementBounds(element);
    const nextBoundsX = frame.x + (oldBounds.x - bounds.x) * scaleX;
    const nextBoundsY = frame.y + (oldBounds.y - bounds.y) * scaleY;
    const next = {
      ...element,
      x: nextBoundsX,
      y: nextBoundsY,
      width: element.width * scaleX,
      height: element.height * scaleY,
      version: element.version + 1,
      versionNonce: versionNonce(),
    };
    const fitted =
      next.type === "text" && next.customData?.variant === "note"
        ? { ...next, height: Math.max(next.height, noteTextHeight(next)) }
        : next;
    if ("points" in element) {
      const minX = Math.min(...element.points.map((item) => item.x));
      const minY = Math.min(...element.points.map((item) => item.y));
      return {
        ...fitted,
        x: nextBoundsX - minX * scaleX,
        y: nextBoundsY - minY * scaleY,
        points: element.points.map((item) => ({
          ...item,
          x: item.x * scaleX,
          y: item.y * scaleY,
        })),
      };
    }
    return fitted;
  });
  return syncBindings(resized, ids);
}

export function addElements(
  document: DrawingDocument,
  elements: readonly DrawingElement[],
): DrawingDocument {
  return { ...document, elements: [...document.elements, ...elements] };
}

export function replaceElements(
  document: DrawingDocument,
  elements: readonly DrawingElement[],
): DrawingDocument {
  return { ...document, elements: [...elements] };
}

export function updateElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
  updater: (element: DrawingElement) => DrawingElement,
): DrawingDocument {
  return replaceElements(
    document,
    document.elements.map((element) =>
      ids.has(element.id) ? updater(element) : element,
    ),
  );
}

export type Alignment =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom";

type LogicalSelectionUnit = {
  elements: DrawingElement[];
  bounds: ReturnType<typeof elementBounds>;
};

function unionElementBounds(
  elements: readonly DrawingElement[],
): ReturnType<typeof elementBounds> {
  const first = elementBounds(elements[0]!);
  return elements.slice(1).reduce((result, element) => {
    const bounds = elementBounds(element);
    const x = Math.min(result.x, bounds.x);
    const y = Math.min(result.y, bounds.y);
    return {
      x,
      y,
      width: Math.max(result.x + result.width, bounds.x + bounds.width) - x,
      height: Math.max(result.y + result.height, bounds.y + bounds.height) - y,
    };
  }, first);
}

function logicalSelectionUnits(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): LogicalSelectionUnit[] {
  const selectedIds = expandSelectionToGroups(document, ids);
  const selected = document.elements.filter(
    (element) => selectedIds.has(element.id) && !element.isDeleted,
  );
  if (selected.length === 0) return [];

  const groupCounts = new Map<string, number>();
  for (const element of selected)
    for (const groupId of element.groupIds ?? [])
      groupCounts.set(groupId, (groupCounts.get(groupId) ?? 0) + 1);
  const units = new Map<string, DrawingElement[]>();
  for (const element of selected) {
    const groupId = [...(element.groupIds ?? [])]
      .filter((candidate) => (groupCounts.get(candidate) ?? 0) > 1)
      .sort(
        (leftGroup, rightGroup) =>
          (groupCounts.get(rightGroup) ?? 0) -
          (groupCounts.get(leftGroup) ?? 0),
      )[0];
    const key = groupId ? `group:${groupId}` : `element:${element.id}`;
    units.set(key, [...(units.get(key) ?? []), element]);
  }
  return [...units.values()].map((elements) => ({
    elements,
    bounds: unionElementBounds(elements),
  }));
}

/** Return the number of independently movable units in a selection. */
export function selectionUnitCount(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): number {
  return logicalSelectionUnits(document, ids).length;
}

/** Align a selection to the corresponding edge or centre of its shared bounds. */
export function alignElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
  alignment: Alignment,
): DrawingDocument {
  const units = logicalSelectionUnits(document, ids);
  if (units.length < 2) return document;
  const unitBounds = units.map((unit) => unit.bounds);
  const left = Math.min(...unitBounds.map((item) => item.x));
  const top = Math.min(...unitBounds.map((item) => item.y));
  const right = Math.max(...unitBounds.map((item) => item.x + item.width));
  const bottom = Math.max(...unitBounds.map((item) => item.y + item.height));
  const target =
    alignment === "left"
      ? left
      : alignment === "center"
        ? (left + right) / 2
        : alignment === "right"
          ? right
          : alignment === "top"
            ? top
            : alignment === "middle"
              ? (top + bottom) / 2
              : bottom;
  const movedIds = new Set<string>();
  const deltas = new Map<string, { dx: number; dy: number }>();
  for (const [index, unit] of units.entries()) {
    const item = unitBounds[index]!;
    const current =
      alignment === "left"
        ? item.x
        : alignment === "center"
          ? item.x + item.width / 2
          : alignment === "right"
            ? item.x + item.width
            : alignment === "top"
              ? item.y
              : alignment === "middle"
                ? item.y + item.height / 2
                : item.y + item.height;
    const delta = target - current;
    const dx =
      alignment === "left" || alignment === "center" || alignment === "right"
        ? delta
        : 0;
    const dy =
      alignment === "top" || alignment === "middle" || alignment === "bottom"
        ? delta
        : 0;
    if (dx === 0 && dy === 0) continue;
    for (const element of unit.elements) {
      movedIds.add(element.id);
      deltas.set(element.id, { dx, dy });
    }
  }
  if (movedIds.size === 0) return document;
  const next = updateElements(document, movedIds, (element) => {
    const delta = deltas.get(element.id);
    return delta
      ? updateElement(element, {
          x: element.x + delta.dx,
          y: element.y + delta.dy,
        })
      : element;
  });
  return syncBindings(next, movedIds);
}

/** Distribute logical selection units with equal gaps along one axis. */
export function distributeElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
  axis: "horizontal" | "vertical",
): DrawingDocument {
  const units = logicalSelectionUnits(document, ids);
  if (units.length < 3) return document;
  const ordered = [...units].sort((left, right) =>
    axis === "horizontal"
      ? left.bounds.x - right.bounds.x
      : left.bounds.y - right.bounds.y,
  );
  const start =
    axis === "horizontal" ? ordered[0]!.bounds.x : ordered[0]!.bounds.y;
  const end =
    axis === "horizontal"
      ? ordered.at(-1)!.bounds.x + ordered.at(-1)!.bounds.width
      : ordered.at(-1)!.bounds.y + ordered.at(-1)!.bounds.height;
  const totalSize = ordered.reduce(
    (sum, unit) =>
      sum + (axis === "horizontal" ? unit.bounds.width : unit.bounds.height),
    0,
  );
  const gap = (end - start - totalSize) / (ordered.length - 1);
  const deltas = new Map<string, { dx: number; dy: number }>();
  const movedIds = new Set<string>();
  let cursor = start;
  for (const unit of ordered) {
    const current = axis === "horizontal" ? unit.bounds.x : unit.bounds.y;
    const delta = cursor - current;
    if (delta !== 0) {
      for (const element of unit.elements) {
        movedIds.add(element.id);
        deltas.set(element.id, {
          dx: axis === "horizontal" ? delta : 0,
          dy: axis === "vertical" ? delta : 0,
        });
      }
    }
    cursor +=
      (axis === "horizontal" ? unit.bounds.width : unit.bounds.height) + gap;
  }
  if (movedIds.size === 0) return document;
  const next = updateElements(document, movedIds, (element) => {
    const delta = deltas.get(element.id);
    return delta
      ? updateElement(element, {
          x: element.x + delta.dx,
          y: element.y + delta.dy,
        })
      : element;
  });
  return syncBindings(next, movedIds);
}

export function deleteElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  return syncBindings(
    updateElements(document, ids, (element) =>
      updateElement(element, { isDeleted: true }),
    ),
    ids,
  );
}

export function duplicateElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): { document: DrawingDocument; ids: string[] } {
  return pasteElements(
    document,
    document.elements.filter((element) => ids.has(element.id)),
  );
}

export function pasteElements(
  document: DrawingDocument,
  elements: readonly DrawingElement[],
  offset = 24,
): { document: DrawingDocument; ids: string[] } {
  const source = elements.filter((element) => !element.isDeleted);
  const idMap = new Map(source.map((element) => [element.id, newElementId()]));
  const groupMap = new Map<string, string>();
  for (const element of source)
    for (const groupId of element.groupIds ?? [])
      if (!groupMap.has(groupId)) groupMap.set(groupId, newElementId());
  const copies = source.map((element) => {
    const copy = {
      ...element,
      id: idMap.get(element.id)!,
      x: element.x + offset,
      y: element.y + offset,
      version: 1,
      versionNonce: versionNonce(),
      groupIds: element.groupIds?.map((groupId) => groupMap.get(groupId)!),
      ...(element.type === "freedraw" ||
      element.type === "line" ||
      element.type === "arrow"
        ? { points: element.points.map((point) => ({ ...point })) }
        : {}),
    };
    if (copy.type === "line" || copy.type === "arrow") {
      const binding = (
        value: typeof copy.startBinding,
      ): typeof copy.startBinding =>
        value
          ? {
              ...value,
              elementId: idMap.get(value.elementId) ?? "",
            }
          : value;
      return {
        ...copy,
        startBinding:
          copy.startBinding && idMap.has(copy.startBinding.elementId)
            ? binding(copy.startBinding)
            : null,
        endBinding:
          copy.endBinding && idMap.has(copy.endBinding.elementId)
            ? binding(copy.endBinding)
            : null,
      };
    }
    return copy;
  });
  return {
    document: addElements(document, copies),
    ids: copies.map((element) => element.id),
  };
}

/** Expand a selection to include every live element sharing any selected group level. */
export function expandSelectionToGroups(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): Set<string> {
  const selected = new Set(
    document.elements
      .filter(
        (element) =>
          !element.isDeleted && !element.locked && ids.has(element.id),
      )
      .map((element) => element.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    const groups = new Set(
      document.elements
        .filter((element) => selected.has(element.id))
        .flatMap((element) => element.groupIds ?? []),
    );
    if (groups.size === 0) break;
    for (const element of document.elements) {
      if (
        element.isDeleted ||
        element.locked ||
        selected.has(element.id) ||
        !(element.groupIds ?? []).some((groupId) => groups.has(groupId))
      )
        continue;
      selected.add(element.id);
      changed = true;
    }
  }
  return selected;
}

/** Return group ids shared by every live element in a selection, in document order. */
export function groupIdsInSelection(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): string[] {
  const selected = document.elements.filter(
    (element) => !element.isDeleted && ids.has(element.id),
  );
  if (selected.length === 0) return [];
  const common = new Set(selected[0]?.groupIds ?? []);
  for (const element of selected.slice(1)) {
    const groups = new Set(element.groupIds ?? []);
    for (const groupId of common)
      if (!groups.has(groupId)) common.delete(groupId);
  }
  return document.elements
    .flatMap((element) => element.groupIds ?? [])
    .filter((groupId, index, groups) => groups.indexOf(groupId) === index)
    .filter((groupId) => common.has(groupId));
}

export function bringForward(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  const elements = [...document.elements];
  let index = 0;
  while (index < elements.length) {
    if (!ids.has(elements[index]?.id ?? "")) {
      index += 1;
      continue;
    }
    const start = index;
    while (index + 1 < elements.length && ids.has(elements[index + 1]!.id))
      index += 1;
    if (index + 1 < elements.length) {
      const next = elements[index + 1]!;
      elements.splice(index + 1, 1);
      elements.splice(start, 0, next);
      index += 1;
    }
    index += 1;
  }
  return updateDrawingOrder(document, elements);
}

export function sendBackward(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  const elements = [...document.elements];
  let index = elements.length - 1;
  while (index >= 0) {
    if (!ids.has(elements[index]?.id ?? "")) {
      index -= 1;
      continue;
    }
    const end = index;
    while (index - 1 >= 0 && ids.has(elements[index - 1]!.id)) index -= 1;
    if (index > 0) {
      const previous = elements[index - 1]!;
      elements.splice(index - 1, 1);
      elements.splice(end, 0, previous);
      index -= 1;
    }
    index -= 1;
  }
  return updateDrawingOrder(document, elements);
}

/** Move the selected elements to the top while preserving their relative order. */
export function bringToFront(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  const selected = document.elements.filter((element) => ids.has(element.id));
  const rest = document.elements.filter((element) => !ids.has(element.id));
  return updateDrawingOrder(document, [...rest, ...selected]);
}

/** Move the selected elements to the bottom while preserving their relative order. */
export function sendToBack(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  const selected = document.elements.filter((element) => ids.has(element.id));
  const rest = document.elements.filter((element) => !ids.has(element.id));
  return updateDrawingOrder(document, [...selected, ...rest]);
}

// Short aliases keep command wiring readable at call sites.
export const bringFront = bringToFront;
export const sendBack = sendToBack;

export function groupElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): { document: DrawingDocument; groupId: string } {
  const groupId = newElementId();
  return {
    document: updateElements(document, ids, (element) => ({
      ...element,
      groupIds: [...(element.groupIds ?? []), groupId],
      version: element.version + 1,
      versionNonce: versionNonce(),
    })),
    groupId,
  };
}

export function ungroupElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
  groupId?: string,
): DrawingDocument {
  const groups = new Set(
    groupId ? [groupId] : groupIdsInSelection(document, ids).slice(-1),
  );
  if (groups.size === 0) return document;
  return updateElements(
    document,
    new Set(
      document.elements
        .filter(
          (element) =>
            !element.isDeleted &&
            (element.groupIds ?? []).some((group) => groups.has(group)),
        )
        .map((element) => element.id),
    ),
    (element) => ({
      ...element,
      groupIds: (element.groupIds ?? []).filter((group) => !groups.has(group)),
      version: element.version + 1,
      versionNonce: versionNonce(),
    }),
  );
}

export function createShape(
  type: "rectangle" | "ellipse" | "diamond",
  start: DrawingPoint,
  end: DrawingPoint,
  style: Partial<DrawingStyle> = {},
): DrawingElement {
  return createElement(type, {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    style: styleWith(style),
  });
}

export function createLinear(
  type: "line" | "arrow",
  start: DrawingPoint,
  end: DrawingPoint,
  style: Partial<DrawingStyle> = {},
): LinearElement {
  return createElement(type, {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    points: [
      {
        x: start.x - Math.min(start.x, end.x),
        y: start.y - Math.min(start.y, end.y),
      },
      {
        x: end.x - Math.min(start.x, end.x),
        y: end.y - Math.min(start.y, end.y),
      },
    ],
    endArrowhead: type === "arrow" ? "arrow" : null,
    style: styleWith(style),
  }) as LinearElement;
}

export function createFreedraw(
  points: readonly DrawingPoint[],
  style: Partial<DrawingStyle> = {},
): DrawingElement {
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return createElement("freedraw", {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y,
    points: points.map((point) => ({
      ...point,
      x: point.x - x,
      y: point.y - y,
    })),
    style: styleWith(style),
  });
}

export function createText(
  x: number,
  y: number,
  style: Partial<DrawingStyle> = {},
): TextElement {
  return createElement("text", {
    x,
    y,
    width: 240,
    height: 40,
    text: "",
    style: styleWith(style),
  }) as TextElement;
}

export function createNote(
  x: number,
  y: number,
  style: Partial<DrawingStyle> = {},
): TextElement {
  return createElement("text", {
    x,
    y,
    width: 240,
    height: 128,
    text: DRAWING_NOTE_DEFAULT_TEXT,
    style: styleWith({
      fill: "#fff3a3",
      stroke: "#5f4b00",
      fontSize: 18,
      roundness: 8,
      ...style,
    }),
    customData: { variant: "note", createdAt: Date.now() },
  }) as TextElement;
}
