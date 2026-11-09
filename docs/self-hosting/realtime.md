# Realtime co-editing

Live co-editing runs over WebSockets at `/ws/`, in its own service: `realtime` in Docker, `doory-realtime` without
Docker. It uses the same code as the API, run by uvicorn.

## Requirements

- The proxy forwards WebSockets on `/ws/`. The bundled nginx configs already do this.
- With one worker (the default), you don't need anything else.
- With more than one worker or server, you need Redis so they can share updates.

## Whiteboards

The same realtime service also serves the whiteboard module, using a separate protocol from authenticated design
co-editing:

- `/ws/drawings/{id}/` is for an account-owned whiteboard and uses the signed-in session.
- `/ws/drawing-rooms/{id}/` is for a guest room. The socket authenticates with a key in its first frame; the key is
  never placed in the WebSocket URL. When a signed-in account has been added as a named collaborator, its display
  name and role are included in presence without changing the bearer-link access model.

Guest room updates are validated JSON snapshots that are coalesced by the browser and merged by element version on
the server. Cursor and selection presence are volatile. The room's edit/view/owner keys remain separate from the
MCP token system; see [Whiteboards and MCP](mcp.md#whiteboards-and-mcp). Expired rooms are removed by
`manage.py collab_maintenance`.

Guest rooms have separate abuse controls: room creation is throttled per client IP, join authentication is limited per
room and client IP, each connection has its own inbound message/byte budget, and room fan-out is capped by total
deliveries per second. A shared-cache collaborator lease enforces `DRAWING_ROOM_MAX_COLLABORATORS` across realtime
workers. Use a shared cache in production; a crashed worker can hold a collaborator lease until
`DRAWING_ROOM_MEMBER_TTL_SECONDS` expires.

Staff can inspect recent guest-room activity with `GET /api/v1/collab/stats/`. The `guest_rooms` object reports
active rooms and connections, connections, reconnects and their rate, inbound/outbound message bytes, fan-out deliveries,
updates, update latency percentiles, and dropped or invalid message counters. Each realtime worker publishes its
snapshot through the shared `CollabInstance` heartbeat; stale worker snapshots disappear with the normal heartbeat
window.

Room lifecycle, membership, ownership, update, and moderation activity is retained in the `DrawingRoomEvent` audit
table without storing room keys, documents, or raw client IP addresses. Signed-in room owners can manage named
collaborators and transfer ownership through the room Share dialog or the authenticated drawings API. Transfer
revokes the previous browser owner capability; existing edit/view links remain bearer links until rotated or closed.
Content scoring stores only a bounded score and reason codes. Rooms at or above `DRAWING_ROOM_SPAM_SCORE_THRESHOLD`
are marked for staff review in Django admin. `collab_maintenance` also removes events older than
`DRAWING_ROOM_AUDIT_RETENTION_DAYS`.

## Turn it on or off

It's on by default. Set `REALTIME_ENABLED=false` to turn it off; designs then save normally, without live
updates.

## Several workers

Docker:

```ini
COMPOSE_PROFILES=redis
REDIS_URL=redis://redis:6379/0
REALTIME_WORKERS=4
```

Then run `docker compose up -d`. Without Docker, point `REDIS_URL` at your Redis, raise `--workers` in
`doory-realtime.service`, and restart the services.

Redis also makes MCP edits show up immediately in open editors. Without it they appear within a few seconds.

## Settings

The connection and rate limits are listed under
[Realtime co-editing in configuration.md](configuration.md#realtime-co-editing). The defaults suit most sites.

## Maintenance

`manage.py collab_maintenance` does four things:

- saves designs whose live state got ahead of the saved document, e.g. after a crash;
- folds long update logs into a snapshot;
- removes presence entries left by processes that are gone.
- removes expired drawing rooms and room-audit events past the configured retention period.

It's safe to run at any time. Schedule it as described in [Scheduled tasks](README.md#scheduled-tasks).

## Troubleshooting

- **Editors don't see each other's changes:** check that `/ws/` reaches the realtime service (look for failed
  WebSocket requests in the browser's network tab) and that the proxy passes the `Upgrade` and `Connection`
  headers.
- **Changes only reach some editors:** you're running several workers without Redis. Set `REDIS_URL`.
