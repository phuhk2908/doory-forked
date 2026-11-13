import {
  documentBounds,
  elementCorners,
  elementBounds,
  elementsHitBySegment,
  elementsInRect,
  hitTest,
  hitTestScene,
  normalizeRect,
  noteTextHeight,
  screenToWorld,
  snapToGrid,
  textLines,
  textBounds,
  viewportAtPoint,
  worldToScreen,
  zoomViewport,
} from "./geometry";
import { createElement, type TextElement } from "./model";

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

  it("uses a reciprocal zoom step so 100% returns from 110%", () => {
    const viewport = { zoom: 1, scrollX: -120, scrollY: -80 };
    const zoomedIn = zoomViewport(viewport, { x: 0, y: 0 }, "in");
    const restored = zoomViewport(zoomedIn, { x: 0, y: 0 }, "out");

    expect(zoomedIn.zoom).toBe(1.1);
    expect(restored.zoom).toBe(1);
  });

  it("snaps positive, negative, custom, and exact grid points", () => {
    expect(snapToGrid({ x: 18, y: 61 })).toEqual({ x: 0, y: 80 });
    expect(snapToGrid({ x: -21, y: -61 })).toEqual({ x: -40, y: -80 });
    expect(snapToGrid({ x: 13, y: -17 }, 10)).toEqual({ x: 10, y: -20 });
    expect(snapToGrid({ x: 80, y: -40 })).toEqual({ x: 80, y: -40 });
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

  it("ignores locked elements in every picking path", () => {
    const unlocked = createElement("rectangle", {
      id: "unlocked",
      x: 20,
      y: 30,
      width: 100,
      height: 50,
    });
    const locked = createElement("rectangle", {
      id: "locked",
      x: 20,
      y: 30,
      width: 100,
      height: 50,
      locked: true,
    });
    const document = {
      schemaVersion: 1 as const,
      elements: [unlocked, locked],
      background: "#fff",
    };

    expect(hitTest(locked, { x: 60, y: 50 }, 4)).toBe(false);
    expect(hitTestScene(document, { x: 60, y: 50 }, 4)).toBe(unlocked);
    expect(
      elementsHitBySegment(document, { x: 60, y: 50 }, { x: 60, y: 50 }, 4),
    ).toEqual([unlocked.id]);
    expect(
      elementsInRect(document, normalizeRect({ x: 0, y: 0 }, { x: 50, y: 50 })),
    ).toEqual([unlocked.id]);
  });

  it("sizes text bounds from the rendered content", () => {
    const text = createElement("text", {
      x: 20,
      y: 30,
      width: 240,
      height: 40,
      text: "Hi",
    }) as TextElement;
    const bounds = textBounds(text);

    expect(bounds.width).toBeLessThan(240);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it("wraps note text at the note width and breaks long words", () => {
    const note = createElement("text", {
      width: 72,
      height: 80,
      text: "alpha beta supercalifragilistic",
      customData: { variant: "note" },
    }) as TextElement;
    const lines = textLines(note, (value) => value.length * 8);

    expect(lines).toEqual([
      "alpha",
      "beta",
      "super",
      "calif",
      "ragil",
      "istic",
    ]);
    expect(noteTextHeight(note)).toBeGreaterThan(note.height);
  });

  it("includes rotated corners in element bounds", () => {
    const rectangle = createElement("rectangle", {
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      angle: 90,
    });

    expect(elementBounds(rectangle).x).toBeCloseTo(40);
    expect(elementBounds(rectangle).y).toBeCloseTo(-10);
    expect(elementBounds(rectangle).width).toBeCloseTo(40);
    expect(elementBounds(rectangle).height).toBeCloseTo(100);
  });

  it("returns visual corners in the same order as the rotated renderer frame", () => {
    const rectangle = createElement("rectangle", {
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      angle: 90,
    });

    const corners = elementCorners(rectangle);
    expect(corners[0]!.x).toBeCloseTo(80);
    expect(corners[0]!.y).toBeCloseTo(-10);
    expect(corners[1]!.x).toBeCloseTo(80);
    expect(corners[1]!.y).toBeCloseTo(90);
    expect(corners[2]!.x).toBeCloseTo(40);
    expect(corners[2]!.y).toBeCloseTo(90);
    expect(corners[3]!.x).toBeCloseTo(40);
    expect(corners[3]!.y).toBeCloseTo(-10);
  });

  it("bounds and picks rotated image elements like other rectangular elements", () => {
    const image = createElement("image", {
      id: "image",
      fileId: "asset",
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      angle: 90,
    });
    const document = {
      schemaVersion: 1 as const,
      elements: [image],
      background: "#fff",
    };

    const bounds = elementBounds(image);
    expect(bounds.x).toBeCloseTo(40);
    expect(bounds.y).toBeCloseTo(-10);
    expect(bounds.width).toBeCloseTo(40);
    expect(bounds.height).toBeCloseTo(100);
    expect(hitTest(image, { x: 60, y: 40 }, 4)).toBe(true);
    expect(hitTestScene(document, { x: 60, y: 40 }, 4)).toBe(image);
    expect(
      elementsHitBySegment(document, { x: 60, y: 40 }, { x: 60, y: 40 }, 4),
    ).toEqual([image.id]);
    expect(
      elementsInRect(document, { x: 40, y: -10, width: 40, height: 100 }),
    ).toEqual([image.id]);
  });
});
