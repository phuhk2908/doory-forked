import type {
  Drawing,
  DrawingCreateInput,
  DrawingPatchInput,
  DrawingQuery,
  DrawingRoom,
  DrawingRoomCollaborator,
  DrawingRoomCreateInput,
  DrawingSummary,
  Page,
} from "@/types/api";
import type { DrawingDocument } from "@/drawing/model";
import { http } from "./client";

export const drawingsApi = {
  list: (query: DrawingQuery = {}, signal?: AbortSignal) =>
    http.get<Page<DrawingSummary>>("/drawings/", { query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    http.get<Drawing>("/drawings/" + id + "/", { signal }),
  create: (input: DrawingCreateInput = {}) =>
    http.post<Drawing>("/drawings/", { json: input }),
  patch: (id: string, input: DrawingPatchInput) =>
    http.patch<Drawing>("/drawings/" + id + "/", { json: input }),
  trash: (id: string) => http.delete<void>("/drawings/" + id + "/"),
  uploadThumbnail: (id: string, image: Blob) => {
    const form = new FormData();
    form.append(
      "image",
      image,
      image.type === "image/png" ? "thumbnail.png" : "thumbnail.webp",
    );
    return http.put<{ thumbnail_url: string }>(
      "/drawings/" + id + "/thumbnail/",
      { form },
    );
  },
  saveDocument: (id: string, document: DrawingDocument, baseRevision: number) =>
    drawingsApi.patch(id, { document, base_revision: baseRevision }),
};

export const drawingRoomsApi = {
  create: (input: DrawingRoomCreateInput = {}) =>
    http.post<DrawingRoom>("/drawing-rooms/", { json: input }),
  get: (id: string, key: string, signal?: AbortSignal) =>
    http.get<DrawingRoom>("/drawing-rooms/" + id + "/", {
      headers: { "X-Drawing-Room-Key": key },
      signal,
    }),
  manage: (
    id: string,
    ownerKey: string,
    action: "close" | "rotate" | "rename",
    title?: string,
  ) =>
    http.post<DrawingRoom>("/drawing-rooms/" + id + "/manage/", {
      headers: { "X-Drawing-Room-Owner-Key": ownerKey },
      json: { action, ...(title ? { title } : {}) },
    }),
  listCollaborators: (id: string) =>
    http.get<DrawingRoomCollaborator[]>(
      "/drawing-rooms/" + id + "/collaborators/",
    ),
  addCollaborator: (id: string, email: string, role: "view" | "edit") =>
    http.post<DrawingRoomCollaborator>(
      "/drawing-rooms/" + id + "/collaborators/",
      {
        json: { email, role },
      },
    ),
  updateCollaborator: (id: string, userId: string, role: "view" | "edit") =>
    http.patch<DrawingRoomCollaborator>(
      "/drawing-rooms/" + id + "/collaborators/" + userId + "/",
      { json: { role } },
    ),
  removeCollaborator: (id: string, userId: string) =>
    http.delete<void>(
      "/drawing-rooms/" + id + "/collaborators/" + userId + "/",
    ),
  transferOwnership: (id: string, email: string) =>
    http.post<DrawingRoom>("/drawing-rooms/" + id + "/transfer-ownership/", {
      json: { email },
    }),
};
