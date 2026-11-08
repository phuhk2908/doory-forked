# Whiteboard room management

Status: the account-bound ownership seam is implemented in the drawings domain, but no room-management MCP tools
are exposed yet.

## Decision

`DrawingRoom` supports two ownership states:

| State | Account relationship | Management authority |
| --- | --- | --- |
| Guest room | No account owner | The browser-only owner capability, until the room closes or expires |
| Account-owned room | One account owner | The authenticated account identity, through the drawings service |

The account relationship is nullable so existing guest rooms remain valid and keep their current links. Existing
rooms are not automatically claimed by the user who created them, because the server does not have an account proof
for that historical action.

The account owner and the existing owner capability are deliberately different concepts. The owner capability is a
high-entropy browser credential stored as a digest and used by the anonymous room UI. The account owner is an
authenticated identity used by account-facing services. Neither credential is converted into the other.

## Invariants

- A room with no account owner remains a guest room; an MCP token cannot manage it.
- Account management filters by the authenticated account owner and never accepts an edit, view, or owner link key.
- Guest edit/view access still uses the existing room-key hash and WebSocket handshake. The account owner does not
  become a WebSocket credential.
- Closing or rotating links is performed under a row lock and records the existing room lifecycle event.
- Link rotation changes the edit and view capabilities but leaves the browser owner capability unchanged.
- Deleting an account removes the account relationship without deleting the room or turning a user token into a room
  capability. The room becomes ownerless and is handled as a guest room until it closes or expires.
- MCP room tools remain disabled until their response contract can manage a room without accepting, returning, or
  logging guest capability keys.

## Domain seam

The `apps.drawings.services` module now provides account-bound primitives for a future REST or MCP adapter:

- `create_account_drawing_room(account_owner, ...)` creates a room with an account relationship while retaining
  separate browser capabilities for a trusted browser-facing flow.
- `list_account_drawing_rooms(account_owner)` returns only rooms explicitly owned by that account.
- `rename_account_drawing_room(room_id, account_owner, title)` and `close_account_drawing_room(...)` authorize by
  account identity and preserve the existing lifecycle event behavior.
- `rotate_account_drawing_room_keys(room_id, account_owner)` rotates browser edit/view capabilities by account
  identity. Its returned keys are for a trusted browser adapter, not MCP credentials.

The public guest functions remain key-based for compatibility with `/drawings/room#room=...` and the room
WebSocket. Keeping the two sets of functions separate makes it harder for an adapter to accidentally treat a guest
key as an account authorization.

## Future MCP contract

The reserved `drawing_rooms:manage` scope must remain unavailable until the adapter contract is complete. A future
room tool may use the caller's account identity to list, create, rename, close, or rotate an account-owned room, but
it must satisfy all of these rules:

1. It can address only rooms owned by the authenticated account.
2. It never accepts a room key as an argument or uses one as a bearer credential.
3. It does not include raw edit, view, or owner keys in tool results, logs, errors, or audit metadata.
4. It separates browser link handoff from MCP authorization; the browser flow must decide how a user receives a
   share link without making that link an MCP credential.
5. It uses the domain services so lifecycle events, row locking, expiry, and close semantics remain consistent with
   REST and admin paths.

Room membership, named collaborators, ownership transfer, and claiming a historical guest room are separate product
decisions. They are not inferred from the nullable account-owner relationship.

## Migration and verification

The new relationship is nullable and has no data backfill. Existing rooms therefore remain guest rooms. Regression
coverage verifies that account ownership scopes list and mutate only the matching user's rooms, that guest keys still
open an account-owned room for browser access, that account link rotation invalidates the old edit/view keys, and
that anonymous rooms remain outside the account query.
