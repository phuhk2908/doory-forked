# Whiteboard post-MVP roadmap

The guest room MVP is live. The next work is split by room safety first, then editor and collaboration quality.

## Current P0/P1 reliability pass

1. [x] Align backend validation with the frontend drawing contract while keeping unknown top-level metadata
   forward-compatible.
2. [x] Keep room and account mutations behind revisioned service seams, with committed realtime events.
3. [x] Add protocol negotiation with full-snapshot fallback for rolling frontend/backend deploys.
4. [x] Send version-aware element deltas, periodic repair snapshots and full merged acknowledgements.
5. [x] Record delta/snapshot payload counters alongside existing latency, bytes, reconnect and fan-out metrics.
6. [x] Add a repeatable transport benchmark for 2/5/20/maximum collaborators, plus dedicated browser render/reconnect
   and Redis-backed multi-worker verification.

## P0: room controls

1. [x] End a live room. The owner can close it; existing sockets receive a close event and new API/WebSocket access is rejected.
2. [x] Revoke and rotate the room link. Rotation invalidates the previous share capability while leaving the owner capability intact.
3. [x] Let the owner switch the single room link between edit and view access. The same URL reflects the new permission after refresh; the server rejects document writes in view mode.
4. [x] Keep room ownership separate from share links. The owner capability is returned once at creation and stored in the browser session; it is never placed in a share URL.
5. [x] Expire and clean up rooms. New rooms expire after `DRAWING_ROOM_TTL_DAYS` (30 days by default). `collab_maintenance` deletes expired rows.

## P1: editor and collaboration quality

1. [x] Add fast keyboard actions and discoverable menu actions: tool keys (`V`, `H`, `R`, `O`, `D`, `L`, `A`, `P`, `T`, `N`, `E`), undo/redo, save, delete, nudge, duplicate, grouping, zoom, fit-to-content, and fit-selection.
2. [x] Hold `Space` to pan. The canvas shows a grab cursor, temporarily pans with the pointer, and restores the selected tool after release.
3. [x] Use a non-passive native wheel listener. `Ctrl`/`Command` + wheel zooms the board without browser zoom; plain wheel pans the board.
4. [x] Relay volatile cursor and selection presence separately from the document. Presence is throttled at 33ms, bounded, and never persisted.
5. [x] Show collaborator presence in the room: peer count, remote cursors, and selection outlines with reconnect-safe cleanup.
6. [x] Add a share dialog with one canonical room link, owner-controlled edit/view access, copy, link rotation, and end-room controls.
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
    - Fit selection and reset zoom.
    - Undo and redo the latest edit.
    - Select all live, unlocked elements.
    - Clear the current selection.
    - Copy and paste the current selection, including paste in place.
    - Cut the current selection with undoable soft-delete semantics.
    - Group, duplicate, delete, lock, style, alignment, connector, and layer actions for a selection.
    - Download PNG.
    - Export SVG.
    - Change the board background color with undo support.
    - Download selection PNG, export selection SVG/JSON, and copy the selection as an image.
    - Export JSON/source file.
    - Save to account when the board is still local and the visitor is a guest.
    - Keep Share, Rotate link, and End room in the collaboration controls because they change access for other people.
    - Open the same core actions from a canvas context menu, with element/group targeting, keyboard Context Menu/
      Shift+F10 access, focus navigation, outside-click dismissal, and viewport clamping.
14. [x] Add consistent tooltips for every tool and action on hover and keyboard focus, including the action name and its shortcut when one exists. Cover the shape dropdown, More menu, zoom pill, Eraser, and Note.

## P1: Excalidraw-style editor fidelity

1. [x] Use one text layout path for the canvas, textarea overlay, PNG and SVG export. Notes wrap against their inner
   width, keep padding, show a creation date, and retain a visible default label while editing. Selection dragging also
   snaps to nearby object edges/centres and near-equal neighbour spacing, with transient measurement guides. Remote
   room snapshots preserve live selection and text editing when the element still exists, while deleted active text
   closes without resurrecting it. Undo, redo and Escape cancellation rebase onto the current document so their
   versioned mutations remain visible after room merges and reconnects.
2. [x] Add single- and multi-selection transform handles for shapes, notes, lines, arrows and freehand strokes, with
   Shift-constrained resize, shared-centre multi-rotation, 15° Shift-snapped rotation, reset-rotation action, rotated
   bounds, live object-edge/centre snapping guides, and one history entry per gesture. Hold Alt/Option to move freely
   without object or grid snapping.
3. [x] Add a floating selection inspector for stroke/fill/opacity/line style, text font/size/line-height/alignment,
   shape roundness/roughness, rotation angle and arrowhead choices. Inspector changes also become defaults for new
   elements; visual styles can be copied from one selection and pasted across another with one undoable change,
   including arrowheads when the source is an arrow; selected styles can also be reset to defaults.
4. [x] Add canvas-native Ctrl/Cmd+A and copy/paste. Pasted elements receive fresh IDs, remapped groups and safe
   connector metadata; clipboard envelopes also carry only the referenced image metadata and accept legacy
   element-only payloads; system clipboard images are uploaded through the same metadata-only seam.
5. [x] Bind line/arrow endpoints to nearby shapes and notes, keep endpoints attached as targets move or resize, and
   detach bindings when their target is deleted.
6. [x] Add explicit endpoint handles, connector snapping guides and a user-facing binding affordance. Binding remains
   conservative, but selected line/arrow endpoints can now be dragged, snapped to a target boundary, highlighted, or
   detached by dragging away.
7. [x] Add connector path editing with midpoint handles and draggable waypoints while preserving endpoint bindings and
   one undo entry per path gesture.
8. [x] Add one-shot connector and selection tools after endpoint and waypoint editing: orthogonalize a path, reverse
   its direction, or flip supported visual elements while preserving endpoints, bindings, and arrowheads.
   Obstacle-avoiding or persistent auto-routing remains deferred until product-level usage data exists.
9. [x] Add image placement from a file picker with external file metadata, aspect-ratio initial sizing, local asset
   resolution, resilient placeholders, selection transforms and PNG/SVG export. The editor can also replace a selected
   image while preserving its frame, rotation and visual style, paste an image from the system clipboard, or drop an
   image directly onto the canvas at the pointer location. Crop, filters and search remain deferred until the image
   workflow has product usage data.
10. [x] Persist layer order as versioned document metadata. Bring/send layer actions publish reorder-only deltas,
   merges compare the order tuple independently of element versions, and legacy documents retain their existing array
   order until the first explicit reorder.

## P1: creation entry UX

15. [x] Make the `Start designing` chooser horizontal on desktop, with `Start a design` and `Start a whiteboard` as two equal entry cards. Stack the cards on small screens without changing the direct whiteboard route.
16. [x] Add a quick-start step before the full `Create a design` dialog. After choosing `Start a design`, show popular preset sizes, `Custom size`, `Start from a template`, and `All sizes`; quick choices should open the editor directly, while `All sizes` opens the existing full size picker.

## P2: performance and scale

- [x] **P2.13** Complete the browser and multi-worker half of the collaboration benchmark. The guest-room Chromium
    spec covers two editors and reconnect after an API restart; the transport matrix covers 2/5/20/max collaborators;
    and two independent ASGI workers successfully exchanged an update through Redis.
- [x] **P2.14** Reduce realtime payload size by moving from full snapshots to element-level deltas. Send only new or version-changed elements and use periodic full snapshots for resync. See [whiteboard-realtime.md](whiteboard-realtime.md).
- [x] **P2.15** Evaluate Yjs/CRDT only if version-based merging is not sufficient, with special attention to text editing and concurrent changes. Keep version/nonce merging for shapes; defer a gated `Y.Text` prototype until collaborative text is a product requirement. See [whiteboard-crdt-decision.md](whiteboard-crdt-decision.md).
- [x] **P2.16** Optimize persistence: coalesce durable saves behind a 250ms quiet period and keep a session-scoped
    recovery snapshot that is merged and applied after reconnect without storing the room key.

## P2: security and operations

- [x] **P2.17** Add guest-room-specific rate limits for room creation, joins, updates, and fan-out, plus a configurable maximum collaborator count per room.
- [x] **P2.18** Add baseline moderation and abuse controls: IP and shared-cache rate limits block room spam, staff can
    inspect/close/delete rooms in admin, and `DrawingRoomEvent` retains room activity audit records.
- [x] **P2.19** Add observability for active rooms/connections, update latency, payload size, reconnect rate, and dropped or invalid updates.
- [x] **P2.23** Add named account collaborators, role changes, removal, presence labels, and ownership transfer with
    browser-owner capability revocation.
- [x] **P2.24** Extend room audit history across lifecycle, membership, updates, moderation, ownership and content-risk
    events, with bounded spam scoring and configurable retention.

## P2: MCP and automation

- [x] **P2.20** Implement the [account-owned whiteboard MCP interface](mcp-whiteboards.md): dedicated scopes and
    tools/resources for list, read, create, rename, edit and trash; add restore only when the REST domain supports it.
- [x] **P2.21** Define the account-bound room-management model before exposing guest-room creation, close or link
    rotation to MCP. The nullable account-owner relationship and service seam are documented in
    [whiteboard-room-management.md](whiteboard-room-management.md); share and owner capabilities remain outside
    MCP.
- [x] **P2.22** Implement the drawing-service mutation seam and post-commit realtime event described in
    [the MCP interface](mcp-whiteboards.md), with revision/conflict handling and tool tests; do not let MCP write raw
    snapshots directly to the database.

## Later, after P2

The remaining work is product-specific hardening rather than a missing room-management primitive: a dedicated audit
viewer, invitation emails, and stricter per-user enforcement for rooms that should not accept bearer links can be
added when those policies are defined.

## Known issues and verification gaps

These items are recorded separately from the completed P1 scope because they were not introduced by the whiteboard changes or still need a dedicated verification pass.

- **Full backend suite is green.** The latest Node.js 22 run passed 4,487 tests with 87 skips. The real Chromium export and optimizer subset also passes after installing Chromium, `pdftoppm`, `cjpeg` and `oxipng`; one root-only Chromium sandbox test remains intentionally skipped.
- **Browser verification is green on the supported runtime.** Under Node.js 22, the mocked landing smoke suite, the real
  Chromium 25-collaborator room-full/rejoin scenario, the guest-room render/reconnect spec, and the full collaboration
  suite pass. The full collaboration run completed with 55 passed and 5 intentionally skipped visual-light tests.
- **Full frontend unit-suite verification is timing-sensitive.** A prior Vitest run under Node.js 22 passed 287 files and
  3,993 tests, with one skipped test; one existing `CommentPinsLoader` timing test failed in the full run but passed
  when run in isolation. The current image/rotation work has focused editor, renderer, geometry and asset tests.
- **Optional MCP proxy has a runtime DNS warning.** The web container logs `doory-mcp could not be resolved`; API, web, realtime, and `/api/v1/health/` remain healthy. MCP-specific checks should be run after the optional `doory-mcp` service/network is available.
