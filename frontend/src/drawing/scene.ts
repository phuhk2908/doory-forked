import {
  createElement,
  styleWith,
  type DrawingDocument,
  type DrawingElement,
  type DrawingPoint,
  newElementId,
  type LinearElement,
  type TextElement,
  updateElement,
} from "./model";

export function addElements(
  document: DrawingDocument,
  elements: readonly DrawingElement[],
): DrawingDocument {
  return { ...document, elements: [...document.elements, ...elements] };
}

export function replaceElements(
  document: DrawingDocument,
  elements: readonly DrawingElement[],
): DrawingDocument {
  return { ...document, elements: [...elements] };
}

export function updateElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
  updater: (element: DrawingElement) => DrawingElement,
): DrawingDocument {
  return replaceElements(
    document,
    document.elements.map((element) =>
      ids.has(element.id) ? updater(element) : element,
    ),
  );
}

export function deleteElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  return updateElements(document, ids, (element) =>
    updateElement(element, { isDeleted: true }),
  );
}

export function duplicateElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): { document: DrawingDocument; ids: string[] } {
  const copies = document.elements
    .filter((element) => ids.has(element.id) && !element.isDeleted)
    .map((element) => ({
      ...element,
      id: newElementId(),
      x: element.x + 24,
      y: element.y + 24,
      version: 1,
      versionNonce: element.versionNonce + 1,
      groupIds: element.groupIds ? [...element.groupIds] : undefined,
      ...(element.type === "freedraw" ||
      element.type === "line" ||
      element.type === "arrow"
        ? { points: element.points.map((point) => ({ ...point })) }
        : {}),
    }));
  return {
    document: addElements(document, copies),
    ids: copies.map((element) => element.id),
  };
}

export function bringForward(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  const selected = document.elements.filter((element) => ids.has(element.id));
  const rest = document.elements.filter((element) => !ids.has(element.id));
  return replaceElements(document, [...rest, ...selected]);
}

export function sendBackward(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  const selected = document.elements.filter((element) => ids.has(element.id));
  const rest = document.elements.filter((element) => !ids.has(element.id));
  return replaceElements(document, [...selected, ...rest]);
}

export function groupElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): { document: DrawingDocument; groupId: string } {
  const groupId = newElementId();
  return {
    document: updateElements(document, ids, (element) => ({
      ...element,
      groupIds: [...(element.groupIds ?? []), groupId],
      version: element.version + 1,
      versionNonce: element.versionNonce + 1,
    })),
    groupId,
  };
}

export function ungroupElements(
  document: DrawingDocument,
  ids: ReadonlySet<string>,
): DrawingDocument {
  const groups = new Set(
    document.elements
      .filter((element) => ids.has(element.id))
      .flatMap((element) => element.groupIds ?? []),
  );
  return updateElements(
    document,
    new Set(
      document.elements
        .filter((element) =>
          (element.groupIds ?? []).some((group) => groups.has(group)),
        )
        .map((element) => element.id),
    ),
    (element) => ({
      ...element,
      groupIds: (element.groupIds ?? []).filter((group) => !groups.has(group)),
      version: element.version + 1,
      versionNonce: element.versionNonce + 1,
    }),
  );
}

export function createShape(
  type: "rectangle" | "ellipse" | "diamond",
  start: DrawingPoint,
  end: DrawingPoint,
): DrawingElement {
  return createElement(type, {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  });
}

export function createLinear(
  type: "line" | "arrow",
  start: DrawingPoint,
  end: DrawingPoint,
): LinearElement {
  return createElement(type, {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    points: [
      {
        x: start.x - Math.min(start.x, end.x),
        y: start.y - Math.min(start.y, end.y),
      },
      {
        x: end.x - Math.min(start.x, end.x),
        y: end.y - Math.min(start.y, end.y),
      },
    ],
    endArrowhead: type === "arrow" ? "arrow" : null,
  }) as LinearElement;
}

export function createFreedraw(
  points: readonly DrawingPoint[],
): DrawingElement {
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return createElement("freedraw", {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y,
    points: points.map((point) => ({
      ...point,
      x: point.x - x,
      y: point.y - y,
    })),
  });
}

export function createText(x: number, y: number): TextElement {
  return createElement("text", {
    x,
    y,
    width: 240,
    height: 40,
    text: "",
  }) as TextElement;
}

export function createNote(x: number, y: number): TextElement {
  return createElement("text", {
    x,
    y,
    width: 240,
    height: 128,
    text: "",
    style: styleWith({
      fill: "#fff3a3",
      stroke: "#5f4b00",
      fontSize: 18,
      roundness: 8,
    }),
    customData: { variant: "note" },
  }) as TextElement;
}
