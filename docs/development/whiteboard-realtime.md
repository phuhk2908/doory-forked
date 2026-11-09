# Whiteboard realtime protocol

Doory uses a versioned document protocol for account-owned drawings and anonymous guest rooms. The database remains
the durable source of truth; WebSocket messages are delivery and recovery hints around the committed mutation.

## Document contract

Drawing documents use `schemaVersion: 1` and contain an `elements` list plus a background color. Elements are identified
by `id` and carry `version` and `versionNonce` when they are edited. Deleted elements remain as tombstones so a stale
client cannot resurrect them. The backend validates the same geometry, point, text, binding, grouping, custom-data and
file metadata fields that the frontend model can restore.

The validator intentionally leaves unknown top-level metadata alone. This keeps the schema forward-compatible while
still bounding the document size and validating fields that affect merge safety or rendering.

## Protocol versions

Protocol version 2 is opt-in during the existing handshake:

```json
{"type":"hello","protocol":2}
```

Guest rooms use the same value in their first authentication frame:

```json
{"type":"auth","key":"…","client_id":"…","protocol":2}
```

Clients that omit the field, or request an unknown version, continue to receive full `document` snapshots. This allows
the frontend and backend to be deployed independently.

Version 2 clients may receive a `delta` containing only changed elements and optional `background` or complete `files`
metadata. A delta is applied to the last committed snapshot and reconciled by element version. A full snapshot is sent
when the delta is not smaller, after a short repair cadence, or after reconnect.

The sender receives a full `saved` acknowledgement. That acknowledgement is deliberate: it gives the sender the
server-merged document and revision immediately, while other peers can use the smaller delta.

## Mutation and conflict seam

`apps.drawings.services.save_drawing_room_update()` accepts either a legacy full document or a validated delta. It locks
the room row, merges by element version, increments the revision only when the result changes, and returns the committed
document, revision and effective delta. REST, WebSocket and future automation integrations should use this service
instead of writing drawing JSON directly.

Account drawing writes use the same revision check as REST and publish their event with `transaction.on_commit()`. A
channel-layer failure therefore cannot roll back a committed database write.

## Metrics and limits

Guest-room metrics retain update latency buckets, inbound/outbound bytes, fan-out, reconnects and dropped/invalid
messages. They additionally distinguish `delta_updates` and `snapshot_updates`, so the payload reduction can be
observed without assuming that every room or browser has the same scene shape.

The client queue coalesces local changes behind a 250ms durable-save quiet period. While a save is in flight, the
latest document is also kept as a session-scoped recovery snapshot without the room key; a reconnect merges and
resubmits it before clearing the recovery entry. Each accepted room mutation still persists under the row lock, but
rapid pointer changes no longer create a durable write for every local snapshot.

## Verification boundary

Unit tests cover schema validation, version merging, delta application, protocol negotiation and reconnect requeueing.
The transport matrix can be run with:

```bash
cd backend
DJANGO_SETTINGS_MODULE=doory.settings.dev python manage.py benchmark_drawing_room
```

It reports p50/p95/max update latency, sent/received bytes, server payload counters, delta/snapshot counts and expected
fan-out for 2, 5, 20 and the configured maximum collaborators. The dedicated browser check can be run with Node.js 22
and an installed Chromium binary:

```bash
cd frontend
PW_CHROMIUM=/path/to/chromium bunx --no-install playwright test -c playwright.collab.config.ts \
  e2e/collab/guest-room.spec.ts
```

It opens two guest editors and verifies presence plus reconnect after an API restart. Multi-worker verification requires
Redis and two independent ASGI workers; in the current VM, separate workers on ports 8120 and 8121 exchanged a room
update at revision 2 through Redis. The benchmark command itself remains single-process and its latency numbers are not
a hard product limit.
