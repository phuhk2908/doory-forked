import { blankDrawing, createElement } from "./model";
import { gridLines, renderDrawing } from "./renderer";

vi.mock("roughjs", () => ({
  default: {
    canvas: vi.fn(() => ({
      ellipse: vi.fn(),
      polygon: vi.fn(),
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
