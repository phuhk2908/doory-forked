import { createElement } from "./model";
import {
  bindLinearElement,
  createLinear,
  deleteElements,
  duplicateElements,
  expandSelectionToGroups,
  groupIdsInSelection,
  groupElements,
  insertLinearWaypoint,
  linearPoint,
  moveLinearEndpoint,
  moveLinearPoint,
  rotateElement,
  removeLinearWaypoint,
  resizeElement,
  resizeElements,
  syncBindings,
  bringForward,
  bringToFront,
  sendBackward,
  sendToBack,
  ungroupElements,
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

  it("expands a selection across nested group levels", () => {
    const nested = {
      ...document,
      elements: [
        { ...document.elements[0], groupIds: ["inner", "outer"] },
        { ...document.elements[1], groupIds: ["outer"] },
        createElement("diamond", { id: "three", groupIds: ["inner"] }),
        createElement("line", { id: "four", groupIds: ["unrelated"] }),
      ],
    };

    expect(expandSelectionToGroups(nested, new Set(["three"]))).toEqual(
      new Set(["one", "two", "three"]),
    );
    expect(groupIdsInSelection(nested, new Set(["one", "two"]))).toEqual([
      "outer",
    ]);
  });

  it("ungroups one level while preserving nested membership", () => {
    const nested = {
      ...document,
      elements: document.elements.map((element) => ({
        ...element,
        groupIds: ["inner", "outer"],
      })),
    };

    const ungrouped = ungroupElements(nested, new Set(["one", "two"]));
    expect(
      ungrouped.elements.every((element) =>
        element.groupIds?.includes("inner"),
      ),
    ).toBe(true);
    expect(
      ungrouped.elements.every(
        (element) => !element.groupIds?.includes("outer"),
      ),
    ).toBe(true);
  });

  it("does not ungroup a selection spanning unrelated groups", () => {
    const mixed = {
      ...document,
      elements: [
        { ...document.elements[0], groupIds: ["first"] },
        { ...document.elements[1], groupIds: ["second"] },
      ],
    };

    expect(ungroupElements(mixed, new Set(["one", "two"]))).toBe(mixed);
    expect(groupIdsInSelection(mixed, new Set(["one", "two"]))).toEqual([]);
  });

  it("moves layers by one step or to an edge without mutating elements", () => {
    const layers = {
      ...document,
      elements: [
        createElement("rectangle", { id: "a" }),
        createElement("rectangle", { id: "b" }),
        createElement("rectangle", { id: "c" }),
        createElement("rectangle", { id: "d" }),
      ],
    };
    const selection = new Set(["b", "c"]);
    expect(
      bringForward(layers, selection).elements.map((element) => element.id),
    ).toEqual(["a", "d", "b", "c"]);
    expect(
      sendBackward(layers, selection).elements.map((element) => element.id),
    ).toEqual(["b", "c", "a", "d"]);
    expect(
      bringToFront(layers, new Set(["b", "d"])).elements.map(
        (element) => element.id,
      ),
    ).toEqual(["a", "c", "b", "d"]);
    expect(
      sendToBack(layers, new Set(["b", "d"])).elements.map(
        (element) => element.id,
      ),
    ).toEqual(["b", "d", "a", "c"]);
    expect(layers.elements.map((element) => element.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("resizes a shape from a handle with a minimum size", () => {
    const shape = document.elements[0];
    const resized = resizeElement(shape, "se", { x: 80, y: 60 });

    expect(resized).toMatchObject({ x: 0, y: 0, width: 80, height: 60 });
    expect(resizeElement(shape, "se", { x: 2, y: 2 })).toMatchObject({
      width: 20,
      height: 20,
    });
    expect(resizeElement(shape, "nw", { x: 30, y: 30 })).toMatchObject({
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    });
  });

  it("keeps a note resize proportional when Shift is held", () => {
    const note = createElement("text", {
      width: 100,
      height: 50,
      text: "",
      customData: { variant: "note" },
    });
    const resized = resizeElement(note, "se", { x: 200, y: 100 }, true);

    expect(resized.width / resized.height).toBeCloseTo(2);
  });

  it("normalizes rotation and bumps the element version", () => {
    const shape = document.elements[0];
    const rotated = rotateElement(shape, -45);

    expect(rotated).toMatchObject({ angle: 315, version: shape.version + 1 });
    expect(rotated.versionNonce).toBe(shape.versionNonce + 1);
  });

  it("resizes a selected group around its shared bounds", () => {
    const resized = resizeElements(document, new Set(["one", "two"]), "se", {
      x: 60,
      y: 45,
    });

    expect(resized.elements[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 20,
      height: 15,
    });
    expect(resized.elements[1]).toMatchObject({
      x: 40,
      y: 30,
      width: 20,
      height: 15,
    });
  });

  it("binds an arrow endpoint and follows a moved target", () => {
    const target = createElement("rectangle", {
      id: "target",
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    const arrow = createLinear("arrow", { x: 40, y: 150 }, { x: 100, y: 150 });
    const bound = bindLinearElement({ ...document, elements: [target] }, arrow);
    expect(bound.endBinding).toMatchObject({ elementId: "target" });

    const movedTarget = { ...target, x: 150 };
    const synced = syncBindings(
      { ...document, elements: [movedTarget, bound] },
      new Set([target.id]),
    );
    const syncedArrow = synced.elements.find(
      (element) => element.id === bound.id,
    );
    expect(syncedArrow).toMatchObject({ x: 40, width: 110 });
    if (!syncedArrow || !("points" in syncedArrow))
      throw new Error("arrow missing");
    const last = syncedArrow.points[syncedArrow.points.length - 1];
    expect(syncedArrow.x + last.x).toBe(150);
    expect(syncedArrow.y + last.y).toBe(150);

    const detached = deleteElements(
      { ...document, elements: [target, bound] },
      new Set([target.id]),
    );
    expect(
      detached.elements.find((element) => element.id === bound.id),
    ).toMatchObject({
      endBinding: null,
    });
  });

  it("snaps a dragged endpoint to a target and detaches when it leaves", () => {
    const target = createElement("rectangle", {
      id: "target",
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    const arrow = createLinear("arrow", { x: 20, y: 150 }, { x: 40, y: 150 });
    const source = { ...document, elements: [target, arrow] };
    const connected = moveLinearEndpoint(source, arrow.id, "end", {
      x: 110,
      y: 150,
    });
    const connectedArrow = connected.document.elements.find(
      (element) => element.id === arrow.id,
    );
    expect(connected.targetId).toBe(target.id);
    expect(connectedArrow).toMatchObject({
      endBinding: { elementId: target.id },
    });
    if (!connectedArrow || !("points" in connectedArrow))
      throw new Error("arrow missing");
    const connectedEnd = connectedArrow.points.at(-1);
    expect(connectedArrow.x + (connectedEnd?.x ?? 0)).toBe(100);
    expect(connectedArrow.y + (connectedEnd?.y ?? 0)).toBe(150);

    const detached = moveLinearEndpoint(connected.document, arrow.id, "end", {
      x: 40,
      y: 40,
    });
    expect(detached.targetId).toBeNull();
    expect(
      detached.document.elements.find((element) => element.id === arrow.id),
    ).toMatchObject({ endBinding: null });
  });

  it("re-evaluates bindings when the connector itself moves", () => {
    const target = createElement("rectangle", {
      id: "target",
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    const arrow = bindLinearElement(
      { ...document, elements: [target] },
      createLinear("arrow", { x: 20, y: 150 }, { x: 100, y: 150 }),
    );
    const moved = { ...arrow, x: arrow.x + 200 };
    const synced = syncBindings(
      { ...document, elements: [target, moved] },
      new Set([arrow.id]),
    );
    expect(
      synced.elements.find((element) => element.id === arrow.id),
    ).toMatchObject({ endBinding: null });
  });

  it("inserts and moves connector waypoints without changing endpoints", () => {
    const arrow = createLinear("arrow", { x: 20, y: 40 }, { x: 180, y: 40 });
    const source = { ...document, elements: [...document.elements, arrow] };
    const inserted = insertLinearWaypoint(source, arrow.id, 0, {
      x: 100,
      y: 100,
    });

    expect(inserted?.index).toBe(1);
    const insertedArrow = inserted?.document.elements.find(
      (element) => element.id === arrow.id,
    );
    if (
      !insertedArrow ||
      (insertedArrow.type !== "line" && insertedArrow.type !== "arrow")
    )
      throw new Error("arrow missing after waypoint insertion");
    expect(insertedArrow.points).toHaveLength(3);
    expect(linearPoint(insertedArrow, 0)).toEqual({ x: 20, y: 40 });
    expect(linearPoint(insertedArrow, 1)).toEqual({ x: 100, y: 100 });
    expect(linearPoint(insertedArrow, 2)).toEqual({ x: 180, y: 40 });

    const moved = moveLinearPoint(inserted!.document, arrow.id, 1, {
      x: 120,
      y: 130,
    });
    expect(moved).not.toBeNull();
    const movedArrow = moved?.document.elements.find(
      (element) => element.id === arrow.id,
    );
    if (
      !movedArrow ||
      (movedArrow.type !== "line" && movedArrow.type !== "arrow")
    )
      throw new Error("arrow missing after waypoint move");
    expect(movedArrow).toMatchObject({ x: 20, y: 40, width: 160, height: 90 });
    expect(linearPoint(movedArrow, 0)).toEqual({ x: 20, y: 40 });
    expect(linearPoint(movedArrow, 1)).toEqual({ x: 120, y: 130 });
    expect(linearPoint(movedArrow, 2)).toEqual({ x: 180, y: 40 });

    const target = createElement("rectangle", {
      id: "waypoint-target",
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    const boundArrow = bindLinearElement(
      { ...document, elements: [target] },
      createLinear("arrow", { x: 20, y: 150 }, { x: 100, y: 150 }),
    );
    const boundInserted = insertLinearWaypoint(
      { ...document, elements: [target, boundArrow] },
      boundArrow.id,
      0,
      { x: 60, y: 180 },
    );
    const boundMoved = moveLinearPoint(
      boundInserted!.document,
      boundArrow.id,
      1,
      { x: 70, y: 200 },
    );
    const result = boundMoved?.document.elements.find(
      (element) => element.id === boundArrow.id,
    );
    expect(result).toMatchObject({
      endBinding: { elementId: target.id },
    });

    const removed = removeLinearWaypoint(moved!.document, arrow.id, 1);
    const removedArrow = removed?.elements.find(
      (element) => element.id === arrow.id,
    );
    expect(removedArrow).toMatchObject({ width: 160, height: 0 });
    if (
      !removedArrow ||
      (removedArrow.type !== "line" && removedArrow.type !== "arrow")
    )
      throw new Error("arrow missing after waypoint removal");
    expect(removedArrow.points).toHaveLength(2);
  });
});
