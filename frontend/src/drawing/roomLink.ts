const ROOM_HASH =
  /^#room=([0-9a-fA-F-]{36}),([A-Za-z0-9_-]{32,128})(?:,(view))?$/;

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

export function drawingRoomHash(
  id: string,
  key: string,
  mode: "edit" | "view" = "edit",
): string {
  return "#room=" + id + "," + key + (mode === "view" ? ",view" : "");
}

export const drawingRoomOwnerStorageKey = (id: string): string =>
  "doory:drawing-room-owner:" + id;
export const drawingRoomEditStorageKey = (id: string): string =>
  "doory:drawing-room-edit:" + id;
export const drawingRoomViewStorageKey = (id: string): string =>
  "doory:drawing-room-view:" + id;
