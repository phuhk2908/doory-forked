import { describe, expect, it } from "vitest";
import { drawingRoomHash, parseDrawingRoomHash } from "./roomLink";

describe("drawing room links", () => {
  it("keeps the room key in the URL fragment", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const key = "k".repeat(43);
    expect(drawingRoomHash(id, key)).toBe("#room=" + id + "," + key);
    expect(parseDrawingRoomHash(drawingRoomHash(id, key))).toEqual({
      id,
      key,
      mode: "edit",
    });
    expect(parseDrawingRoomHash(drawingRoomHash(id, key, "view"))).toEqual({
      id,
      key,
      mode: "view",
    });
  });

  it("rejects room links that do not have a strong-looking key", () => {
    expect(
      parseDrawingRoomHash("#room=123e4567-e89b-12d3-a456-426614174000,short"),
    ).toBeNull();
    expect(
      parseDrawingRoomHash(
        "?room=123e4567-e89b-12d3-a456-426614174000," + "k".repeat(43),
      ),
    ).toBeNull();
  });
});
