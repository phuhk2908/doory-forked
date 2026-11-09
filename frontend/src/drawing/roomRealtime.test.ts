import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blankDrawing, createElement, type DrawingDocument } from "./model";
import {
  DrawingRoomRealtime,
  drawingRoomRecoveryStorageKey,
  drawingRoomRealtimeAddress,
  type DrawingRoomSocket,
} from "./roomRealtime";

class FakeSocket implements DrawingRoomSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  send(data: string): void {
    this.sent.push(data);
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe("drawing room realtime", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it("builds a same-origin address and authenticates with the key in a frame", () => {
    expect(
      drawingRoomRealtimeAddress("a/../b?x=1", {
        protocol: "https:",
        host: "boards.example",
      }),
    ).toBe("wss://boards.example/ws/drawing-rooms/a%2F..%2Fb%3Fx%3D1/");
    const socket = new FakeSocket();
    const documents: Array<{ document: DrawingDocument; revision: number }> =
      [];
    const realtime = new DrawingRoomRealtime(
      "ws://test/ws/drawing-rooms/1/",
      "k".repeat(43),
      {
        onDocument: (document, revision) =>
          documents.push({ document, revision }),
        onSaved: () => undefined,
        onPresence: () => undefined,
        onStatus: () => undefined,
        onError: () => undefined,
      },
      () => socket,
    );
    realtime.start();
    socket.open();
    const first = { ...createElement("rectangle"), id: "shape-1" };
    const document = {
      ...blankDrawing(),
      elements: [first, { ...createElement("ellipse"), id: "shape-2" }],
    };
    const base = { ...blankDrawing(), elements: [first] };
    realtime.publish(document);
    socket.receive({ type: "ready", document: base, revision: 1, peers: 1 });

    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: "auth",
      key: "k".repeat(43),
      protocol: 2,
    });
    expect(JSON.parse(socket.sent[0]).client_id).toEqual(expect.any(String));
    expect(JSON.parse(socket.sent[1])).toMatchObject({
      type: "update",
      delta: { schemaVersion: 1, elements: [document.elements[1]] },
      base_revision: 1,
      client_id: 1,
    });
    expect(documents).toEqual([{ document: base, revision: 1 }]);
    realtime.stop();
  });

  it("keeps view access read-only and tracks volatile peer state", () => {
    const socket = new FakeSocket();
    const access: Array<{ mode: string; canEdit: boolean }> = [];
    const peers: unknown[] = [];
    const closed: string[] = [];
    const titles: string[] = [];
    const realtime = new DrawingRoomRealtime(
      "ws://test/ws/drawing-rooms/1/",
      "k".repeat(43),
      {
        onDocument: () => undefined,
        onSaved: () => undefined,
        onPresence: () => undefined,
        onStatus: () => undefined,
        onError: () => undefined,
        onAccess: (mode, canEdit) => access.push({ mode, canEdit }),
        onPeers: (value) => peers.push(value),
        onClosed: (reason) => closed.push(reason),
        onTitle: (title) => titles.push(title),
      },
      () => socket,
    );
    realtime.start();
    socket.open();
    socket.receive({
      type: "ready",
      document: blankDrawing(),
      revision: 1,
      peers: 2,
      mode: "view",
      can_edit: false,
      presence: [
        {
          peer_id: "peer-1",
          mode: "edit",
          cursor: { x: 12, y: 18 },
          selection: ["one"],
        },
      ],
    });
    realtime.publish(blankDrawing());
    socket.receive({
      type: "presence",
      state: {
        kind: "update",
        peer_id: "peer-1",
        mode: "edit",
        cursor: null,
        selection: [],
        count: 2,
      },
    });
    socket.receive({ type: "room_title", title: "Renamed board" });
    socket.receive({ type: "closed", reason: "revoked" });

    expect(access).toEqual([{ mode: "view", canEdit: false }]);
    expect(peers.at(-1)).toEqual([
      { id: "peer-1", mode: "edit", cursor: null, selection: [] },
    ]);
    expect(closed).toEqual(["revoked"]);
    expect(titles).toEqual(["Renamed board"]);
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: "auth",
      key: "k".repeat(43),
    });
    expect(JSON.parse(socket.sent[0]).client_id).toEqual(expect.any(String));
    expect(socket.sent).toHaveLength(1);
  });

  it("applies a remote delta against the last room snapshot", () => {
    const socket = new FakeSocket();
    const documents: DrawingDocument[] = [];
    const realtime = new DrawingRoomRealtime(
      "ws://test/ws/drawing-rooms/1/",
      "k".repeat(43),
      {
        onDocument: (document) => documents.push(document),
        onSaved: () => undefined,
        onPresence: () => undefined,
        onStatus: () => undefined,
        onError: () => undefined,
      },
      () => socket,
    );
    realtime.start();
    socket.open();
    socket.receive({ type: "ready", document: blankDrawing(), revision: 4 });
    const element = { ...createElement("rectangle"), id: "remote" };
    socket.receive({
      type: "document",
      revision: 5,
      delta: { schemaVersion: 1, elements: [element] },
    });

    expect(documents.at(-1)).toMatchObject({
      background: "#ffffff",
      elements: [expect.objectContaining({ id: "remote" })],
    });
    realtime.stop();
  });

  it("preserves named collaborator profiles in presence", () => {
    const socket = new FakeSocket();
    const peers: unknown[] = [];
    const realtime = new DrawingRoomRealtime(
      "ws://test/ws/drawing-rooms/1/",
      "k".repeat(43),
      {
        onDocument: () => undefined,
        onSaved: () => undefined,
        onPresence: () => undefined,
        onStatus: () => undefined,
        onError: () => undefined,
        onPeers: (value) => peers.push(value),
      },
      () => socket,
    );
    realtime.start();
    socket.open();
    socket.receive({
      type: "ready",
      document: blankDrawing(),
      revision: 1,
      presence: [
        {
          peer_id: "peer-1",
          mode: "edit",
          cursor: null,
          selection: [],
          user_id: "user-1",
          name: "Teammate",
          avatar_url: "/media/avatar.webp",
          role: "edit",
        },
      ],
    });

    expect(peers.at(-1)).toEqual([
      {
        id: "peer-1",
        mode: "edit",
        cursor: null,
        selection: [],
        userId: "user-1",
        name: "Teammate",
        avatarUrl: "/media/avatar.webp",
      },
    ]);
    realtime.stop();
  });

  it("recovers an unsaved snapshot after reconnect and clears it after acknowledgement", () => {
    const firstSocket = new FakeSocket();
    const first = new DrawingRoomRealtime(
      "ws://test/ws/drawing-rooms/1/",
      "k".repeat(43),
      {
        onDocument: () => undefined,
        onSaved: () => undefined,
        onPresence: () => undefined,
        onStatus: () => undefined,
        onError: () => undefined,
      },
      () => firstSocket,
      "room-1",
    );
    const recovered = {
      ...blankDrawing(),
      elements: [{ ...createElement("rectangle"), id: "recovered" }],
    };

    first.start();
    firstSocket.open();
    first.publish(recovered);
    firstSocket.receive({
      type: "ready",
      document: blankDrawing(),
      revision: 1,
      peers: 1,
    });
    expect(
      sessionStorage.getItem(drawingRoomRecoveryStorageKey("room-1")),
    ).toBeTruthy();
    first.stop();

    const secondSocket = new FakeSocket();
    const second = new DrawingRoomRealtime(
      "ws://test/ws/drawing-rooms/1/",
      "k".repeat(43),
      {
        onDocument: () => undefined,
        onSaved: () => undefined,
        onPresence: () => undefined,
        onStatus: () => undefined,
        onError: () => undefined,
      },
      () => secondSocket,
      "room-1",
    );
    second.start();
    secondSocket.open();
    secondSocket.receive({
      type: "ready",
      document: blankDrawing(),
      revision: 1,
      peers: 1,
    });

    const update = JSON.parse(secondSocket.sent[1]) as {
      type: string;
      delta?: { elements: Array<{ id: string }> };
      document?: { elements: Array<{ id: string }> };
      client_id?: number;
    };
    expect(update.type).toBe("update");
    expect(update.delta?.elements ?? update.document?.elements).toEqual([
      expect.objectContaining({ id: "recovered" }),
    ]);
    secondSocket.receive({
      type: "saved",
      document: recovered,
      revision: 2,
      client_id: update.client_id,
    });
    expect(
      sessionStorage.getItem(drawingRoomRecoveryStorageKey("room-1")),
    ).toBeNull();
    second.stop();
  });
});
