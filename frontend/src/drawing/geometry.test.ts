import {
  documentBounds,
  elementsInRect,
  hitTest,
  normalizeRect,
  screenToWorld,
  viewportAtPoint,
  worldToScreen,
} from "./geometry";
import { createElement } from "./model";

describe("drawing geometry", () => {
  it("round-trips world and screen coordinates", () => {
    const viewport = { zoom: 2, scrollX: 100, scrollY: -40 };
    const world = { x: 230, y: 90 };
    expect(screenToWorld(worldToScreen(world, viewport), viewport)).toEqual(
      world,
    );
  });

  it("keeps the point under the cursor while zooming", () => {
    const viewport = { zoom: 1, scrollX: 0, scrollY: 0 };
    const cursor = { x: 400, y: 220 };
    const next = viewportAtPoint(viewport, cursor, 2);
    expect(worldToScreen(screenToWorld(cursor, viewport), next)).toEqual(
      cursor,
    );
  });

  it("finds shapes in a lasso and tests their interior", () => {
    const rectangle = createElement("rectangle", {
      x: 20,
      y: 30,
      width: 100,
      height: 50,
    });
    const document = {
      schemaVersion: 1 as const,
      elements: [rectangle],
      background: "#fff",
    };
    expect(hitTest(rectangle, { x: 60, y: 50 }, 4)).toBe(true);
    expect(
      elementsInRect(document, normalizeRect({ x: 0, y: 0 }, { x: 50, y: 50 })),
    ).toEqual([rectangle.id]);
    expect(documentBounds(document)).toMatchObject({
      x: 20,
      y: 30,
      width: 100,
      height: 50,
    });
  });
});
