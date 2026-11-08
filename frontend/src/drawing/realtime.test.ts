import { describe, expect, it } from "vitest";
import { blankDrawing, type DrawingDocument } from "./model";
import {
  DrawingRealtime,
  drawingRealtimeAddress,
  type DrawingSocket,
} from "./realtime";

class FakeSocket implements DrawingSocket {
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

describe("drawing realtime", () => {
  it("builds a same-origin websocket address", () => {
    expect(
      drawingRealtimeAddress("a/../b?x=1", {
        protocol: "https:",
        host: "boards.example",
      }),
    ).toBe("wss://boards.example/ws/drawings/a%2F..%2Fb%3Fx%3D1/");
  });

  it("connects and accepts committed remote snapshots", () => {
    const socket = new FakeSocket();
    const documents: Array<{ document: DrawingDocument; revision: number }> =
      [];
    const statuses: string[] = [];
    const realtime = new DrawingRealtime(
      "ws://test/ws/drawings/1/",
      {
        onDocument: (document, revision) =>
          documents.push({ document, revision }),
        onConflict: () => undefined,
        onPresence: () => undefined,
        onStatus: (status) => statuses.push(status),
      },
      () => socket,
    );
    realtime.start();
    socket.open();
    const document = blankDrawing();
    socket.receive({ type: "ready", document, revision: 2, peers: 1 });

    expect(JSON.parse(socket.sent[0])).toEqual({ type: "hello" });
    expect(documents).toEqual([{ document, revision: 2 }]);
    expect(statuses).toEqual(["connecting", "live"]);

    realtime.stop();
  });
});
