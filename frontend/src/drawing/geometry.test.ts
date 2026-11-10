import {
  documentBounds,
  elementBounds,
  elementsInRect,
  hitTest,
  normalizeRect,
  noteTextHeight,
  screenToWorld,
  textLines,
  textBounds,
  viewportAtPoint,
  worldToScreen,
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
});
