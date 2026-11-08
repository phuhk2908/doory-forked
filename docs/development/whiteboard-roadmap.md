# Whiteboard post-MVP roadmap

The guest room MVP is live. The next work is split by room safety first, then editor and collaboration quality.

## Current P0/P1 reliability pass

1. [x] Align backend validation with the frontend drawing contract while keeping unknown top-level metadata
   forward-compatible.
2. [x] Keep room and account mutations behind revisioned service seams, with committed realtime events.
3. [x] Add protocol negotiation with full-snapshot fallback for rolling frontend/backend deploys.
4. [x] Send version-aware element deltas, periodic repair snapshots and full merged acknowledgements.
5. [x] Record delta/snapshot payload counters alongside existing latency, bytes, reconnect and fan-out metrics.
6. [x] Add a repeatable transport benchmark for 2/5/20/maximum collaborators. Browser render/reconnect and multi-worker
   verification remain environment-dependent.

## P0: room controls

1. [x] End a live room. The owner can close it; existing sockets receive a close event and new API/WebSocket access is rejected.
2. [x] Revoke and rotate links. Rotation invalidates the previous edit and view capabilities while leaving the owner capability intact.
3. [x] Create a view-only link. The view capability can load the board and receive updates, but the server rejects document writes and the editor disables editing.
4. [x] Keep room ownership separate from share links. The owner capability is returned once at creation and stored in the browser session; it is never placed in a share URL.
5. [x] Expire and clean up rooms. New rooms expire after `DRAWING_ROOM_TTL_DAYS` (30 days by default). `collab_maintenance` deletes expired rows.

## P1: editor and collaboration quality

1. [x] Add fast keyboard actions: tool keys (`V`, `H`, `R`, `O`, `D`, `L`, `A`, `P`, `T`, `N`, `E`), undo/redo, save, delete, nudge, duplicate, grouping, zoom, and fit-to-content.
2. [x] Hold `Space` to pan. The canvas shows a grab cursor, temporarily pans with the pointer, and restores the selected tool after release.
3. [x] Use a non-passive native wheel listener. `Ctrl`/`Command` + wheel zooms the board without browser zoom; plain wheel pans the board.
4. [x] Relay volatile cursor and selection presence separately from the document. Presence is throttled at 33ms, bounded, and never persisted.
5. [x] Show collaborator presence in the room: peer count, remote cursors, and selection outlines with reconnect-safe cleanup.
6. [x] Add a share dialog with edit and view-only links, copy actions, link rotation, and end-room control for the owner.
7. [x] Let a guest save the current room snapshot to an account after signing in. This creates an owned drawing and keeps the room alive until the owner closes or it expires.
8. [x] Explain the edit/view access model before a guest starts a room, show progress while the local snapshot is saved, and land them in the live room with its controls ready.
9. [x] Move the tool palette into a centered floating toolbar. Keep the rectangle tool as the default shape action, group ellipse and diamond behind a shape dropdown, and add Eraser plus Note tools to the palette.
10. [x] Move zoom controls into a bottom-right floating pill. Keep zoom in, zoom out, and the current percentage together, and remove the duplicate zoom actions from the header.
11. [x] Allow the whiteboard title to be edited and persisted for local boards, signed-in drawings, and live rooms.
12. [x] Give the canvas a subtle dotted background by default, keep the grid disabled by default, and preserve the grid toggle as an optional aid. When enabled, render 5×5 minor square cells inside each major grid block, with the major boundaries using a dashed line like Excalidraw.
13. [x] Add a `More` icon beside the whiteboard title with a focused overflow menu:
    - Rename whiteboard (uses the title editor from item 11).
    - Toggle grid (uses the grid setting from item 12).
    - Fit to content.
    - Download PNG.
    - Export SVG.
    - Export JSON/source file.
    - Save to account when the board is still local and the visitor is a guest.
    - Keep Share, Rotate links, and End room in the collaboration controls because they change access for other people.
14. [x] Add consistent tooltips for every tool and action on hover and keyboard focus, including the action name and its shortcut when one exists. Cover the shape dropdown, More menu, zoom pill, Eraser, and Note.

## P1: creation entry UX

15. [x] Make the `Start designing` chooser horizontal on desktop, with `Start a design` and `Start a whiteboard` as two equal entry cards. Stack the cards on small screens without changing the direct whiteboard route.
16. [x] Add a quick-start step before the full `Create a design` dialog. After choosing `Start a design`, show popular preset sizes, `Custom size`, `Start from a template`, and `All sizes`; quick choices should open the editor directly, while `All sizes` opens the existing full size picker.

## P2: performance and scale

- [ ] **P2.13** Complete the browser and multi-worker half of the collaboration benchmark. The single-process transport
    matrix is available through `benchmark_drawing_room`; it reports latency, bytes, delta/snapshot counts and fan-out.
- [x] **P2.14** Reduce realtime payload size by moving from full snapshots to element-level deltas. Send only new or version-changed elements and use periodic full snapshots for resync. See [whiteboard-realtime.md](whiteboard-realtime.md).
- [ ] **P2.15** Evaluate Yjs/CRDT only if version-based merging is not sufficient, with special attention to text editing and concurrent changes. Record the decision and the measurements behind it.
- [ ] **P2.16** Optimize persistence: debounce durable saves instead of writing every snapshot, and keep a recovery snapshot that can be applied after reconnect.

## P2: security and operations

- [x] **P2.17** Add guest-room-specific rate limits for room creation, joins, updates, and fan-out, plus a configurable maximum collaborator count per room.
- [ ] **P2.18** Add moderation and abuse controls: detect or block room spam, let admins inspect/delete rooms, and retain a basic room activity audit.
- [x] **P2.19** Add observability for active rooms/connections, update latency, payload size, reconnect rate, and dropped or invalid updates.

## P2: MCP and automation

- [x] **P2.20** Implement the [account-owned whiteboard MCP interface](mcp-whiteboards.md): dedicated scopes and
    tools/resources for list, read, create, rename, edit and trash; add restore only when the REST domain supports it.
- [ ] **P2.21** Define an account-bound room-management model before exposing guest-room creation, close or link rotation to
    MCP. Never use edit, view or owner link keys as MCP credentials.
- [x] **P2.22** Implement the drawing-service mutation seam and post-commit realtime event described in
    [the MCP interface](mcp-whiteboards.md), with revision/conflict handling and tool tests; do not let MCP write raw
    snapshots directly to the database.

## Later, after P2

- Add named collaborators and account ownership transfer if product requirements need them.
- Extend basic room activity audit into a full room-level history if operations need it.

## Known issues and verification gaps

These items are recorded separately from the completed P1 scope because they were not introduced by the whiteboard changes or still need a dedicated verification pass.

- **Full backend suite is effectively green after fixture refresh.** The Node.js 22 run reached 100% with 4,464 passed and 87 skipped; the only failure was the generated frontend-builder fixture, which was regenerated and now passes its freshness test. The production-settings probe also pins its origin lists so an ignored development `backend/.env` cannot contaminate it.
- **Browser verification is still partial, but now uses the supported runtime.** Under Node.js 22, the mocked landing smoke suite passes 7/7 and the real Chromium 25-collaborator room-full/rejoin scenario passes. The full app/editor/collaboration suites remain pending.
- **Full frontend unit-suite verification is still pending.** Vitest under Node.js 22 progressed through the suite but did not produce a summary within a 360-second timeout; the focused builder/realtime set passes 42/42.
- **P2.13 is partially complete.** `benchmark_drawing_room` records the 2/5/20/max single-process transport matrix with
  p50/p95 latency, payload bytes, delta/snapshot counts and fan-out. Browser render/reconnect and multi-worker
  verification remain open; the existing 50-client stress test does not replace those measurements.
- **Optional MCP proxy has a runtime DNS warning.** The web container logs `doory-mcp could not be resolved`; API, web, realtime, and `/api/v1/health/` remain healthy. MCP-specific checks should be run after the optional `doory-mcp` service/network is available.
