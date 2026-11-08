import { useEffect, useRef, useState } from "react";
import { useLatest } from "../lib/useLatest";
import { uuid } from "../lib/uuid";
import type { DrawingDocument } from "./model";

export type DrawingRoomRealtimeStatus =
  | "offline"
  | "connecting"
  | "live"
  | "closed";

export interface DrawingRoomPeer {
  id: string;
  mode: "edit" | "view";
  cursor: { x: number; y: number } | null;
  selection: string[];
}

export interface DrawingRoomRealtimeState {
  status: DrawingRoomRealtimeStatus;
  peerCount: number;
  mode: "edit" | "view" | null;
  canEdit: boolean;
  peers: DrawingRoomPeer[];
}

export interface DrawingRoomSocket {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface DrawingRoomRealtimeCallbacks {
  onDocument(document: DrawingDocument, revision: number): void;
  onSaved(document: DrawingDocument, revision: number, clientId: number): void;
  onPresence(count: number): void;
  onStatus(status: DrawingRoomRealtimeStatus): void;
  onError(message: string): void;
  onTitle?(title: string): void;
  onAccess?(mode: "edit" | "view", canEdit: boolean): void;
  onPeers?(peers: DrawingRoomPeer[]): void;
  onClosed?(reason: string): void;
}

const OPEN = 1;
const UPDATE_INTERVAL_MS = 120;
const PRESENCE_INTERVAL_MS = 33;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const PING_MS = 5_000;

export function drawingRoomRealtimeAddress(
  roomId: string,
  where: Pick<Location, "protocol" | "host"> = window.location,
): string {
  return (
    (where.protocol === "https:" ? "wss:" : "ws:") +
    "//" +
    where.host +
    "/ws/drawing-rooms/" +
    encodeURIComponent(roomId) +
    "/"
  );
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validDocument(value: unknown): value is DrawingDocument {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export class DrawingRoomRealtime {
  private socket: DrawingRoomSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private nextClientId = 0;
  private stopped = true;
  private authenticated = false;
  private pending: { document: DrawingDocument; clientId: number } | null =
    null;
  private inFlight: { document: DrawingDocument; clientId: number } | null =
    null;
  private pendingPresence: {
    cursor: { x: number; y: number } | null;
    selection: string[];
  } | null = null;
  private canEdit = true;
  private peerId: string | null = null;
  private peers = new Map<string, DrawingRoomPeer>();

  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly callbacks: DrawingRoomRealtimeCallbacks,
    private readonly createSocket: (url: string) => DrawingRoomSocket = (
      address,
    ) => new WebSocket(address) as unknown as DrawingRoomSocket,
  ) {}

  private readonly clientId = uuid();

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.authenticated = false;
    this.clearRetry();
    this.clearFlush();
    this.clearPing();
    this.clearPresence();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.callbacks.onStatus("offline");
  }

  publish(document: DrawingDocument): void {
    if (!this.canEdit) return;
    this.pending = { document, clientId: ++this.nextClientId };
    this.scheduleFlush();
  }

  publishPresence(presence: {
    cursor: { x: number; y: number } | null;
    selection: string[];
  }): void {
    this.pendingPresence = presence;
    if (this.presenceTimer !== null) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      const next = this.pendingPresence;
      this.pendingPresence = null;
      if (next) this.send({ type: "presence", state: next });
    }, PRESENCE_INTERVAL_MS);
  }

  private connect(): void {
    if (this.stopped || this.socket) return;
    this.callbacks.onStatus("connecting");
    let socket: DrawingRoomSocket;
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
      this.authenticated = false;
      this.canEdit = true;
      this.send({ type: "auth", key: this.key, client_id: this.clientId });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.receive(event.data);
    };
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.authenticated = false;
      if (!this.pending && this.inFlight) this.pending = this.inFlight;
      this.inFlight = null;
      this.clearPing();
      if (!this.stopped) {
        this.callbacks.onStatus("offline");
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
      this.authenticated = true;
      const mode = value.mode === "view" ? "view" : "edit";
      this.canEdit = value.can_edit !== false && mode === "edit";
      this.peerId = typeof value.peer_id === "string" ? value.peer_id : null;
      this.callbacks.onAccess?.(mode, this.canEdit);
      this.callbacks.onStatus("live");
      this.startPing();
      if (validDocument(value.document) && validRevision(value.revision))
        this.callbacks.onDocument(value.document, value.revision);
      if (validRevision(value.peers)) this.callbacks.onPresence(value.peers);
      this.replacePeers(value.presence);
      this.flushPending();
      return;
    }
    if (value.type === "document") {
      if (validDocument(value.document) && validRevision(value.revision))
        this.callbacks.onDocument(value.document, value.revision);
      return;
    }
    if (value.type === "room_title") {
      if (typeof value.title === "string" && value.title.trim())
        this.callbacks.onTitle?.(value.title);
      return;
    }
    if (value.type === "saved") {
      const clientId = value.client_id;
      if (
        validDocument(value.document) &&
        validRevision(value.revision) &&
        typeof clientId === "number" &&
        Number.isInteger(clientId)
      ) {
        if (this.inFlight?.clientId === clientId) this.inFlight = null;
        this.callbacks.onSaved(value.document, value.revision, clientId);
      }
      return;
    }
    if (value.type === "presence") {
      const state = value.state;
      if (state && typeof state === "object" && !Array.isArray(state)) {
        const presence = state as Record<string, unknown>;
        this.applyPeer(presence);
        const count = presence.count;
        if (validRevision(count)) this.callbacks.onPresence(count);
      }
      return;
    }
    if (value.type === "closed") {
      this.stopped = true;
      this.authenticated = false;
      this.clearRetry();
      this.clearFlush();
      this.clearPing();
      this.clearPresence();
      const socket = this.socket;
      this.socket = null;
      socket?.close();
      this.callbacks.onStatus("closed");
      this.callbacks.onClosed?.(
        typeof value.reason === "string" ? value.reason : "closed",
      );
      return;
    }
    if (value.type === "error") {
      this.callbacks.onError(
        typeof value.message === "string"
          ? value.message
          : String(value.code ?? "Room error"),
      );
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState !== OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPending();
    }, UPDATE_INTERVAL_MS);
  }

  private flushPending(): void {
    if (
      !this.pending ||
      !this.authenticated ||
      !this.canEdit ||
      this.socket?.readyState !== OPEN
    )
      return;
    const pending = this.pending;
    this.pending = null;
    this.inFlight = pending;
    this.send({
      type: "update",
      document: pending.document,
      client_id: pending.clientId,
    });
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

  private clearFlush(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
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

  private clearPresence(): void {
    if (this.presenceTimer === null) return;
    clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
  }

  private replacePeers(value: unknown): void {
    this.peers.clear();
    if (Array.isArray(value)) {
      for (const item of value) this.applyPeer(item);
    }
    this.callbacks.onPeers?.([...this.peers.values()]);
  }

  private applyPeer(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const item = value as Record<string, unknown>;
    if (typeof item.peer_id !== "string") return;
    if (item.peer_id === this.peerId) return;
    if (item.kind === "leave") {
      this.peers.delete(item.peer_id);
      this.callbacks.onPeers?.([...this.peers.values()]);
      return;
    }
    const point =
      item.cursor &&
      typeof item.cursor === "object" &&
      !Array.isArray(item.cursor)
        ? (item.cursor as Record<string, unknown>)
        : null;
    const x = point?.x;
    const y = point?.y;
    const selection = Array.isArray(item.selection)
      ? item.selection
          .filter((id): id is string => typeof id === "string")
          .slice(0, 100)
      : [];
    this.peers.set(item.peer_id, {
      id: item.peer_id,
      mode: item.mode === "view" ? "view" : "edit",
      cursor:
        typeof x === "number" &&
        Number.isFinite(x) &&
        typeof y === "number" &&
        Number.isFinite(y)
          ? { x, y }
          : null,
      selection,
    });
    this.callbacks.onPeers?.([...this.peers.values()]);
  }
}

export function useDrawingRoomRealtime({
  roomId,
  key,
  enabled,
  onDocument,
  onSaved,
  onPresence,
  onError,
  onTitle,
  onAccess,
  onPeers,
  onClosed,
}: {
  roomId: string;
  key: string;
  enabled: boolean;
  onDocument: (document: DrawingDocument, revision: number) => void;
  onSaved: (
    document: DrawingDocument,
    revision: number,
    clientId: number,
  ) => void;
  onPresence: (count: number) => void;
  onError: (message: string) => void;
  onTitle?: (title: string) => void;
  onAccess?: (mode: "edit" | "view", canEdit: boolean) => void;
  onPeers?: (peers: DrawingRoomPeer[]) => void;
  onClosed?: (reason: string) => void;
}): DrawingRoomRealtimeState & {
  publish(document: DrawingDocument): void;
  publishPresence(presence: {
    cursor: { x: number; y: number } | null;
    selection: string[];
  }): void;
} {
  const latestCallbacks = useLatest({
    onDocument,
    onSaved,
    onPresence,
    onError,
    onTitle,
    onAccess,
    onPeers,
    onClosed,
  });
  const realtimeRef = useRef<DrawingRoomRealtime | null>(null);
  const [state, setState] = useState<DrawingRoomRealtimeState>({
    status: "offline",
    peerCount: 0,
    mode: null,
    canEdit: false,
    peers: [],
  });

  useEffect(() => {
    if (
      !enabled ||
      !roomId ||
      !key ||
      typeof window === "undefined" ||
      typeof WebSocket === "undefined"
    ) {
      realtimeRef.current?.stop();
      realtimeRef.current = null;
      return undefined;
    }
    const realtime = new DrawingRoomRealtime(
      drawingRoomRealtimeAddress(roomId),
      key,
      {
        onDocument: (document, revision) =>
          latestCallbacks.get().onDocument(document, revision),
        onSaved: (document, revision, clientId) =>
          latestCallbacks.get().onSaved(document, revision, clientId),
        onPresence: (count) => {
          setState((value) => ({ ...value, peerCount: count }));
          latestCallbacks.get().onPresence(count);
        },
        onStatus: (status) =>
          setState((value) => ({
            ...value,
            status,
            peerCount: status === "offline" ? 0 : value.peerCount,
            peers: status === "offline" ? [] : value.peers,
          })),
        onError: (message) => latestCallbacks.get().onError(message),
        onTitle: (title) => latestCallbacks.get().onTitle?.(title),
        onAccess: (mode, canEdit) => {
          setState((value) => ({ ...value, mode, canEdit }));
          latestCallbacks.get().onAccess?.(mode, canEdit);
        },
        onPeers: (peers) => {
          setState((value) => ({ ...value, peers }));
          latestCallbacks.get().onPeers?.(peers);
        },
        onClosed: (reason) => latestCallbacks.get().onClosed?.(reason),
      },
    );
    realtimeRef.current = realtime;
    realtime.start();
    return () => {
      realtime.stop();
      if (realtimeRef.current === realtime) realtimeRef.current = null;
    };
  }, [enabled, key, latestCallbacks, roomId]);

  return {
    ...state,
    publish: (document) => realtimeRef.current?.publish(document),
    publishPresence: (presence) =>
      realtimeRef.current?.publishPresence(presence),
  };
}
