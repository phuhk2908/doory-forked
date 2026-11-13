import {
  blankDrawing,
  applyDrawingDelta,
  computeDrawingDelta,
  createElement,
  mergeDrawingDocuments,
  rebaseDrawingHistory,
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

  it("restores locked elements without locking legacy data", () => {
    const locked = createElement("rectangle", { locked: true });
    const restored = restoreDrawing({
      schemaVersion: 1,
      elements: [locked, { ...locked, id: "legacy", locked: false }],
    });

    expect(restored.elements[0]).toMatchObject({ locked: true });
    expect(restored.elements[1]?.locked).toBeUndefined();
  });

  it("restores image references without embedding binary data", () => {
    const restored = restoreDrawing({
      schemaVersion: 1,
      background: "#fff",
      files: {
        image: {
          id: "image",
          mime: "image/png",
          name: "diagram.png",
          url: "idb://image",
          width: 640,
          height: 480,
          data: "should-not-survive",
        },
        embedded: {
          id: "embedded",
          mime: "image/png",
          name: "embedded.png",
          url: "data:image/png;base64,AAAA",
        },
      },
      elements: [
        {
          ...createElement("image"),
          id: "image-element",
          fileId: "image",
          width: 320,
          height: 240,
        },
        { ...createElement("image"), id: "missing-file-id", fileId: "missing" },
        { ...createElement("image"), id: "invalid-file-id", fileId: "" },
      ],
    });

    expect(restored.elements).toHaveLength(2);
    expect(restored.elements[0]).toMatchObject({
      type: "image",
      fileId: "image",
    });
    expect(restored.files).toEqual({
      image: {
        id: "image",
        mime: "image/png",
        name: "diagram.png",
        url: "idb://image",
        width: 640,
        height: 480,
      },
    });
  });

  it("keeps default text metrics when restoring older style data", () => {
    const restored = restoreDrawing({
      schemaVersion: 1,
      elements: [
        {
          ...createElement("text"),
          text: "hello",
          style: { fontSize: 24 },
        },
      ],
    });

    expect(restored.elements[0]).toMatchObject({
      style: { textAlign: "left", lineHeight: 1.25 },
    });
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

  it("rebases history restores as newer mutations with deletion tombstones", () => {
    const shape = {
      ...createElement("rectangle"),
      id: "history-shape",
      x: 0,
      version: 1,
      versionNonce: 1,
    };
    const moved = {
      ...shape,
      x: 100,
      version: 2,
      versionNonce: 2,
    };
    const undoMove = rebaseDrawingHistory(
      { ...blankDrawing(), elements: [moved] },
      { ...blankDrawing(), elements: [shape] },
    );
    expect(undoMove.elements[0]).toMatchObject({
      id: shape.id,
      x: 0,
      version: 3,
    });
    expect(
      mergeDrawingDocuments({ ...blankDrawing(), elements: [moved] }, undoMove)
        .elements[0],
    ).toMatchObject({ x: 0, version: 3 });

    const added = {
      ...createElement("ellipse"),
      id: "history-added",
      version: 1,
      versionNonce: 3,
    };
    const afterAdd = { ...blankDrawing(), elements: [shape, added] };
    const undoAdd = rebaseDrawingHistory(afterAdd, {
      ...blankDrawing(),
      elements: [shape],
    });
    expect(undoAdd.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: added.id,
          isDeleted: true,
          version: 2,
        }),
      ]),
    );
    const mergedUndoAdd = mergeDrawingDocuments(afterAdd, undoAdd);
    expect(
      mergedUndoAdd.elements.find((element) => element.id === added.id),
    ).toMatchObject({ isDeleted: true, version: 2 });

    const redoAdd = rebaseDrawingHistory(undoAdd, afterAdd);
    expect(redoAdd.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: added.id,
          isDeleted: false,
          version: 3,
        }),
      ]),
    );
    expect(
      mergeDrawingDocuments(undoAdd, redoAdd).elements.find(
        (element) => element.id === added.id,
      ),
    ).toMatchObject({ isDeleted: false, version: 3 });
  });

  it("rebases an undo of a deletion above the deleted version", () => {
    const shape = {
      ...createElement("rectangle"),
      id: "history-deleted",
      version: 1,
      versionNonce: 4,
    };
    const deleted = { ...shape, isDeleted: true, version: 2, versionNonce: 5 };
    const restored = rebaseDrawingHistory(
      { ...blankDrawing(), elements: [deleted] },
      { ...blankDrawing(), elements: [shape] },
    );

    expect(restored.elements[0]).toMatchObject({
      id: shape.id,
      isDeleted: false,
      version: 3,
    });
    expect(
      mergeDrawingDocuments(
        { ...blankDrawing(), elements: [deleted] },
        restored,
      ).elements[0],
    ).toMatchObject({ isDeleted: false, version: 3 });
  });

  it("remaps conflicting remote image file ids during snapshot merge", () => {
    const localFile = {
      id: "shared-file",
      mime: "image/png",
      name: "local.png",
      url: "https://cdn.test/local.png",
    };
    const remoteFile = {
      id: "shared-file",
      mime: "image/jpeg",
      name: "remote.jpg",
      url: "https://cdn.test/remote.jpg",
    };
    const localImage = createElement("image", {
      id: "local-image",
      fileId: localFile.id,
      version: 1,
    });
    const remoteImage = createElement("image", {
      id: "remote-image",
      fileId: remoteFile.id,
      version: 1,
    });

    const merged = mergeDrawingDocuments(
      {
        ...blankDrawing(),
        elements: [localImage],
        files: { [localFile.id]: localFile },
      },
      {
        ...blankDrawing(),
        elements: [remoteImage],
        files: { [remoteFile.id]: remoteFile },
      },
    );

    expect(merged.files?.[localFile.id]).toEqual(localFile);
    const mergedRemote = merged.elements.find(
      (element) => element.id === remoteImage.id,
    );
    expect(mergedRemote).toMatchObject({ type: "image" });
    if (mergedRemote?.type !== "image") return;
    expect(mergedRemote.fileId).not.toBe(localFile.id);
    expect(merged.files?.[mergedRemote.fileId]).toMatchObject({
      ...remoteFile,
      id: mergedRemote.fileId,
    });
  });

  it("computes and applies only changed elements", () => {
    const one = { ...createElement("rectangle"), id: "one" };
    const two = { ...createElement("ellipse"), id: "two" };
    const current = { ...blankDrawing(), elements: [one] };
    const incoming = {
      ...current,
      elements: [{ ...one, x: 40, version: 2 }, two],
      background: "#f8fafc",
    };

    const delta = computeDrawingDelta(current, incoming);
    expect(delta.elements.map((element) => element.id)).toEqual(["one", "two"]);
    expect(delta.background).toBe("#f8fafc");
    expect(applyDrawingDelta(current, delta)).toMatchObject({
      background: incoming.background,
      elements: expect.arrayContaining([
        expect.objectContaining({ id: "one", x: 40, version: 2 }),
        expect.objectContaining({ id: "two" }),
      ]),
    });
  });

  it("keeps delta image references aligned with an authoritative file map", () => {
    const currentFile = {
      id: "shared-file",
      mime: "image/png",
      name: "local.png",
      url: "https://cdn.test/local.png",
    };
    const incomingFile = {
      id: "shared-file",
      mime: "image/jpeg",
      name: "remote.jpg",
      url: "https://cdn.test/remote.jpg",
    };
    const currentImage = createElement("image", {
      id: "current-image",
      fileId: currentFile.id,
    });
    const incomingImage = createElement("image", {
      id: "incoming-image",
      fileId: incomingFile.id,
    });

    const merged = applyDrawingDelta(
      {
        ...blankDrawing(),
        elements: [currentImage],
        files: { [currentFile.id]: currentFile },
      },
      {
        schemaVersion: 1,
        elements: [incomingImage],
        files: { [incomingFile.id]: incomingFile },
      },
    );

    expect(merged.files).toEqual({ [incomingFile.id]: incomingFile });
    expect(merged.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: incomingImage.id,
          type: "image",
          fileId: incomingFile.id,
        }),
      ]),
    );
  });

  it("publishes and applies reorder-only deltas", () => {
    const one = { ...createElement("rectangle"), id: "one" };
    const two = { ...createElement("ellipse"), id: "two" };
    const current = {
      ...blankDrawing(),
      elements: [one, two],
      order: [one.id, two.id],
      orderVersion: 1,
      orderVersionNonce: 10,
    };
    const incoming = {
      ...current,
      elements: [two, one],
      order: [two.id, one.id],
      orderVersion: 2,
      orderVersionNonce: 20,
    };

    const delta = computeDrawingDelta(current, incoming);
    expect(delta.elements).toEqual([]);
    expect(delta.order).toEqual([two.id, one.id]);
    expect(
      applyDrawingDelta(current, delta).elements.map((element) => element.id),
    ).toEqual([two.id, one.id]);
  });

  it("keeps z-order deterministic when a legacy document adds an element", () => {
    const one = { ...createElement("rectangle"), id: "one" };
    const two = { ...createElement("ellipse"), id: "two" };
    const three = { ...createElement("diamond"), id: "three" };
    const current = { ...blankDrawing(), elements: [one, two] };
    const incoming = { ...blankDrawing(), elements: [two, one, three] };

    const delta = computeDrawingDelta(current, incoming);
    expect(delta.order).toEqual([two.id, one.id, three.id]);
    expect(
      applyDrawingDelta(current, delta).elements.map((element) => element.id),
    ).toEqual([two.id, one.id, three.id]);
  });

  it("does not let an older snapshot overwrite a newer layer order", () => {
    const one = { ...createElement("rectangle"), id: "one" };
    const two = { ...createElement("ellipse"), id: "two" };
    const current = {
      ...blankDrawing(),
      elements: [two, one],
      order: [two.id, one.id],
      orderVersion: 3,
      orderVersionNonce: 30,
    };
    const stale = {
      ...blankDrawing(),
      elements: [one, two],
      order: [one.id, two.id],
      orderVersion: 2,
      orderVersionNonce: 99,
    };

    expect(
      mergeDrawingDocuments(current, stale).elements.map(
        (element) => element.id,
      ),
    ).toEqual([two.id, one.id]);
  });

  it("rebases a history layer reorder as a newer document mutation", () => {
    const one = { ...createElement("rectangle"), id: "one" };
    const two = { ...createElement("ellipse"), id: "two" };
    const current = {
      ...blankDrawing(),
      elements: [two, one],
      order: [two.id, one.id],
      orderVersion: 4,
      orderVersionNonce: 40,
    };
    const target = {
      ...blankDrawing(),
      elements: [one, two],
      order: [one.id, two.id],
      orderVersion: 2,
      orderVersionNonce: 20,
    };

    const rebased = rebaseDrawingHistory(current, target);
    expect(rebased.elements.map((element) => element.id)).toEqual([
      one.id,
      two.id,
    ]);
    expect(rebased.order).toEqual([one.id, two.id]);
    expect(rebased.orderVersion).toBe(5);
  });
});
