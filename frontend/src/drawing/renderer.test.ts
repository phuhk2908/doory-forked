import { gridLines } from "./renderer";

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
