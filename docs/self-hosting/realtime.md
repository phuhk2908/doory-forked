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
- `/ws/drawing-rooms/{id}/` is for an anonymous guest room. The socket authenticates with a key in its first frame;
  the key is never placed in the WebSocket URL.

Guest room updates are validated JSON snapshots that are coalesced by the browser and merged by element version on
the server. Cursor and selection presence are volatile. The room's edit/view/owner keys remain separate from the
MCP token system; see [Whiteboards and MCP](mcp.md#whiteboards-and-mcp). Expired rooms are removed by
`manage.py collab_maintenance`.

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

`manage.py collab_maintenance` does three things:

- saves designs whose live state got ahead of the saved document, e.g. after a crash;
- folds long update logs into a snapshot;
- removes presence entries left by processes that are gone.

It's safe to run at any time. Schedule it as described in [Scheduled tasks](README.md#scheduled-tasks).

## Troubleshooting

- **Editors don't see each other's changes:** check that `/ws/` reaches the realtime service (look for failed
  WebSocket requests in the browser's network tab) and that the proxy passes the `Upgrade` and `Connection`
  headers.
- **Changes only reach some editors:** you're running several workers without Redis. Set `REDIS_URL`.
