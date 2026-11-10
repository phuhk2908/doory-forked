import type {
  DrawingDocument,
  DrawingElement,
  DrawingPoint,
  DrawingViewport,
  LinearElement,
  TextElement,
} from "./model";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const rectRight = (rect: Rect): number => rect.x + rect.width;
export const rectBottom = (rect: Rect): number => rect.y + rect.height;
export const DRAWING_ZOOM_STEP = 1.1;

let textMeasureContext: CanvasRenderingContext2D | null | undefined;

function measureTextLine(element: TextElement, text: string): number {
  if (textMeasureContext === undefined) {
    try {
      textMeasureContext =
        typeof globalThis.document === "undefined"
          ? null
          : globalThis.document.createElement("canvas").getContext("2d");
    } catch {
      textMeasureContext = null;
    }
  }
  if (textMeasureContext) {
    textMeasureContext.font = `${element.style.fontSize}px ${element.style.fontFamily}`;
    return Math.max(1, textMeasureContext.measureText(text).width);
  }
  return Math.max(1, text.length * element.style.fontSize * 0.6);
}

export function textBounds(element: TextElement): Rect {
  if (element.customData?.variant === "note")
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };
  const lines = element.text.split("\n");
  return {
    x: element.x,
    y: element.y,
    width: Math.max(...lines.map((line) => measureTextLine(element, line)), 1),
    height: Math.max(
      element.style.fontSize * element.style.lineHeight,
      lines.length * element.style.fontSize * element.style.lineHeight,
    ),
  };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= rectRight(b) &&
    rectRight(a) >= b.x &&
    a.y <= rectBottom(b) &&
    rectBottom(a) >= b.y
  );
}

export function worldToScreen(point: Point, viewport: DrawingViewport): Point {
  return {
    x: (point.x - viewport.scrollX) * viewport.zoom,
    y: (point.y - viewport.scrollY) * viewport.zoom,
  };
}

export function screenToWorld(point: Point, viewport: DrawingViewport): Point {
  return {
    x: point.x / viewport.zoom + viewport.scrollX,
    y: point.y / viewport.zoom + viewport.scrollY,
  };
}

export function viewportAtPoint(
  viewport: DrawingViewport,
  screen: Point,
  zoom: number,
): DrawingViewport {
  const before = screenToWorld(screen, viewport);
  const next = { ...viewport, zoom: Math.max(0.1, Math.min(8, zoom)) };
  const after = screenToWorld(screen, next);
  return {
    ...next,
    scrollX: next.scrollX + before.x - after.x,
    scrollY: next.scrollY + before.y - after.y,
  };
}

export function zoomViewport(
  viewport: DrawingViewport,
  screen: Point,
  direction: "in" | "out",
): DrawingViewport {
  const factor = direction === "in" ? DRAWING_ZOOM_STEP : 1 / DRAWING_ZOOM_STEP;
  return viewportAtPoint(viewport, screen, viewport.zoom * factor);
}

export function rotatePoint(point: Point, centre: Point, angle: number): Point {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - centre.x;
  const y = point.y - centre.y;
  return { x: centre.x + x * cos - y * sin, y: centre.y + x * sin + y * cos };
}

export function elementBounds(element: DrawingElement): Rect {
  if (element.type === "text") return textBounds(element);
  if ("points" in element && element.points.length > 0) {
    const xs = element.points.map((point) => point.x);
    const ys = element.points.map((point) => point.y);
    return {
      x: element.x + Math.min(...xs),
      y: element.y + Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
}

export function documentBounds(document: DrawingDocument): Rect {
  const elements = document.elements.filter((element) => !element.isDeleted);
  if (elements.length === 0) return { x: 0, y: 0, width: 1000, height: 700 };
  let result = elementBounds(elements[0]);
  for (const element of elements.slice(1)) {
    const bounds = elementBounds(element);
    const right = Math.max(rectRight(result), rectRight(bounds));
    const bottom = Math.max(rectBottom(result), rectBottom(bounds));
    result = {
      x: Math.min(result.x, bounds.x),
      y: Math.min(result.y, bounds.y),
      width: right - Math.min(result.x, bounds.x),
      height: bottom - Math.min(result.y, bounds.y),
    };
  }
  return result;
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function insideShape(point: Point, element: DrawingElement): boolean {
  const bounds = element.type === "text" ? textBounds(element) : element;
  const local = rotatePoint(
    point,
    {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    },
    -element.angle,
  );
  if (element.type === "ellipse") {
    const rx = Math.max(bounds.width / 2, 0.001);
    const ry = Math.max(bounds.height / 2, 0.001);
    return (
      ((local.x - (bounds.x + rx)) / rx) ** 2 +
        ((local.y - (bounds.y + ry)) / ry) ** 2 <=
      1
    );
  }
  if (element.type === "diamond") {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    return (
      Math.abs(local.x - cx) / Math.max(bounds.width / 2, 0.001) +
        Math.abs(local.y - cy) / Math.max(bounds.height / 2, 0.001) <=
      1
    );
  }
  return (
    local.x >= bounds.x &&
    local.x <= rectRight(bounds) &&
    local.y >= bounds.y &&
    local.y <= rectBottom(bounds)
  );
}

export function hitTest(
  element: DrawingElement,
  point: Point,
  tolerance: number,
): boolean {
  if (element.isDeleted) return false;
  if (
    element.type === "text" ||
    element.type === "rectangle" ||
    element.type === "ellipse" ||
    element.type === "diamond"
  ) {
    const bounds = element.type === "text" ? textBounds(element) : element;
    return (
      insideShape(point, element) ||
      distanceToSegment(
        point,
        { x: bounds.x, y: bounds.y },
        { x: rectRight(bounds), y: bounds.y },
      ) <= tolerance
    );
  }
  if (
    element.type !== "line" &&
    element.type !== "arrow" &&
    element.type !== "freedraw"
  )
    return false;
  const points = element.points.map((item) => ({
    x: element.x + item.x,
    y: element.y + item.y,
  }));
  return points.some(
    (item, index) =>
      index > 0 &&
      distanceToSegment(point, points[index - 1], item) <= tolerance,
  );
}

export function hitTestScene(
  document: DrawingDocument,
  point: Point,
  tolerance = 8,
): DrawingElement | null {
  for (let index = document.elements.length - 1; index >= 0; index -= 1) {
    const element = document.elements[index];
    if (element && hitTest(element, point, tolerance)) return element;
  }
  return null;
}

export function elementsHitBySegment(
  document: DrawingDocument,
  from: Point,
  to: Point,
  tolerance = 8,
): string[] {
  const sweep = {
    x: Math.min(from.x, to.x) - tolerance,
    y: Math.min(from.y, to.y) - tolerance,
    width: Math.abs(to.x - from.x) + tolerance * 2,
    height: Math.abs(to.y - from.y) + tolerance * 2,
  };
  const candidates = document.elements.filter(
    (element) =>
      !element.isDeleted && rectsIntersect(elementBounds(element), sweep),
  );
  const steps = Math.max(
    1,
    Math.ceil(
      Math.hypot(to.x - from.x, to.y - from.y) / Math.max(4, tolerance),
    ),
  );
  const ids = new Set<string>();
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const point = {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    };
    for (const element of candidates)
      if (hitTest(element, point, tolerance)) ids.add(element.id);
  }
  return [...ids];
}

export function selectionBounds(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): Rect | null {
  const selected = document.elements.filter(
    (element) => ids.has(element.id) && !element.isDeleted,
  );
  if (selected.length === 0) return null;
  const first = elementBounds(selected[0]);
  let result = first;
  for (const element of selected.slice(1)) {
    const bounds = elementBounds(element);
    const x = Math.min(result.x, bounds.x);
    const y = Math.min(result.y, bounds.y);
    result = {
      x,
      y,
      width: Math.max(rectRight(result), rectRight(bounds)) - x,
      height: Math.max(rectBottom(result), rectBottom(bounds)) - y,
    };
  }
  return result;
}

export function elementsInRect(
  document: DrawingDocument,
  rect: Rect,
): string[] {
  return document.elements
    .filter(
      (element) =>
        !element.isDeleted && rectsIntersect(elementBounds(element), rect),
    )
    .map((element) => element.id);
}

export function translateElement(
  element: DrawingElement,
  dx: number,
  dy: number,
): DrawingElement {
  return {
    ...element,
    x: element.x + dx,
    y: element.y + dy,
    version: element.version + 1,
    versionNonce: element.versionNonce + 1,
  } as DrawingElement;
}

export function translatedPoints(
  element: LinearElement | Extract<DrawingElement, { type: "freedraw" }>,
  dx: number,
  dy: number,
): DrawingPoint[] {
  return element.points.map((point) => ({
    ...point,
    x: point.x - dx,
    y: point.y - dy,
  }));
}
