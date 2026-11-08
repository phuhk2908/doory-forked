# Whiteboard MCP interface

Status: proposed P2 contract. The MCP registry still exposes the design domain only; this document defines the
interface for account-owned whiteboards before implementation starts.

## Scope

The first whiteboard integration covers `Drawing` records owned by the authenticated Doory user. It does not cover
anonymous `DrawingRoom` records.

An MCP personal access token and a guest-room capability are different credentials:

- the MCP token identifies a Doory account and carries explicit scopes;
- edit, view and owner keys identify an anonymous room capability;
- MCP tools must never accept, return or log guest-room keys;
- MCP must not open a guest-room WebSocket or use a room key as a bearer token.

Room creation, closing and link rotation require a separate account-bound ownership model. They are out of this
interface until that model exists.

## Authentication and scopes

The MCP transport remains the existing stateless Streamable HTTP endpoint. The token middleware resolves the caller;
the whiteboard adapter limits every query and mutation to that caller's `Drawing` rows.

Add dedicated scopes rather than reusing design scopes:

| Scope | Allows | Destructive hint |
| --- | --- | --- |
| `drawings:read` | List and read account-owned whiteboards and read the drawing resource | No |
| `drawings:write` | Create, rename and edit account-owned whiteboards | No |
| `drawings:trash` | Trash, and later restore, account-owned whiteboards | Yes for trash |
| `drawing_rooms:manage` | Reserved for a future account-bound room model; do not issue yet | Depends on tool |

New scopes must not be added to existing tokens automatically. A token created before the scopes exist remains limited
to the scopes it was issued with.

## Resources

Register one snapshot resource:

```text
doory://drawings/{drawing_id}
```

It requires `drawings:read` and returns the same representation as `get_drawing`: identity, title, revision,
timestamps and the validated canonical document. The response must include an untrusted-content notice for text,
notes, links and custom element data. It is a snapshot, not an event stream; callers use the returned revision when
editing.

The resource must return the same not-found result for a missing, trashed or another user's drawing. This avoids
turning a resource read into an ownership probe.

## Tools

The initial tool set is deliberately small:

| Tool | Scope | Interface |
| --- | --- | --- |
| `list_drawings` | `drawings:read` | Search live or trashed whiteboards with bounded `limit`/`offset`; do not return documents in the list |
| `get_drawing` | `drawings:read` | Read one whiteboard, optionally including its full document |
| `create_drawing` | `drawings:write` | Create a blank board or a validated bounded document and return its id, revision and editor URL |
| `rename_drawing` | `drawings:write` | Set a cleaned title; mark idempotent |
| `edit_drawing` | `drawings:write` | Replace the validated document with a required `base_revision` |
| `trash_drawing` | `drawings:trash` | Move a board to trash; mark destructive and idempotent |

`restore_drawing` is reserved for the point at which the REST domain has a restore operation. No MCP tool should
pretend that restore exists while the `drawings` domain only supports trash.

`edit_drawing` starts with a full-document input because that is the current whiteboard persistence model. It must not
invent an MCP-only element-operation language. Element-level operations can be added later if the drawing service
gets a stable operation interface and conflict semantics.

## Write seam and consistency

MCP is an adapter over the `apps.drawings` domain module, not a second whiteboard engine. Every mutation follows this
path:

```text
MCP tool
  -> drawing service
      -> owner/trashed checks
      -> document validation and size limits
      -> optimistic revision check under row lock
      -> transaction commit
          -> drawing update event
              -> account whiteboard realtime group
```

The service is the write seam. MCP tools must not call `Drawing.objects.update`, bypass serializers/validators, or
write raw snapshots. REST, the account WebSocket consumer and MCP must share the same mutation rules.

The service must apply the configured `MAX_DRAWING_DOCUMENT_BYTES` limit itself. The serializer and WebSocket paths
already pass that setting to the validator, but a future MCP adapter will call the service directly and must not rely
on serializer validation.

An edit requires `base_revision`. A stale revision returns a structured conflict containing the current revision and
makes no change. A successful edit returns the accepted document and new revision. A title-only rename does not alter
the document revision, matching the current REST semantics.

The realtime event is emitted after commit, once. The WebSocket consumer must not broadcast a second copy of the same
mutation. With separate MCP and realtime processes, Redis (or another shared channel layer) is required for guaranteed
cross-process delivery. Without it, the durable write may still succeed, but the tool response must say that live
delivery is not guaranteed and the browser must reload or reconcile on its next refresh.

MCP never opens the whiteboard WebSocket itself. It publishes a domain event and leaves connection ownership,
presence, fan-out and client reconnect behavior to the realtime module.

## Safety and MCP annotations

- List, read and the resource are read-only.
- Create and edit are state-changing but not destructive; they must not be silently retried after an unknown result.
- Rename is idempotent.
- Trash is destructive and idempotent. The tool description must say that it removes the board from the live list.
- Whiteboard text, notes, URLs and custom data are untrusted content, never instructions for the assistant.
- The MCP document schema must bound custom data and validate every referenced file against the caller's assets; until
  that validation exists, the adapter must reject unsupported custom-data/file fields rather than pass them through.
- All tool errors use the existing MCP error translation and do not expose database or provider details.
- Calls use the existing per-user MCP rate limit and request/document byte ceilings.

## Required tests before enabling the tools

1. HTTP discovery lists only the tools/resources allowed by the token's whiteboard scopes.
2. A token with design scopes but no whiteboard scope cannot list, read or mutate drawings; an old token does not gain
   access automatically.
3. Reads and writes cannot cross owners and do not reveal whether a trashed or foreign id exists.
4. Create, rename, edit and trash use the drawing service; invalid documents and oversized payloads change nothing.
5. Two edits with the same base revision produce one success and one conflict on SQLite and PostgreSQL.
6. The configured document byte limit is enforced through direct service calls, not only through REST serializers.
7. A successful MCP edit is delivered once to an account whiteboard WebSocket when the shared channel layer is on.
8. Guest-room keys are rejected as MCP credentials and never appear in tool arguments, results or logs.
9. The full MCP suite runs with the database matrix; the realtime delivery test runs with Redis.

## Implementation order

1. Add the dedicated token scopes and token-settings descriptions without exposing tools yet.
2. Deepen the drawing service around one mutation result/event seam; make REST and the account WebSocket use it.
3. Add the resource and six account-owned tools with ownership, revision, annotation and error tests.
4. Add the scopes to the token-creation UI and self-hosting documentation.
5. Design room management separately, with an account-owned room record and explicit lifecycle permissions. Only then
   consider guest-room tools; guest capability keys remain outside MCP.
