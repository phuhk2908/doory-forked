import { createElement, type LinearElement } from "./model";
import { elementBounds } from "./geometry";
import {
  alignElements,
  bindLinearElement,
  createLinear,
  deleteElements,
  distributeElements,
  duplicateElements,
  expandSelectionToGroups,
  flipElements,
  groupIdsInSelection,
  groupElements,
  insertLinearWaypoint,
  linearPoint,
  moveLinearEndpoint,
  moveLinearPoint,
  orthogonalizeConnector,
  rotateElement,
  removeLinearWaypoint,
  reverseConnector,
  resizeElement,
  resizeElements,
  rotateElements,
  snapSelectionTranslation,
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

  it("rotates a selection around its shared centre without mutating input", () => {
    const first = createElement("rectangle", {
      id: "rotate-first",
      x: 20,
      y: 30,
      width: 40,
      height: 40,
    });
    const second = createElement("ellipse", {
      id: "rotate-second",
      x: 140,
      y: 30,
      width: 40,
      height: 40,
    });
    const source = { ...document, elements: [first, second] };
    const rotated = rotateElements(source, new Set([first.id, second.id]), 90);

    expect(rotated.elements).toMatchObject([
      { id: first.id, x: 80, y: -30, angle: 90 },
      { id: second.id, x: 80, y: 90, angle: 90 },
    ]);
    expect(source.elements).toMatchObject([
      { id: first.id, x: 20, y: 30, angle: 0 },
      { id: second.id, x: 140, y: 30, angle: 0 },
    ]);
  });

  it("rotates connector geometry with the selection instead of leaving endpoints behind", () => {
    const arrow = createLinear("arrow", { x: 10, y: 0 }, { x: 30, y: 0 });
    const source = { ...document, elements: [arrow] };
    const rotated = rotateElements(source, new Set([arrow.id]), 90, {
      x: 0,
      y: 0,
    });

    const result = rotated.elements[0] as LinearElement;
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(10);
    expect(result.width).toBeCloseTo(0);
    expect(result.height).toBeCloseTo(20);
    expect(result.angle).toBe(0);
    expect(result.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(result.points[1]?.x).toBeCloseTo(0);
    expect(result.points[1]?.y).toBeCloseTo(20);
  });

  it("snaps selection edges and centres to nearby object anchors", () => {
    const moving = createElement("rectangle", {
      id: "snap-moving",
      x: 20,
      y: 20,
      width: 40,
      height: 40,
    });
    const target = createElement("ellipse", {
      id: "snap-target",
      x: 140,
      y: 100,
      width: 60,
      height: 40,
    });
    const source = { ...document, elements: [moving, target] };
    const result = snapSelectionTranslation(
      source,
      new Set([moving.id]),
      78,
      78,
      { tolerance: 8 },
    );

    expect(result).toMatchObject({ dx: 80, dy: 80 });
    expect(result.guides).toEqual([
      { axis: "vertical", position: 140, targetId: target.id },
      { axis: "horizontal", position: 100, targetId: target.id },
    ]);
  });

  it("prefers a locked object snap over the grid and falls back to the grid", () => {
    const moving = createElement("rectangle", {
      id: "snap-grid-moving",
      x: 20,
      y: 20,
      width: 40,
      height: 40,
    });
    const lockedTarget = createElement("rectangle", {
      id: "snap-locked-target",
      x: 180,
      y: 20,
      width: 40,
      height: 40,
      locked: true,
    });
    const source = { ...document, elements: [moving, lockedTarget] };
    const objectSnap = snapSelectionTranslation(
      source,
      new Set([moving.id]),
      118,
      0,
      { tolerance: 8, snapToGrid: true },
    );
    expect(objectSnap.dx).toBe(120);
    expect(objectSnap.guides).toContainEqual({
      axis: "vertical",
      position: 180,
      targetId: lockedTarget.id,
    });

    const gridSnap = snapSelectionTranslation(
      { ...document, elements: [moving] },
      new Set([moving.id]),
      18,
      0,
      { tolerance: 8, snapToGrid: true },
    );
    expect(gridSnap).toMatchObject({ dx: 20, dy: 20, guides: [] });
  });

  it("treats grouped elements as one snapping unit and ignores selected targets", () => {
    const first = createElement("rectangle", {
      id: "snap-group-first",
      x: 20,
      y: 20,
      width: 20,
      height: 20,
      groupIds: ["snap-group"],
    });
    const second = createElement("rectangle", {
      id: "snap-group-second",
      x: 60,
      y: 20,
      width: 20,
      height: 20,
      groupIds: ["snap-group"],
    });
    const target = createElement("rectangle", {
      id: "snap-group-target",
      x: 120,
      y: 20,
      width: 20,
      height: 20,
    });
    const source = { ...document, elements: [first, second, target] };
    const result = snapSelectionTranslation(
      source,
      new Set([first.id]),
      38,
      0,
      { tolerance: 8 },
    );

    expect(result.dx).toBe(40);
    expect(result.guides).toContainEqual({
      axis: "vertical",
      position: 120,
      targetId: target.id,
    });
  });

  it("chooses the closest live anchor at negative coordinates", () => {
    const moving = createElement("rectangle", {
      id: "snap-negative-moving",
      x: -100,
      y: -50,
      width: 20,
      height: 20,
    });
    const closest = createElement("rectangle", {
      id: "snap-negative-closest",
      x: -30,
      y: -50,
      width: 20,
      height: 20,
    });
    const farther = createElement("rectangle", {
      id: "snap-negative-farther",
      x: -20,
      y: -50,
      width: 20,
      height: 20,
    });
    const deleted = createElement("rectangle", {
      id: "snap-negative-deleted",
      x: -31,
      y: -50,
      width: 20,
      height: 20,
      isDeleted: true,
    });
    const source = {
      ...document,
      elements: [moving, closest, farther, deleted],
    };
    const result = snapSelectionTranslation(
      source,
      new Set([moving.id]),
      49,
      0,
      { tolerance: 8 },
    );

    expect(result.dx).toBe(50);
    expect(result.guides).toContainEqual({
      axis: "vertical",
      position: -30,
      targetId: closest.id,
    });
    expect(result.guides).not.toContainEqual(
      expect.objectContaining({ targetId: deleted.id }),
    );
  });

  it("does not snap an unlocked group member to a locked sibling", () => {
    const moving = createElement("rectangle", {
      id: "snap-mixed-group-moving",
      x: 20,
      y: 20,
      width: 20,
      height: 20,
      groupIds: ["snap-mixed-group"],
    });
    const lockedSibling = createElement("rectangle", {
      id: "snap-mixed-group-locked",
      x: 100,
      y: 20,
      width: 20,
      height: 20,
      groupIds: ["snap-mixed-group"],
      locked: true,
    });
    const result = snapSelectionTranslation(
      { ...document, elements: [moving, lockedSibling] },
      new Set([moving.id]),
      58,
      0,
      { tolerance: 8 },
    );

    expect(result).toEqual({ dx: 58, dy: 0, guides: [], spacingGuides: [] });
  });

  it("snaps an object into equal horizontal and vertical gaps", () => {
    const left = createElement("rectangle", {
      id: "spacing-left",
      x: 0,
      y: 20,
      width: 40,
      height: 40,
    });
    const moving = createElement("rectangle", {
      id: "spacing-moving",
      x: 100,
      y: 20,
      width: 40,
      height: 40,
    });
    const right = createElement("rectangle", {
      id: "spacing-right",
      x: 220,
      y: 20,
      width: 40,
      height: 40,
    });
    const source = { ...document, elements: [left, moving, right] };
    const horizontal = snapSelectionTranslation(
      source,
      new Set([moving.id]),
      12,
      0,
      { tolerance: 8 },
    );

    expect(horizontal.dx).toBe(10);
    expect(horizontal.spacingGuides).toEqual([
      expect.objectContaining({ axis: "horizontal", gap: 70 }),
    ]);

    const top = createElement("rectangle", {
      id: "spacing-top",
      x: 20,
      y: 0,
      width: 40,
      height: 40,
    });
    const verticalMoving = createElement("rectangle", {
      id: "spacing-vertical-moving",
      x: 20,
      y: 100,
      width: 40,
      height: 40,
    });
    const bottom = createElement("rectangle", {
      id: "spacing-bottom",
      x: 20,
      y: 220,
      width: 40,
      height: 40,
    });
    const vertical = snapSelectionTranslation(
      { ...document, elements: [top, verticalMoving, bottom] },
      new Set([verticalMoving.id]),
      0,
      12,
      { tolerance: 8 },
    );

    expect(vertical.dy).toBe(10);
    expect(vertical.spacingGuides).toEqual([
      expect.objectContaining({ axis: "vertical", gap: 70 }),
    ]);
  });

  it("does not offer spacing hints for overlap or multi-unit selections", () => {
    const first = createElement("rectangle", {
      id: "spacing-overlap-first",
      x: 0,
      y: 20,
      width: 80,
      height: 40,
    });
    const moving = createElement("rectangle", {
      id: "spacing-overlap-moving",
      x: 70,
      y: 20,
      width: 40,
      height: 40,
    });
    const second = createElement("rectangle", {
      id: "spacing-overlap-second",
      x: 160,
      y: 20,
      width: 80,
      height: 40,
    });
    const source = { ...document, elements: [first, moving, second] };
    const overlap = snapSelectionTranslation(
      source,
      new Set([moving.id]),
      0,
      0,
      { tolerance: 8 },
    );
    expect(overlap.spacingGuides).toEqual([]);

    const secondMoving = createElement("rectangle", {
      id: "spacing-multi-moving",
      x: 300,
      y: 20,
      width: 40,
      height: 40,
    });
    const multi = snapSelectionTranslation(
      { ...document, elements: [moving, secondMoving, first, second] },
      new Set([moving.id, secondMoving.id]),
      12,
      0,
      { tolerance: 8 },
    );
    expect(multi.spacingGuides).toEqual([]);
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

  it.each([
    ["left", (bounds: ReturnType<typeof elementBounds>) => bounds.x],
    [
      "center",
      (bounds: ReturnType<typeof elementBounds>) => bounds.x + bounds.width / 2,
    ],
    [
      "right",
      (bounds: ReturnType<typeof elementBounds>) => bounds.x + bounds.width,
    ],
    ["top", (bounds: ReturnType<typeof elementBounds>) => bounds.y],
    [
      "middle",
      (bounds: ReturnType<typeof elementBounds>) =>
        bounds.y + bounds.height / 2,
    ],
    [
      "bottom",
      (bounds: ReturnType<typeof elementBounds>) => bounds.y + bounds.height,
    ],
  ] as const)("aligns selected bounds to %s", (alignment, edge) => {
    const source = {
      ...document,
      elements: [
        createElement("rectangle", {
          id: "align-first",
          x: 10,
          y: 20,
          width: 40,
          height: 20,
        }),
        createElement("ellipse", {
          id: "align-second",
          x: 100,
          y: 60,
          width: 20,
          height: 40,
        }),
        createElement("diamond", {
          id: "align-third",
          x: 180,
          y: 10,
          width: 30,
          height: 30,
        }),
      ],
    };
    const aligned = alignElements(
      source,
      new Set(["align-first", "align-second", "align-third"]),
      alignment,
    );
    const values = aligned.elements.map((element) =>
      edge(elementBounds(element)),
    );
    expect(values[1]).toBeCloseTo(values[0] ?? 0);
    expect(values[2]).toBeCloseTo(values[0] ?? 0);
    expect(aligned.elements.map((element) => element.id)).toEqual(
      source.elements.map((element) => element.id),
    );
  });

  it("aligns by rotated bounds, expands groups, and preserves bindings", () => {
    const target = createElement("rectangle", {
      id: "align-target",
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      groupIds: ["align-group"],
    });
    const groupMember = createElement("ellipse", {
      id: "align-member",
      x: 30,
      y: 0,
      width: 10,
      height: 10,
      groupIds: ["align-group"],
    });
    const other = createElement("rectangle", {
      id: "align-other",
      x: 120,
      y: 30,
      width: 20,
      height: 20,
      angle: 45,
    });
    const arrow = bindLinearElement(
      { ...document, elements: [target, other] },
      createLinear("arrow", { x: 20, y: 10 }, { x: 120, y: 40 }),
    );
    const source = {
      ...document,
      elements: [target, groupMember, other, arrow],
    };

    const aligned = alignElements(
      source,
      new Set([target.id, other.id]),
      "left",
    );
    const targetBounds = elementBounds(
      aligned.elements.find((element) => element.id === target.id)!,
    );
    const otherBounds = elementBounds(
      aligned.elements.find((element) => element.id === other.id)!,
    );
    const member = aligned.elements.find(
      (element) => element.id === groupMember.id,
    )!;
    const alignedArrow = aligned.elements.find(
      (element) => element.id === arrow.id,
    );

    expect(otherBounds.x).toBeCloseTo(targetBounds.x);
    expect(member.x).toBeCloseTo(groupMember.x);
    expect(member.groupIds).toEqual(groupMember.groupIds);
    expect(alignedArrow).toMatchObject({
      startBinding: { elementId: target.id },
      endBinding: { elementId: other.id },
    });
    expect(alignedArrow).not.toBe(arrow);
  });

  it("uses the outermost nested group as one alignment unit", () => {
    const nestedFirst = createElement("rectangle", {
      id: "nested-first",
      x: 100,
      y: 20,
      width: 20,
      height: 20,
      groupIds: ["inner", "outer"],
    });
    const nestedSecond = createElement("ellipse", {
      id: "nested-second",
      x: 140,
      y: 30,
      width: 20,
      height: 20,
      groupIds: ["outer"],
    });
    const other = createElement("diamond", {
      id: "nested-other",
      x: 0,
      y: 80,
      width: 20,
      height: 20,
    });
    const source = {
      ...document,
      elements: [nestedFirst, nestedSecond, other],
    };

    const aligned = alignElements(
      source,
      new Set([nestedFirst.id, other.id]),
      "left",
    );
    expect(aligned.elements.map((element) => element.x)).toEqual([0, 40, 0]);
  });

  it("returns the original document when alignment cannot move anything", () => {
    expect(alignElements(document, new Set(["one"]), "left")).toBe(document);
    const aligned = alignElements(document, new Set(["one", "two"]), "left");
    expect(alignElements(aligned, new Set(["one", "two"]), "left")).toBe(
      aligned,
    );
  });

  it.each([
    ["horizontal", "x"],
    ["vertical", "y"],
  ] as const)("distributes units with equal %s gaps", (axis, coordinate) => {
    const source = {
      ...document,
      elements: [
        createElement("rectangle", {
          id: "distribution-first",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        }),
        createElement("ellipse", {
          id: "distribution-middle",
          x: axis === "horizontal" ? 30 : 0,
          y: axis === "vertical" ? 30 : 0,
          width: 20,
          height: 20,
        }),
        createElement("diamond", {
          id: "distribution-last",
          x: axis === "horizontal" ? 100 : 0,
          y: axis === "vertical" ? 100 : 0,
          width: 10,
          height: 10,
        }),
      ],
    };
    const distributed = distributeElements(
      source,
      new Set(source.elements.map((element) => element.id)),
      axis,
    );
    const bounds = distributed.elements.map((element) =>
      elementBounds(element),
    );
    const firstStart = bounds[0]![coordinate];
    const middleStart = bounds[1]![coordinate];
    const lastStart = bounds[2]![coordinate];
    const firstSize = coordinate === "x" ? bounds[0]!.width : bounds[0]!.height;
    const middleSize =
      coordinate === "x" ? bounds[1]!.width : bounds[1]!.height;
    const firstGap = middleStart - (firstStart + firstSize);
    const secondGap = lastStart - (middleStart + middleSize);
    expect(secondGap).toBeCloseTo(firstGap);
    expect(firstStart).toBeCloseTo(0);
    expect(
      lastStart + (coordinate === "x" ? bounds[2]!.width : bounds[2]!.height),
    ).toBeCloseTo(110);
  });

  it("distributes expanded groups by rotated bounds and keeps bindings", () => {
    const target = createElement("rectangle", {
      id: "distribution-target",
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      groupIds: ["distribution-group"],
    });
    const member = createElement("ellipse", {
      id: "distribution-member",
      x: 30,
      y: 0,
      width: 10,
      height: 10,
      groupIds: ["distribution-group"],
    });
    const rotated = createElement("rectangle", {
      id: "distribution-rotated",
      x: 120,
      y: 30,
      width: 20,
      height: 20,
      angle: 45,
    });
    const last = createElement("diamond", {
      id: "distribution-last",
      x: 240,
      y: 0,
      width: 10,
      height: 10,
    });
    const arrow = bindLinearElement(
      { ...document, elements: [target, rotated] },
      createLinear("arrow", { x: 20, y: 10 }, { x: 120, y: 40 }),
    );
    const source = {
      ...document,
      elements: [target, member, rotated, last, arrow],
    };
    const distributed = distributeElements(
      source,
      new Set([target.id, rotated.id, last.id]),
      "horizontal",
    );
    const movedMember = distributed.elements.find(
      (element) => element.id === member.id,
    )!;
    const movedRotated = distributed.elements.find(
      (element) => element.id === rotated.id,
    )!;
    const movedArrow = distributed.elements.find(
      (element) => element.id === arrow.id,
    );

    expect(movedMember.x - member.x).toBeCloseTo(
      distributed.elements.find((element) => element.id === target.id)!.x -
        target.x,
    );
    expect(movedRotated.angle).toBe(rotated.angle);
    expect(movedRotated.width).toBe(rotated.width);
    expect(movedRotated.height).toBe(rotated.height);
    expect(movedArrow).toMatchObject({
      startBinding: { elementId: target.id },
      endBinding: { elementId: rotated.id },
    });
    expect(movedArrow).not.toBe(arrow);
  });

  it("returns the original document when distribution has fewer than three units or equal gaps", () => {
    expect(
      distributeElements(document, new Set(["one", "two"]), "horizontal"),
    ).toBe(document);
    const evenlySpaced = {
      ...document,
      elements: [
        createElement("rectangle", {
          id: "even-first",
          x: 0,
          width: 10,
          height: 10,
        }),
        createElement("rectangle", {
          id: "even-middle",
          x: 20,
          width: 10,
          height: 10,
        }),
        createElement("rectangle", {
          id: "even-last",
          x: 40,
          width: 10,
          height: 10,
        }),
      ],
    };
    expect(
      distributeElements(
        evenlySpaced,
        new Set(evenlySpaced.elements.map((element) => element.id)),
        "horizontal",
      ),
    ).toBe(evenlySpaced);
  });

  it("orthogonalizes a connector along its longer axis and preserves metadata", () => {
    const target = createElement("rectangle", {
      id: "orthogonal-target",
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });
    const sourceArrow = bindLinearElement(
      { ...document, elements: [target] },
      createLinear(
        "arrow",
        { x: 20, y: 10 },
        { x: 100, y: 40 },
        {
          stroke: "#7c3aed",
        },
      ),
    );
    const source = { ...document, elements: [target, sourceArrow] };

    const orthogonal = orthogonalizeConnector(source, sourceArrow.id);
    const result = orthogonal.elements.find(
      (element) => element.id === sourceArrow.id,
    )!;
    expect(result).toMatchObject({
      id: sourceArrow.id,
      type: "arrow",
      startBinding: { elementId: target.id },
      endArrowhead: "arrow",
      style: { stroke: "#7c3aed" },
    });
    expect([
      linearPoint(result as LinearElement, 0),
      linearPoint(result as LinearElement, 1),
      linearPoint(result as LinearElement, 2),
    ]).toEqual([
      { x: 20, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 40 },
    ]);
    expect(result.version).toBe(sourceArrow.version + 1);
  });

  it("uses a vertical-first route when the vertical distance is longer", () => {
    const line = createLinear("line", { x: 30, y: 20 }, { x: 50, y: 180 });
    const routed = orthogonalizeConnector(
      { ...document, elements: [line] },
      line.id,
    );
    const result = routed.elements[0]! as LinearElement;
    expect(result.points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 160 },
      { x: 20, y: 160 },
    ]);
    expect(result.x).toBe(30);
    expect(result.y).toBe(20);
  });

  it("reverses connector points, bindings, and arrowheads together", () => {
    const target = createElement("rectangle", {
      id: "reverse-target",
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });
    const sourceArrow = bindLinearElement(
      { ...document, elements: [target] },
      createLinear("arrow", { x: 20, y: 10 }, { x: 100, y: 40 }),
    );
    const source = { ...document, elements: [target, sourceArrow] };
    const reversed = reverseConnector(source, sourceArrow.id);
    const result = reversed.elements.find(
      (element) => element.id === sourceArrow.id,
    )! as LinearElement;

    expect(result.points).toEqual([
      { x: 80, y: 30 },
      { x: 0, y: 0 },
    ]);
    expect(result.startBinding).toBeNull();
    expect(result.endBinding).toMatchObject({ elementId: target.id });
    expect(result.startArrowhead).toBe("arrow");
    expect(result.endArrowhead).toBeNull();
    expect(result.version).toBe(sourceArrow.version + 1);
  });

  it("flips a rotated selection around its visible centre", () => {
    const rectangle = createElement("rectangle", {
      id: "flip-rectangle",
      x: 0,
      y: 20,
      width: 20,
      height: 40,
      angle: 30,
    });
    const line = createLinear("line", { x: 80, y: 20 }, { x: 120, y: 60 });
    const source = { ...document, elements: [rectangle, line] };
    const flipped = flipElements(
      source,
      new Set([rectangle.id, line.id]),
      "horizontal",
    );
    const result = flipped.elements[0]!;
    const lineResult = flipped.elements[1]! as LinearElement;

    expect(result.angle).toBe(330);
    expect(result.x).toBeCloseTo(91.33974596215563);
    expect(lineResult.points).toEqual([
      { x: 40, y: 0 },
      { x: 0, y: 40 },
    ]);
    expect(lineResult.x).toBeCloseTo(-8.660254037844386);
    expect(lineResult.y).toBe(20);
  });

  it("flips both members of a selected group and re-syncs connector bindings", () => {
    const leftTarget = createElement("rectangle", {
      id: "flip-left-target",
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      groupIds: ["flip-group"],
    });
    const rightTarget = createElement("rectangle", {
      id: "flip-right-target",
      x: 100,
      y: 0,
      width: 20,
      height: 20,
      groupIds: ["flip-group"],
    });
    const arrow = bindLinearElement(
      { ...document, elements: [leftTarget, rightTarget] },
      createLinear("arrow", { x: 20, y: 10 }, { x: 100, y: 10 }),
    );
    const source = {
      ...document,
      elements: [leftTarget, rightTarget, arrow],
    };
    const flipped = flipElements(
      source,
      new Set([leftTarget.id]),
      "horizontal",
    );
    const flippedArrow = flipped.elements[2]! as LinearElement;

    expect(flipped.elements[0]).toMatchObject({ x: 100 });
    expect(flipped.elements[1]).toMatchObject({ x: 0 });
    expect(flippedArrow.startBinding).toMatchObject({
      elementId: leftTarget.id,
    });
    expect(flippedArrow.endBinding).toMatchObject({
      elementId: rightTarget.id,
    });
  });

  it("returns the original document when flip selection contains text or locked elements", () => {
    const shape = createElement("rectangle", { id: "flip-shape", x: 0 });
    const text = createElement("text", {
      id: "flip-text",
      x: 40,
      text: "Keep readable",
    });
    const locked = createElement("ellipse", {
      id: "flip-locked",
      x: 80,
      locked: true,
    });
    const source = { ...document, elements: [shape, text, locked] };

    expect(flipElements(source, new Set([shape.id, text.id]), "vertical")).toBe(
      source,
    );
    expect(
      flipElements(source, new Set([shape.id, locked.id]), "vertical"),
    ).toBe(source);
  });

  it("detaches a connector binding when its target is outside the flipped selection", () => {
    const target = createElement("rectangle", {
      id: "flip-detach-target",
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });
    const arrow = bindLinearElement(
      { ...document, elements: [target] },
      createLinear("arrow", { x: 20, y: 10 }, { x: 100, y: 10 }),
    );
    const source = { ...document, elements: [target, arrow] };
    const flipped = flipElements(source, new Set([arrow.id]), "horizontal");
    const result = flipped.elements[1]! as LinearElement;

    expect(result.startBinding).toBeNull();
    expect(result.endBinding).toBeNull();
  });

  it("does not create history-worthy changes for orthogonal, locked, rotated, or degenerate connectors", () => {
    const orthogonal = createLinear("line", { x: 0, y: 0 }, { x: 100, y: 0 });
    const locked = createLinear("line", { x: 0, y: 0 }, { x: 100, y: 40 });
    const rotated = rotateElement(
      createLinear("line", { x: 0, y: 0 }, { x: 100, y: 40 }),
      20,
    );
    const degenerate = createLinear("line", { x: 10, y: 10 }, { x: 10, y: 10 });
    const source = {
      ...document,
      elements: [orthogonal, { ...locked, locked: true }, rotated, degenerate],
    };

    expect(orthogonalizeConnector(source, orthogonal.id)).toBe(source);
    expect(orthogonalizeConnector(source, locked.id)).toBe(source);
    expect(orthogonalizeConnector(source, rotated.id)).toBe(source);
    expect(orthogonalizeConnector(source, degenerate.id)).toBe(source);
    expect(reverseConnector(source, rotated.id)).toBe(source);
    expect(reverseConnector(source, locked.id)).toBe(source);
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
    const broughtForward = bringForward(layers, selection);
    expect(broughtForward.order).toEqual(["a", "d", "b", "c"]);
    expect(broughtForward.orderVersion).toBe(1);
    expect(broughtForward.elements.map((element) => element.id)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
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
    expect(rotated.versionNonce).not.toBe(shape.versionNonce);
  });

  it("gives concurrent transforms distinct nonces for deterministic merges", () => {
    const shape = document.elements[0];
    const random = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.2);

    try {
      const first = rotateElement(shape, 15);
      const second = rotateElement(shape, 30);

      expect(first.version).toBe(shape.version + 1);
      expect(second.version).toBe(shape.version + 1);
      expect(first.versionNonce).not.toBe(second.versionNonce);
    } finally {
      random.mockRestore();
    }
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
