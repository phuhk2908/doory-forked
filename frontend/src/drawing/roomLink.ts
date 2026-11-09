const ROOM_HASH =
  /^#room=([0-9a-fA-F-]{36}),([A-Za-z0-9_-]{32,128})(?:,(view))?$/;

const DEFAULT_ROOM_NAME = "Untitled whiteboard";

export interface DrawingRoomLink {
  id: string;
  key: string;
  mode: "edit" | "view";
}

export function parseDrawingRoomHash(hash: string): DrawingRoomLink | null {
  const match = ROOM_HASH.exec(hash);
  return match
    ? {
        id: match[1],
        key: match[2],
        mode: match[3] === "view" ? "view" : "edit",
      }
    : null;
}

export function drawingRoomHash(id: string, key: string): string {
  return "#room=" + id + "," + key;
}

/**
 * Room names are stable display labels, not identifiers. The UUID and capability in the canonical
 * link remain the collision-safe room identity and are never replaced with a guessable name.
 */
export function drawingRoomDisplayName(
  title: string | null | undefined,
): string {
  const name =
    typeof title === "string"
      ? title.trim().replace(/\s+/g, " ").slice(0, 200)
      : "";
  return name || DEFAULT_ROOM_NAME;
}

export const drawingRoomOwnerStorageKey = (id: string): string =>
  "doory:drawing-room-owner:" + id;
