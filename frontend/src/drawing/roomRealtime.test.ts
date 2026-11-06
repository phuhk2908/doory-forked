import { describe, expect, it } from "vitest";
import { blankDrawing, type DrawingDocument } from "./model";
import {
  DrawingRoomRealtime,
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
    const document = blankDrawing();
    realtime.publish(document);
    socket.receive({ type: "ready", document, revision: 1, peers: 1 });

    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "auth",
      key: "k".repeat(43),
    });
    expect(JSON.parse(socket.sent[1])).toMatchObject({
      type: "update",
      document,
      client_id: 1,
    });
    expect(documents).toEqual([{ document, revision: 1 }]);
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
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "auth",
      key: "k".repeat(43),
    });
    expect(socket.sent).toHaveLength(1);
  });
});
