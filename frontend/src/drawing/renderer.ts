import rough from "roughjs";
import {
  documentBounds,
  elementBounds,
  selectionBounds,
  textBounds,
  worldToScreen,
  type Point,
} from "./geometry";
import { DRAWING_NOTE_DATE_FONT_SIZE, DRAWING_NOTE_PADDING } from "./model";
import type {
  DrawingDocument,
  DrawingElement,
  DrawingExportOptions,
  DrawingPoint,
  DrawingViewport,
  LinearElement,
  TextElement,
} from "./model";

export interface RenderOptions {
  dpr?: number;
  selection?: ReadonlySet<string>;
  eraserTargets?: ReadonlySet<string>;
  eraserTrail?: readonly Point[];
  draft?: DrawingElement | null;
  showGrid?: boolean;
  showDots?: boolean;
}

function dash(
  style: DrawingElement["style"]["strokeStyle"],
): number[] | undefined {
  if (style === "dashed") return [10, 8];
  if (style === "dotted") return [2, 6];
  return undefined;
}

function colour(value: string): string | undefined {
  return value === "transparent" ? undefined : value;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  points: readonly DrawingPoint[],
  element: DrawingElement,
): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.strokeStyle = element.style.stroke;
  ctx.lineWidth = element.style.strokeWidth;
  ctx.globalAlpha = element.style.opacity;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const lineDash = dash(element.style.strokeStyle);
  ctx.setLineDash(lineDash ?? []);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  element: DrawingElement,
): void {
  const size = Math.max(8, element.style.strokeWidth * 4);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.save();
  ctx.translate(to.x, to.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, size * 0.55);
  ctx.lineTo(-size * 0.65, 0);
  ctx.lineTo(-size, -size * 0.55);
  ctx.closePath();
  ctx.fillStyle = element.style.stroke;
  ctx.globalAlpha = element.style.opacity;
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawText(ctx: CanvasRenderingContext2D, element: TextElement): void {
  const isNote = element.customData?.variant === "note";
  const padding = isNote ? DRAWING_NOTE_PADDING : 0;
  const contentWidth = isNote
    ? Math.max(40, element.width - padding * 2)
    : textBounds(element).width;
  ctx.save();
  ctx.translate(element.x, element.y);
  ctx.rotate((element.angle * Math.PI) / 180);
  if (isNote) {
    ctx.fillStyle = element.style.fill;
    ctx.strokeStyle = element.style.stroke;
    ctx.lineWidth = element.style.strokeWidth;
    ctx.globalAlpha = element.style.opacity;
    ctx.shadowColor = "rgba(15, 23, 42, 0.12)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.roundRect(0, 0, element.width, element.height, element.style.roundness);
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }
  ctx.font = `${element.style.fontSize}px ${element.style.fontFamily}`;
  ctx.fillStyle = element.style.stroke;
  ctx.globalAlpha = element.style.opacity;
  ctx.textAlign = element.style.textAlign;
  ctx.textBaseline = "top";
  const lines: string[] = [];
  const lineHeight = element.style.fontSize * element.style.lineHeight;
  for (const source of element.text.split("\n")) {
    if (!isNote) {
      lines.push(source);
      continue;
    }
    const words = source.split(" ");
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > contentWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  const textX = (): number =>
    element.style.textAlign === "left"
      ? padding
      : element.style.textAlign === "center"
        ? padding + contentWidth / 2
        : padding + contentWidth;
  lines.forEach((line, lineIndex) => {
    ctx.fillText(line, textX(), padding + lineIndex * lineHeight);
  });
  if (isNote) {
    const createdAt = element.customData?.createdAt;
    if (typeof createdAt === "number" && Number.isFinite(createdAt)) {
      const date = new Date(createdAt);
      if (!Number.isNaN(date.getTime())) {
        ctx.save();
        ctx.font = `${DRAWING_NOTE_DATE_FONT_SIZE}px ${element.style.fontFamily}`;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.globalAlpha = element.style.opacity * 0.68;
        ctx.fillText(
          `Added ${new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          }).format(date)}`,
          element.width - padding,
          element.height - padding,
        );
        ctx.restore();
      }
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  roughCanvas: ReturnType<typeof rough.canvas>,
  element: DrawingElement,
): void {
  if (element.isDeleted) return;
  if (element.type === "text") {
    drawText(ctx, element);
    return;
  }
  ctx.save();
  const centreX = element.x + element.width / 2;
  const centreY = element.y + element.height / 2;
  ctx.translate(centreX, centreY);
  ctx.rotate((element.angle * Math.PI) / 180);
  ctx.translate(-centreX, -centreY);
  const options = {
    stroke: element.style.stroke,
    strokeWidth: element.style.strokeWidth,
    fill: colour(element.style.fill),
    fillStyle: "solid" as const,
    roughness: element.style.roughness,
    bowing: element.style.roughness,
    seed: element.versionNonce,
    strokeLineDash: dash(element.style.strokeStyle),
  };
  ctx.globalAlpha = element.style.opacity;
  if (element.type === "rectangle")
    roughCanvas.rectangle(
      element.x,
      element.y,
      element.width,
      element.height,
      options,
    );
  else if (element.type === "ellipse")
    roughCanvas.ellipse(
      element.x + element.width / 2,
      element.y + element.height / 2,
      element.width,
      element.height,
      options,
    );
  else if (element.type === "diamond")
    roughCanvas.polygon(
      [
        [element.x + element.width / 2, element.y],
        [element.x + element.width, element.y + element.height / 2],
        [element.x + element.width / 2, element.y + element.height],
        [element.x, element.y + element.height / 2],
      ],
      options,
    );
  else if (element.type === "freedraw")
    drawLine(
      ctx,
      element.points.map((point) => ({
        x: element.x + point.x,
        y: element.y + point.y,
      })),
      element,
    );
  else {
    const linear = element as LinearElement;
    const points = linear.points.map((point) => ({
      x: element.x + point.x,
      y: element.y + point.y,
    }));
    drawLine(ctx, points, element);
    if (element.type === "arrow" && points.length > 1) {
      if (linear.startArrowhead)
        drawArrowhead(ctx, points[1], points[0], element);
      if (linear.endArrowhead !== null)
        drawArrowhead(
          ctx,
          points[points.length - 2],
          points[points.length - 1],
          element,
        );
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

export interface GridLine {
  from: Point;
  to: Point;
  major: boolean;
}

export function gridLines(
  width: number,
  height: number,
  viewport: DrawingViewport,
): GridLine[] {
  const step = viewport.zoom >= 1 ? 40 : viewport.zoom >= 0.5 ? 80 : 160;
  const left = Math.floor(viewport.scrollX / step) * step;
  const top = Math.floor(viewport.scrollY / step) * step;
  const majorStep = step * 5;
  const lines: GridLine[] = [];
  for (let x = left; x < viewport.scrollX + width + step; x += step) {
    lines.push({
      from: { x, y: viewport.scrollY },
      to: { x, y: viewport.scrollY + height },
      major: Math.abs(x / majorStep - Math.round(x / majorStep)) < 0.001,
    });
  }
  for (let y = top; y < viewport.scrollY + height + step; y += step) {
    lines.push({
      from: { x: viewport.scrollX, y },
      to: { x: viewport.scrollX + width, y },
      major: Math.abs(y / majorStep - Math.round(y / majorStep)) < 0.001,
    });
  }
  return lines;
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: DrawingViewport,
): void {
  ctx.save();
  ctx.lineWidth = 1 / viewport.zoom;
  const lines = gridLines(width, height, viewport);
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? "#d9ccd5" : "#ebe2e8";
    ctx.globalAlpha = major ? 0.75 : 0.5;
    ctx.setLineDash(major ? [6 / viewport.zoom, 6 / viewport.zoom] : []);
    ctx.beginPath();
    for (const line of lines) {
      if (line.major !== major) continue;
      ctx.moveTo(line.from.x, line.from.y);
      ctx.lineTo(line.to.x, line.to.y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawDots(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const spacing = 24;
  ctx.save();
  ctx.fillStyle = "#d9ccd5";
  ctx.globalAlpha = 0.7;
  for (let x = spacing / 2; x < width; x += spacing) {
    for (let y = spacing / 2; y < height; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawEraserTrail(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  zoom: number,
): void {
  if (points.length === 0) return;
  const last = points[points.length - 1];
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    distances.push(
      distances[index - 1] +
        Math.hypot(current.x - previous.x, current.y - previous.y),
    );
  }
  const totalDistance = distances[distances.length - 1] ?? 0;
  const radii = points.map((_, index) =>
    eraserTrailRadius(distances[index], totalDistance, zoom),
  );
  const sides = points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    let dx = next.x - previous.x;
    let dy = next.y - previous.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      dx = 1;
      dy = 0;
    } else {
      dx /= length;
      dy /= length;
    }
    const radius = radii[index];
    const normal = { x: -dy * radius, y: dx * radius };
    return {
      left: { x: point.x + normal.x, y: point.y + normal.y },
      right: { x: point.x - normal.x, y: point.y - normal.y },
    };
  });
  ctx.save();
  ctx.fillStyle = "#6a52d9";
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.moveTo(sides[0].left.x, sides[0].left.y);
  for (const side of sides.slice(1)) ctx.lineTo(side.left.x, side.left.y);
  for (const side of sides.slice().reverse())
    ctx.lineTo(side.right.x, side.right.y);
  ctx.closePath();
  ctx.fill();

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#6a52d9";
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(last.x, last.y, radii[radii.length - 1], 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5 / zoom;
  ctx.stroke();
  ctx.restore();
}

export function eraserTrailRadius(
  distance: number,
  totalDistance: number,
  zoom: number,
): number {
  const progress =
    totalDistance <= 0 ? 1 : Math.max(0, Math.min(1, distance / totalDistance));
  return (3 + progress * 8) / zoom;
}

export function renderDrawing(
  canvas: HTMLCanvasElement,
  document: DrawingDocument,
  viewport: DrawingViewport,
  options: RenderOptions = {},
): void {
  const dpr = options.dpr ?? window.devicePixelRatio ?? 1;
  const width = canvas.clientWidth || canvas.width / dpr;
  const height = canvas.clientHeight || canvas.height / dpr;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = document.background;
  ctx.fillRect(0, 0, width, height);
  if (options.showDots !== false && !options.showGrid)
    drawDots(ctx, width, height);
  ctx.save();
  ctx.translate(
    -viewport.scrollX * viewport.zoom,
    -viewport.scrollY * viewport.zoom,
  );
  ctx.scale(viewport.zoom, viewport.zoom);
  if (options.showGrid)
    drawGrid(ctx, width / viewport.zoom, height / viewport.zoom, viewport);
  const roughCanvas = rough.canvas(canvas);
  const visible = {
    x: viewport.scrollX,
    y: viewport.scrollY,
    width: width / viewport.zoom,
    height: height / viewport.zoom,
  };
  for (const element of document.elements) {
    const erasing = options.eraserTargets?.has(element.id) === true;
    if (
      (erasing || !element.isDeleted) &&
      elementBounds(element).x < visible.x + visible.width + 100 &&
      elementBounds(element).x + elementBounds(element).width >
        visible.x - 100 &&
      elementBounds(element).y < visible.y + visible.height + 100 &&
      elementBounds(element).y + elementBounds(element).height > visible.y - 100
    )
      drawElement(
        ctx,
        roughCanvas,
        erasing
          ? {
              ...element,
              isDeleted: false,
              style: { ...element.style, opacity: element.style.opacity * 0.3 },
            }
          : element,
      );
  }
  if (options.draft) drawElement(ctx, roughCanvas, options.draft);
  if (options.eraserTrail)
    drawEraserTrail(ctx, options.eraserTrail, viewport.zoom);
  ctx.restore();
  const selection = options.selection;
  if (selection && selection.size > 0) {
    const bounds = selectionBounds(document, selection);
    if (bounds) {
      const topLeft = worldToScreen({ x: bounds.x, y: bounds.y }, viewport);
      const bottomRight = worldToScreen(
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        viewport,
      );
      const padding = 6;
      const x = topLeft.x - padding;
      const y = topLeft.y - padding;
      const selectionWidth = bottomRight.x - topLeft.x + padding * 2;
      const selectionHeight = bottomRight.y - topLeft.y + padding * 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#fffdf8";
      ctx.lineWidth = 5;
      ctx.strokeRect(x, y, selectionWidth, selectionHeight);
      ctx.strokeStyle = "#6a52d9";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, selectionWidth, selectionHeight);
      ctx.setLineDash([]);
    }
  }
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}

function svgElement(element: DrawingElement): string {
  const style = `stroke:${escapeXml(element.style.stroke)};stroke-width:${element.style.strokeWidth};fill:${escapeXml(element.style.fill)};opacity:${element.style.opacity}`;
  const transform = `rotate(${element.angle} ${element.x + element.width / 2} ${element.y + element.height / 2})`;
  if (element.type === "rectangle")
    return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${element.style.roundness}" style="${style}"/>`;
  if (element.type === "ellipse")
    return `<ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${element.width / 2}" ry="${element.height / 2}" transform="${transform}" style="${style}"/>`;
  if (element.type === "diamond")
    return `<polygon points="${element.x + element.width / 2},${element.y} ${element.x + element.width},${element.y + element.height / 2} ${element.x + element.width / 2},${element.y + element.height} ${element.x},${element.y + element.height / 2}" transform="${transform}" style="${style}"/>`;
  if (element.type === "text") {
    const isNote = element.customData?.variant === "note";
    const padding = isNote ? DRAWING_NOTE_PADDING : 0;
    const noteBackground = isNote
      ? `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${element.style.roundness}" style="${style}"/>`
      : "";
    const textY = element.y + padding + element.style.fontSize;
    const date =
      isNote &&
      typeof element.customData?.createdAt === "number" &&
      Number.isFinite(element.customData.createdAt)
        ? new Date(element.customData.createdAt)
        : null;
    const dateLabel =
      date && !Number.isNaN(date.getTime())
        ? `<text x="${element.x + element.width - padding}" y="${element.y + element.height - padding}" text-anchor="end" font-family="${escapeXml(element.style.fontFamily)}" font-size="${DRAWING_NOTE_DATE_FONT_SIZE}" fill="${escapeXml(element.style.stroke)}" opacity="${element.style.opacity * 0.68}">Added ${escapeXml(new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date))}</text>`
        : "";
    return `${noteBackground}<text x="${element.x + padding}" y="${textY}" font-family="${escapeXml(element.style.fontFamily)}" font-size="${element.style.fontSize}" fill="${escapeXml(element.style.stroke)}" opacity="${element.style.opacity}">${escapeXml(element.text)}</text>${dateLabel}`;
  }
  if (
    element.type !== "line" &&
    element.type !== "arrow" &&
    element.type !== "freedraw"
  )
    return "";
  const points = element.points
    .map(
      (point) =>
        String(element.x + point.x) + "," + String(element.y + point.y),
    )
    .join(" ");
  return `<polyline points="${points}" fill="none" style="${style}"/>`;
}

export function renderSvg(
  document: DrawingDocument,
  options: Pick<DrawingExportOptions, "bounds" | "padding"> = {},
): string {
  const bounds =
    options.bounds === "viewport"
      ? { x: 0, y: 0, width: 1200, height: 800 }
      : documentBounds(document);
  const padding = options.padding ?? 32;
  const x = bounds.x - padding;
  const y = bounds.y - padding;
  const width = Math.max(1, bounds.width + padding * 2);
  const height = Math.max(1, bounds.height + padding * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeXml(document.background)}"/>${document.elements
    .filter((element) => !element.isDeleted)
    .map(svgElement)
    .join("")}</svg>`;
}

export async function exportDrawing(
  drawing: DrawingDocument,
  viewport: DrawingViewport,
  options: DrawingExportOptions,
): Promise<Blob> {
  if (options.format === "json")
    return new Blob([JSON.stringify(drawing, null, 2)], {
      type: "application/vnd.doory.drawing+json",
    });
  if (options.format === "svg")
    return new Blob([renderSvg(drawing, options)], { type: "image/svg+xml" });
  const bounds =
    options.bounds === "viewport"
      ? {
          x: viewport.scrollX,
          y: viewport.scrollY,
          width: 1200 / viewport.zoom,
          height: 800 / viewport.zoom,
        }
      : documentBounds(drawing);
  const padding = options.padding ?? 32;
  const scale = options.scale ?? 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil((bounds.width + padding * 2) * scale));
  canvas.height = Math.max(1, Math.ceil((bounds.height + padding * 2) * scale));
  const nextViewport: DrawingViewport = {
    zoom: scale,
    scrollX: bounds.x - padding,
    scrollY: bounds.y - padding,
  };
  renderDrawing(canvas, drawing, nextViewport, { dpr: 1, showDots: false });
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not export the drawing.")),
      "image/png",
    ),
  );
}
