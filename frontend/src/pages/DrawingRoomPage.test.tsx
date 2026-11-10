import { forwardRef } from "react";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankDrawing } from "@/drawing/model";
import {
  drawingRoomHash,
  drawingRoomOwnerStorageKey,
} from "@/drawing/roomLink";
import { renderApp } from "@/test/app";
import { server } from "@/test/msw";

vi.mock("@/drawing/DrawingEditor", () => ({
  DrawingEditor: forwardRef<
    HTMLDivElement,
    { title?: string; readOnly?: boolean }
  >(({ title, readOnly }, ref) => (
    <div
      ref={ref}
      data-testid="room-editor"
      data-read-only={readOnly ? "true" : "false"}
    >
      {title}
    </div>
  )),
}));

const ROOM_ID = "123e4567-e89b-12d3-a456-426614174000";
const OLD_KEY = "o".repeat(43);
const NEW_KEY = "n".repeat(43);
const OWNER_KEY = "w".repeat(43);

class TestSocket {
  static instances: TestSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor() {
    TestSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function room(key: string) {
  return {
    id: ROOM_ID,
    title: "Planning room",
    document: blankDrawing(),
    revision: 1,
    created_at: "2026-11-09T00:00:00Z",
    updated_at: "2026-11-09T00:00:00Z",
    closed_at: null,
    expires_at: "2026-12-09T00:00:00Z",
    mode: "edit",
    key,
  };
}

describe("DrawingRoomPage room lifecycle", () => {
  const requestedKeys: string[] = [];

  beforeEach(() => {
    requestedKeys.length = 0;
    sessionStorage.clear();
    TestSocket.instances = [];
    vi.stubGlobal("WebSocket", TestSocket);
    window.history.replaceState(
      null,
      "",
      "/drawings/room" + drawingRoomHash(ROOM_ID, OLD_KEY),
    );
    sessionStorage.setItem(drawingRoomOwnerStorageKey(ROOM_ID), OWNER_KEY);
    server.use(
      http.get(`*/api/v1/drawing-rooms/${ROOM_ID}/`, ({ request }) => {
        const key = request.headers.get("X-Drawing-Room-Key");
        if (key) requestedKeys.push(key);
        return HttpResponse.json(room(key === NEW_KEY ? NEW_KEY : OLD_KEY));
      }),
      http.post(
        `*/api/v1/drawing-rooms/${ROOM_ID}/manage/`,
        async ({ request }) => {
          const body = (await request.json()) as { action?: string };
          expect(request.headers.get("X-Drawing-Room-Owner-Key")).toBe(
            OWNER_KEY,
          );
          expect(body.action).toBe("rotate");
          return HttpResponse.json({ ...room(NEW_KEY), key: NEW_KEY });
        },
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("switches the canonical link and ignores the old socket close during rotation", async () => {
    const user = userEvent.setup();
    renderApp("/drawings/room");

    expect(await screen.findByTestId("room-editor")).toHaveTextContent(
      "Planning room",
    );
    await user.click(screen.getByRole("button", { name: "Share" }));
    await user.click(screen.getByRole("button", { name: "Rotate link" }));

    await waitFor(() => {
      expect(window.location.hash).toBe(drawingRoomHash(ROOM_ID, NEW_KEY));
      expect(screen.getByLabelText("Room link")).toHaveValue(
        window.location.origin +
          "/drawings/room" +
          drawingRoomHash(ROOM_ID, NEW_KEY),
      );
    });
    expect(requestedKeys).toContain(NEW_KEY);

    const oldSocket = TestSocket.instances[0];
    expect(oldSocket).toBeDefined();
    oldSocket.receive({ type: "closed", reason: "revoked" });
    expect(screen.queryByText("Room ended")).not.toBeInTheDocument();
  });

  it("applies an access change to the already-open room", async () => {
    renderApp("/drawings/room");

    expect(await screen.findByTestId("room-editor")).toHaveAttribute(
      "data-read-only",
      "false",
    );
    act(() => {
      TestSocket.instances[0].receive({
        type: "access",
        mode: "view",
        can_edit: false,
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText("View only")).not.toHaveLength(0);
      expect(screen.getByTestId("room-editor")).toHaveAttribute(
        "data-read-only",
        "true",
      );
    });
  });

  it("shows the number of deduplicated peers instead of a stale server count", async () => {
    renderApp("/drawings/room");

    expect(await screen.findByTestId("room-editor")).toBeInTheDocument();
    act(() => {
      TestSocket.instances[0].receive({
        type: "ready",
        document: blankDrawing(),
        revision: 1,
        peer_id: "self",
        peers: 5,
        presence: [
          {
            peer_id: "peer-1",
            mode: "edit",
            cursor: null,
            selection: [],
          },
        ],
      });
    });

    expect(await screen.findByText("Live · 1 other")).toBeInTheDocument();
    expect(screen.queryByText("Live · 4 others")).not.toBeInTheDocument();
  });
});
