import { blankDrawing, createElement } from "./model";
import {
  eraserTrailRadius,
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
});
