import { createElement } from "./model";
import {
  deleteElements,
  duplicateElements,
  groupElements,
  updateElements,
} from "./scene";

const document = {
  schemaVersion: 1 as const,
  background: "#fff",
  elements: [
    createElement("rectangle", {
      id: "one",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }),
    createElement("ellipse", {
      id: "two",
      x: 20,
      y: 20,
      width: 10,
      height: 10,
    }),
  ],
};

describe("drawing scene operations", () => {
  it("updates and tombstones elements without mutating the input", () => {
    const updated = updateElements(document, new Set(["one"]), (element) => ({
      ...element,
      x: 12,
    }));
    const deleted = deleteElements(updated, new Set(["two"]));
    expect(document.elements[0].x).toBe(0);
    expect(updated.elements[0]).toMatchObject({ id: "one", x: 12 });
    expect(deleted.elements[1]).toMatchObject({ id: "two", isDeleted: true });
  });

  it("duplicates selected elements and assigns fresh ids", () => {
    const result = duplicateElements(document, new Set(["one"]));
    expect(result.ids).toHaveLength(1);
    expect(result.ids[0]).not.toBe("one");
    expect(result.document.elements).toHaveLength(3);
    expect(result.document.elements[2]).toMatchObject({ x: 24, y: 24 });
  });

  it("adds and removes group membership for selected elements", () => {
    const grouped = groupElements(document, new Set(["one", "two"]));
    expect(
      grouped.document.elements.every((element) =>
        element.groupIds?.includes(grouped.groupId),
      ),
    ).toBe(true);
  });
});
