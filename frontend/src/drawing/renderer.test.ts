import { blankDrawing, createElement } from "./model";
import {
  eraserTrailRadius,
  exportDrawing,
  gridLines,
  renderDrawing,
  renderSvg,
} from "./renderer";

vi.mock("roughjs", () => ({
  default: {
    canvas: vi.fn(() => ({
      ellipse: vi.fn(),
      polygon: vi.fn(),
      path: vi.fn(),
      rectangle: vi.fn(),
    })),
  },
}));

describe("grid rendering", () => {
  it("covers the full visible world area when zoomed in", () => {
    const viewport = { zoom: 2, scrollX: 0, scrollY: 0 };
    const lines = gridLines(800, 600, viewport);
    const vertical = lines.filter((line) => line.from.x === line.to.x);
    const horizontal = lines.filter((line) => line.from.y === line.to.y);

    expect(
      Math.max(...vertical.map((line) => line.to.x)),
    ).toBeGreaterThanOrEqual(800);
    expect(
      Math.max(...horizontal.map((line) => line.to.y)),
    ).toBeGreaterThanOrEqual(600);
    expect(vertical.filter((line) => line.major)).toHaveLength(5);
    expect(horizontal.filter((line) => line.major)).toHaveLength(4);
  });
});

describe("eraser preview rendering", () => {
  it("keeps the eraser largest at the cursor and tapers the trail behind it", () => {
    expect(eraserTrailRadius(0, 100, 1)).toBe(3);
    expect(eraserTrailRadius(50, 100, 1)).toBe(7);
    expect(eraserTrailRadius(100, 100, 1)).toBe(11);
    expect(eraserTrailRadius(50, 100, 2)).toBe(3.5);
    expect(eraserTrailRadius(0, 0, 1)).toBe(11);
  });

  it("draws the trail without a duplicate cursor circle", () => {
    const lineTo = vi.fn<(x: number, y: number) => void>();
    const context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      lineTo,
      moveTo: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(canvas, "clientHeight", {
      configurable: true,
      value: 600,
    });
    vi.spyOn(canvas, "getContext").mockReturnValue(context);

    renderDrawing(
      canvas,
      blankDrawing(),
      { zoom: 1, scrollX: 0, scrollY: 0 },
      {
        dpr: 1,
        showDots: false,
        eraserTrail: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 100, y: 0 },
        ],
      },
    );

    expect(lineTo).toHaveBeenCalledWith(50, 7);
    expect(lineTo).toHaveBeenCalledWith(100, 11);
    expect(lineTo).toHaveBeenCalledWith(100, -11);
    expect(lineTo).toHaveBeenCalledWith(0, -3);
    expect(context.arc).not.toHaveBeenCalled();
  });

  it("fades erased elements in place without a deletion outline", () => {
    const alphaValues: number[] = [];
    let alpha = 1;
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      globalAlpha: alpha,
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      translate: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperty(context, "globalAlpha", {
      configurable: true,
      get: () => alpha,
      set: (value: number) => {
        alpha = value;
        alphaValues.push(value);
      },
    });
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(canvas, "clientHeight", {
      configurable: true,
      value: 600,
    });
    vi.spyOn(canvas, "getContext").mockReturnValue(context);

    const element = createElement("rectangle", {
      id: "erased",
      width: 100,
      height: 60,
      isDeleted: true,
    });
    renderDrawing(
      canvas,
      { ...blankDrawing(), elements: [element] },
      { zoom: 1, scrollX: 0, scrollY: 0 },
      { dpr: 1, showDots: false, eraserTargets: new Set([element.id]) },
    );

    expect(alphaValues).toContain(0.3);
    expect(context.setLineDash).not.toHaveBeenCalled();
  });
});

describe("text export rendering", () => {
  it("keeps note wrapping and its footer clipped in SVG", () => {
    const note = createElement("text", {
      id: "note-export",
      x: 20,
      y: 30,
      width: 100,
      height: 80,
      text: "alpha beta supercalifragilistic",
      customData: { variant: "note", createdAt: Date.now() },
    });
    const svg = renderSvg(
      { ...blankDrawing(), elements: [note] },
      { bounds: "content", padding: 0 },
    );

    expect(svg).toContain('clipPath id="note-note-export"');
    expect(svg.match(/<tspan/g)?.length ?? 0).toBeGreaterThan(2);
    expect(svg).toContain("Added");
  });

  it("preserves SVG transforms, dash styles and arrowheads", () => {
    const rectangle = createElement("rectangle", {
      id: "rotated-rectangle",
      x: 20,
      y: 30,
      width: 100,
      height: 60,
      angle: 30,
      style: {
        ...createElement("rectangle").style,
        strokeStyle: "dashed",
      },
    });
    const text = createElement("text", {
      id: "rotated-text",
      x: 160,
      y: 40,
      width: 80,
      height: 30,
      angle: -15,
      text: "Hello",
    });
    const note = createElement("text", {
      id: "rotated-note",
      x: 260,
      y: 40,
      width: 100,
      height: 80,
      angle: 12,
      text: "Note",
      customData: { variant: "note" },
      style: {
        ...createElement("text").style,
        strokeStyle: "dotted",
      },
    });
    const arrow = createElement("arrow", {
      id: "styled-arrow",
      x: 40,
      y: 180,
      width: 120,
      height: 40,
      points: [
        { x: 0, y: 40 },
        { x: 60, y: 0 },
        { x: 120, y: 40 },
      ],
      startArrowhead: "arrow",
      endArrowhead: "triangle",
    });
    const svg = renderSvg(
      { ...blankDrawing(), elements: [rectangle, text, note, arrow] },
      { bounds: "content", padding: 0 },
    );

    expect(svg).toContain('transform="rotate(30 70 60)"');
    expect(svg).toContain('transform="rotate(-15 160 40)"');
    expect(svg).toContain('transform="rotate(12 260 40)"');
    expect(svg).toContain("stroke-dasharray:10 8");
    expect(svg).toContain("stroke-dasharray:2 6");
    expect(svg.match(/<polygon/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(svg).toContain('transform="rotate(0 100 200)"');
  });

  it("omits the SVG background and canvas fill for transparent exports", async () => {
    const transparentSvg = renderSvg(blankDrawing(), {
      bounds: "content",
      padding: 0,
      transparent: true,
    });
    const opaqueSvg = renderSvg(blankDrawing(), {
      bounds: "content",
      padding: 0,
    });
    expect(transparentSvg).not.toContain('fill="#ffffff"');
    expect(opaqueSvg).toContain('fill="#ffffff"');

    const fillRect = vi.fn();
    const context = {
      clearRect: vi.fn(),
      fillRect,
      restore: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      setTransform: vi.fn(),
      translate: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(canvas, "clientHeight", {
      configurable: true,
      value: 200,
    });
    vi.spyOn(canvas, "getContext").mockReturnValue(context);
    renderDrawing(
      canvas,
      blankDrawing(),
      { zoom: 1, scrollX: 0, scrollY: 0 },
      { dpr: 1, showDots: false, transparent: true },
    );
    expect(fillRect).not.toHaveBeenCalled();

    // The public export path also accepts the same option and returns an image blob.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob()),
    );
    await expect(
      exportDrawing(
        blankDrawing(),
        { zoom: 1, scrollX: 0, scrollY: 0 },
        { format: "png", bounds: "content", transparent: true },
      ),
    ).resolves.toBeInstanceOf(Blob);
  });
});
