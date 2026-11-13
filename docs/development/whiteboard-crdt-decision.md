# Whiteboard CRDT decision

Status: research complete; no implementation or roadmap change in this note.

Date: 2026-11-08

## Decision summary

Doory should not replace the guest whiteboard room protocol with Yjs/CRDT as a blanket P2.15
migration. Keep the current versioned element merge as the default for shapes, drawings and other
independent elements. If simultaneous editing of the same text element becomes a product
requirement, add a separately gated, text-focused Yjs path first. Reconsider a full room migration
only after that prototype proves that its convergence and operational cost justify replacing the
current protocol.

This is a hybrid recommendation, not a claim that the current merge is conflict-free. It is a
good fit for independent canvas objects, but it is not a character-level text collaboration
algorithm.

## What Doory does today

The guest room document is JSON with an `elements` array. Each element has an `id`, `version` and
`versionNonce`; text elements store the complete string in `text`. The frontend increments the
version and changes the nonce when an element is edited, including on each textarea change. See
[`model.ts`](../../frontend/src/drawing/model.ts#L41-L84),
[`model.ts` element updates](../../frontend/src/drawing/model.ts#L466-L476), and
[`DrawingEditor.tsx` text editing](../../frontend/src/drawing/DrawingEditor.tsx#L953-L977).

The room transport coalesces local changes, computes an element-level delta against the last
server snapshot, and periodically sends a full snapshot. The backend takes a row lock and merges
elements by `(version, versionNonce)`. A larger version wins; equal versions use the nonce as a
deterministic tie-breaker. Deleted elements remain as tombstones, so an omitted stale element does
not resurrect it. See [`services.py`](../../backend/apps/drawings/services.py#L277-L344) and
[`roomRealtime.ts`](../../frontend/src/drawing/roomRealtime.ts#L350-L410).

Layer order is carried separately because an array reorder has no element version to compare. A document that has
been reordered includes a complete `order` id list and a document-level `(orderVersion, orderVersionNonce)` tuple.
Reorder-only deltas can therefore contain zero changed elements; merges choose the newer order tuple and append ids
created by a concurrent legacy client. Documents without the metadata remain valid and use their existing element
array order until a reorder is made.

This gives the current protocol useful guarantees:

- Two users adding or editing different element IDs are retained in one committed document.
- Concurrent messages are serialized by the database mutation seam, so the room has one durable
  JSON result and a monotonically increasing revision.
- Reconnects can recover from a full snapshot, and old clients can continue to use the full
  snapshot protocol.
- The transport remains bounded JSON, which fits the existing validators, rate limits, guest-key
  authentication and export paths.

The limitation is equally clear: two edits to the same element are whole-element replacement.
For example, if two clients start from `"hello"`, one inserts `X` and the other inserts `Y`, the
server does not see two character operations. It sees two candidate text strings and keeps one
according to the version/nonce ordering. The other edit is lost. The same applies to two users
changing different properties if the frontend submits each change as a new whole element: the
winning element snapshot carries only one side's property values.

The room page applies the merged document through `applyRemoteDocument()`, which now preserves a
live selection and an active textarea when the edited element still exists. An unrelated remote
update no longer closes the editor; if the same element has a remote winning value, Escape uses
that value as its cancel baseline, while blur still commits the local draft as a newer element
version. A remote deletion closes the textarea without resurrecting the tombstone. See
[`DrawingRoomPage.tsx`](../../frontend/src/pages/DrawingRoomPage.tsx#L201-L225) and
[`DrawingEditor.tsx`](../../frontend/src/drawing/DrawingEditor.tsx#L2227-L2278). The remaining
limitation is text intent, not editor interruption: concurrent character edits are still whole
string last-writer-wins.

Local undo, redo and Escape cancellation follow the same ordering rule. They rebase the selected
history snapshot onto the current document, increment changed element versions, and add tombstones
for ids that the target snapshot omits. A history action therefore remains visible to the room even
when the previous draft was already published; a raw older snapshot would lose to the room's newer
version and an omitted id could not delete an element under additive merging.

The current backend tests cover independent element merging and delta application, but do not
establish a same-element concurrent text policy. See
[`test_api.py`](../../backend/apps/drawings/tests/test_api.py#L177-L267).

## What Yjs would improve

Yjs exposes shared `Y.Map`, `Y.Array` and `Y.Text` types. `Y.Text` models text as an editable
sequence with insert, delete and formatting operations rather than replacing one JSON string. The
official API documents nested `Y.Text` values and text deltas in
[the Y.Text reference](https://docs.yjs.dev/api/shared-types/y.text). The collaborative-editor
guide explicitly uses `Y.Text` with an editor binding and describes concurrent changes being
resolved by Yjs:
[A Collaborative Editor](https://docs.yjs.dev/getting-started/a-collaborative-editor).

Yjs document updates are designed for transport and recovery: the official repository describes
them as commutative and idempotent, and supports state-vector-based incremental sync. See
[Yjs document updates](https://github.com/yjs/yjs#document-updates) and the
[y-protocols sync specification](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md#3-sync-protocol).
Awareness is a separate ephemeral protocol, so cursors and presence do not have to become durable
document content; see [the awareness protocol](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md#4-awareness-protocol).

The local micro-check used the installed Yjs dependency under Node 22. Two independent documents
inserted `A` and `B` at the same text position, exchanged updates in opposite directions, and both
converged to `BA`. The same experiment performed concurrent `Y.Map.set("text", ...)` operations
retained only one value. This is consistent with the Yjs implementation notes: text and arrays are
list CRDTs, while maps keep the last inserted entry for a key. See
[Yjs internals](https://github.com/yjs/yjs/blob/main/INTERNALS.md#list-items).

That distinction matters for the design:

- `Y.Text` can preserve concurrent character insertions/deletions inside one text element.
- A `Y.Map` around an element can merge unrelated property keys, but two writes to the same key
  still need a deterministic winner. Yjs does not automatically decide that two conflicting
  geometry updates should be combined into a meaningful shape transform.
- A CRDT therefore addresses the highest-value current gap, text editing, without removing the
  need for product-level conflict rules for geometry, deletion, ordering, bindings and files.

## Excalidraw comparison

Excalidraw's official collaboration code is useful evidence that versioned element reconciliation is
viable for a canvas editor. Its reconciler first protects a locally edited text element, then uses
element `version` and `versionNonce` to decide whether a remote element should be discarded. See
[`reconcile.ts`](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/reconcile.ts#L20-L40).
Its collaboration controller also sends incremental scene changes and queues periodic full-scene
updates rather than adopting a CRDT for the scene. See
[`Collab.tsx`](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx#L760-L815).

This supports keeping Doory's current approach for canvas objects, but it does not solve concurrent
typing. Excalidraw's local-text guard is a conflict policy: it protects the active local editor;
it is not a character-level merge of two users' edits. Doory now has the equivalent editor-stability
guard, while the versioned element merge remains whole-string last-writer-wins.

## Trade-offs

### Keep versioned element merging

Advantages:

- Smallest operational surface: the existing JSON schema, validators, revisions, row lock, guest
  keys, rate limits, metrics, exports and recovery behavior remain in one path.
- Independent shape edits already converge sufficiently for the current whiteboard interaction
  model.
- Full snapshots provide a simple repair and rollback boundary.
- No CRDT history or binary update log is needed for anonymous rooms.

Costs:

- Same-element concurrent edits are last-writer-wins at snapshot granularity.
- Text editing loses intent under concurrent typing, although remote updates no longer interrupt an
  active local editor unless its element is deleted.
- Background and file metadata still need explicit document-level policies; a versioned element
  tuple cannot make the whole JSON document semantically conflict-free. Layer ordering now has its own
  document-level version tuple so reorder-only edits survive delta transport and reconnects.

### Migrate the whole guest room to Yjs

Advantages:

- One update protocol can handle offline/reconnect delivery, incremental synchronization and
  character-level text collaboration.
- The repository already has Yjs on the frontend and a Yjs-compatible `pycrdt` collaboration path
  for account-owned designs, reducing discovery risk.
- Standard awareness semantics could replace part of the bespoke presence transport.

Costs and risks:

- The guest room would need a new Y document schema, a JSON-to-Y adapter, a Y-to-JSON export and
  a migration/rollback story for existing `DrawingRoom.document` rows.
- Durable storage becomes an update-log/snapshot problem: compaction, garbage collection, replay,
  maximum history, crash recovery and database transactions need explicit contracts. The official
  `y-websocket` project describes its simple backend as in-memory and not easy to scale, so it is
  not a drop-in production persistence solution; see
  [`y-websocket` README](https://github.com/yjs/y-websocket/blob/master/README.md#y-websocket).
- Yjs binary updates are untrusted input. Doory would need to reuse the existing scan/bounds
  discipline from `apps.collab`, but also define guest-room authorization, rate limits, update-size
  limits and close/expiry behavior for the separate room-key path.
- The existing `version/versionNonce` fields cannot remain the source of truth for CRDT conflicts.
  They may stay in exported JSON for renderer/backward compatibility, but CRDT identity and
  ordering would be authoritative inside an opted-in room.
- Yjs does not eliminate semantic conflicts for same-key map writes, concurrent deletes, object
  ordering, bindings or image/file ownership. Those rules still need tests and user-facing policy.
- A full migration increases the blast radius of reconnect, view-only access, room rotation,
  multi-worker Redis fan-out, admin close and MCP/account integrations at the same time.

### Hybrid text-focused path

This is the recommended experiment:

1. Keep `DrawingDocument` and the current versioned merge as the default/export contract.
2. Represent only text content as a nested `Y.Text` for an opted-in collaboration protocol. Keep
   element identity, geometry, deletion and files under explicit element/document rules.
3. Reconcile remote text into the existing editor without resetting an active textarea; bind or
   adapt cursor positions so local typing remains stable.
4. Convert the resulting Y state to validated JSON at export, account-save and recovery boundaries.
5. Use the existing Yjs/pycrdt security and persistence infrastructure where possible, but do not
   reuse account authorization or room credentials without an explicit guest-room adapter.

This approach isolates the part where Yjs provides a material user-visible benefit and preserves the
small, inspectable room model for the rest of the canvas.

## Recommendation and acceptance gates

For P2.15, keep the current guest-room version/nonce merge and implement no blanket CRDT migration.
Treat text collaboration as a separate prototype decision. The prototype should be opt-in and
discardable, with tests for:

- concurrent inserts at the same position;
- insert versus delete over overlapping ranges;
- paste, multiline input and IME/composition events;
- a remote edit while the local textarea is focused;
- undo/redo with local and remote origins separated;
- reconnect after updates are buffered offline;
- view-only clients, room close, expiry and key rotation;
- export/import round trips and bounded malicious updates.

Measure both protocols with the same document and collaborator matrix:

- lost text operations and final convergence across two, five, twenty and maximum collaborators;
- p50/p95 remote-update latency and reconnect time;
- inbound/outbound bytes, update count and full-snapshot frequency;
- browser render time while dragging and typing;
- per-room CPU, memory, durable-write latency and storage growth;
- recovery correctness after a worker crash or Redis interruption.

Adopt the hybrid Y.Text path only if it materially reduces lost text intent without violating the
room's existing latency, memory, security and recovery budgets. Adopt a full Yjs document only if
the same measurements show that object-level conflicts, offline editing or multi-worker recovery
also justify the larger migration. Until then, versioned element merging is the lower-risk and
more proportionate choice for Doory's guest whiteboard.

## Sources

Primary sources consulted:

- [Yjs documentation](https://docs.yjs.dev/)
- [Yjs shared types](https://docs.yjs.dev/getting-started/working-with-shared-types)
- [Y.Text API](https://docs.yjs.dev/api/shared-types/y.text)
- [Yjs repository and document updates](https://github.com/yjs/yjs)
- [Yjs internals](https://github.com/yjs/yjs/blob/main/INTERNALS.md)
- [Yjs wire protocol](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md)
- [Yjs WebSocket provider](https://github.com/yjs/y-websocket/blob/master/README.md)
- [Excalidraw element reconciliation](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/reconcile.ts)
- [Excalidraw collaboration controller](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx)
