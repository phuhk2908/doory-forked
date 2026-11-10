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
  updateElement,
  versionNonce,
} from "./model";
import {
  elementBounds,
  noteTextHeight,
  rotatePoint,
  selectionBounds,
} from "./geometry";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type LinearEndpoint = "start" | "end";

const MIN_RESIZE_SIZE = 20;

const BINDING_TOLERANCE = 14;

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
    versionNonce: element.versionNonce + 1,
  };
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
    versionNonce: element.versionNonce + 1,
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

export function bringForward(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  const selected = document.elements.filter((element) => ids.has(element.id));
  const rest = document.elements.filter((element) => !ids.has(element.id));
  return replaceElements(document, [...rest, ...selected]);
}

export function sendBackward(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  const selected = document.elements.filter((element) => ids.has(element.id));
  const rest = document.elements.filter((element) => !ids.has(element.id));
  return replaceElements(document, [...selected, ...rest]);
}

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
      versionNonce: element.versionNonce + 1,
    })),
    groupId,
  };
}

export function ungroupElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  const groups = new Set(
    document.elements
      .filter((element) => ids.has(element.id))
      .flatMap((element) => element.groupIds ?? []),
  );
  return updateElements(
    document,
    new Set(
      document.elements
        .filter((element) =>
          (element.groupIds ?? []).some((group) => groups.has(group)),
        )
        .map((element) => element.id),
    ),
    (element) => ({
      ...element,
      groupIds: (element.groupIds ?? []).filter((group) => !groups.has(group)),
      version: element.version + 1,
      versionNonce: element.versionNonce + 1,
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
