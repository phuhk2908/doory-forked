import { useEffect, useRef, useState } from "react";
import { useLatest } from "../lib/useLatest";
import type { DrawingDocument } from "./model";

export type DrawingRealtimeStatus = "offline" | "connecting" | "live";

export interface DrawingRealtimeState {
  status: DrawingRealtimeStatus;
  peerCount: number;
}

export interface DrawingRealtimeCallbacks {
  onDocument(document: DrawingDocument, revision: number): void;
  onConflict(document: DrawingDocument | null, revision: number): void;
  onPresence(count: number): void;
  onStatus(status: DrawingRealtimeStatus): void;
}

export interface DrawingSocket {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

const OPEN = 1;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const PING_MS = 20_000;

export function drawingRealtimeAddress(
  drawingId: string,
  where: Pick<Location, "protocol" | "host"> = window.location,
): string {
  return (
    (where.protocol === "https:" ? "wss:" : "ws:") +
    "//" +
    where.host +
    "/ws/drawings/" +
    encodeURIComponent(drawingId) +
    "/"
  );
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validDocument(value: unknown): value is DrawingDocument {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export class DrawingRealtime {
  private socket: DrawingSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private stopped = true;
  constructor(
    private readonly url: string,
    private readonly callbacks: DrawingRealtimeCallbacks,
    private readonly createSocket: (url: string) => DrawingSocket = (address) =>
      new WebSocket(address) as unknown as DrawingSocket,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearRetry();
    this.clearPing();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus("offline");
  }

  private connect(): void {
    if (this.stopped || this.socket) return;
    this.setStatus("connecting");
    let socket: DrawingSocket;
    try {
      socket = this.createSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.setStatus("live");
      this.startPing();
      this.send({ type: "hello" });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.receive(event.data);
    };
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearPing();
      if (!this.stopped) {
        this.setStatus("offline");
        this.scheduleRetry();
      }
    };
  }

  private receive(data: unknown): void {
    if (typeof data !== "string") return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message))
      return;
    const value = message as Record<string, unknown>;
    if (value.type === "ready") {
      if (validRevision(value.revision) && validDocument(value.document)) {
        this.callbacks.onDocument(value.document, value.revision);
      }
      if (validRevision(value.peers)) this.callbacks.onPresence(value.peers);
      return;
    }
    if (value.type === "document") {
      if (validRevision(value.revision) && validDocument(value.document)) {
        this.callbacks.onDocument(value.document, value.revision);
      }
      return;
    }
    if (value.type === "conflict") {
      const document = validDocument(value.document) ? value.document : null;
      if (validRevision(value.revision))
        this.callbacks.onConflict(document, value.revision);
      return;
    }
    if (value.type === "presence") {
      const state = value.state;
      if (state && typeof state === "object" && !Array.isArray(state)) {
        const count = (state as Record<string, unknown>).count;
        if (validRevision(count)) this.callbacks.onPresence(count);
      }
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState !== OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.attempt);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private clearRetry(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => this.send({ type: "ping" }), PING_MS);
  }

  private clearPing(): void {
    if (!this.pingTimer) return;
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private setStatus(status: DrawingRealtimeStatus): void {
    this.callbacks.onStatus(status);
  }
}

export function useDrawingRealtime({
  drawingId,
  enabled,
  onDocument,
  onConflict,
  onPresence,
}: {
  drawingId: string;
  enabled: boolean;
  onDocument: (document: DrawingDocument, revision: number) => void;
  onConflict: (document: DrawingDocument | null, revision: number) => void;
  onPresence: (count: number) => void;
}): DrawingRealtimeState {
  const latestCallbacks = useLatest({ onDocument, onConflict, onPresence });
  const realtimeRef = useRef<DrawingRealtime | null>(null);
  const [state, setState] = useState<DrawingRealtimeState>({
    status: "offline",
    peerCount: 0,
  });

  useEffect(() => {
    if (
      !enabled ||
      !drawingId ||
      typeof window === "undefined" ||
      typeof WebSocket === "undefined"
    ) {
      realtimeRef.current?.stop();
      realtimeRef.current = null;
      return undefined;
    }
    const realtime = new DrawingRealtime(drawingRealtimeAddress(drawingId), {
      onDocument: (document, revision) =>
        latestCallbacks.get().onDocument(document, revision),
      onConflict: (document, revision) =>
        latestCallbacks.get().onConflict(document, revision),
      onPresence: (count) => {
        setState((value) => ({ ...value, peerCount: count }));
        latestCallbacks.get().onPresence(count);
      },
      onStatus: (status) =>
        setState((value) => ({
          status,
          peerCount: status === "offline" ? 0 : value.peerCount,
        })),
    });
    realtimeRef.current = realtime;
    realtime.start();
    return () => {
      realtime.stop();
      if (realtimeRef.current === realtime) realtimeRef.current = null;
    };
  }, [drawingId, enabled, latestCallbacks]);

  return {
    ...state,
  };
}
