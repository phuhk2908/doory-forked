import {
  blankDrawing,
  createElement,
  mergeDrawingDocuments,
  restoreDrawing,
  styleWith,
} from "./model";

describe("drawing model", () => {
  it("restores a safe, bounded document and drops malformed elements", () => {
    const restored = restoreDrawing({
      schemaVersion: 1,
      background: "#fff",
      elements: [
        { ...createElement("rectangle"), width: 80, height: 40 },
        {
          id: "bad",
          type: "unknown",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          angle: 0,
        },
        {
          ...createElement("text"),
          text: "hello",
          style: styleWith({ fontSize: 30 }),
        },
      ],
    });
    expect(restored.elements).toHaveLength(2);
    expect(restored.elements[1]).toMatchObject({
      type: "text",
      text: "hello",
      style: { fontSize: 30 },
    });
  });

  it("falls back to an empty drawing for a future schema", () => {
    expect(restoreDrawing({ schemaVersion: 99, elements: [] })).toEqual(
      blankDrawing(),
    );
  });

  it("keeps element ids unique when restoring imported data", () => {
    const first = createElement("rectangle");
    const restored = restoreDrawing({
      schemaVersion: 1,
      elements: [first, { ...first, x: 20 }],
    });
    expect(restored.elements).toHaveLength(1);
  });

  it("merges independent room edits by element version", () => {
    const one = {
      ...createElement("rectangle"),
      id: "one",
      version: 2,
      versionNonce: 10,
    };
    const two = {
      ...createElement("ellipse"),
      id: "two",
      version: 1,
      versionNonce: 20,
    };
    const merged = mergeDrawingDocuments(
      { ...blankDrawing(), elements: [one] },
      { ...blankDrawing(), elements: [two] },
    );
    expect(merged.elements.map((element) => element.id)).toEqual([
      "one",
      "two",
    ]);
  });
});
