# Whiteboard room management

Status: account-bound room ownership and named collaborator management are implemented in the drawings domain and
authenticated REST UI. No room-management MCP tools are exposed yet.

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
- Account management filters by the authenticated account owner and never accepts a share or owner capability key.
- Guest access uses one room-link hash and WebSocket handshake. The stored link mode decides whether that capability
  can edit or view; the account owner does not become a WebSocket credential.
- Closing or rotating links is performed under a row lock and records the existing room lifecycle event.
- Link rotation changes the single browser share capability but leaves the browser owner capability unchanged. Older
  view-link hashes are accepted only as a migration fallback and are not generated for new rooms.
- Deleting an account removes the account relationship without deleting the room or turning a user token into a room
  capability. The room becomes ownerless and is handled as a guest room until it closes or expires.
- MCP room tools remain disabled until their response contract can manage a room without accepting, returning, or
  logging guest capability keys.
- A named collaborator is an existing active account identified by email. The owner may grant `view` or `edit`,
  change the role, or remove the collaborator. The role is reflected in authenticated presence; the public room link
  remains valid independently of collaborator rows.
- Ownership transfer requires an active account, records both account IDs in audit metadata, makes the target the
  account owner, retains the previous owner as an `edit` collaborator, and clears the previous browser owner
  capability. The target manages the room through account identity after the transfer.

## Domain seam

The `apps.drawings.services` module now provides account-bound primitives for a future REST or MCP adapter:

- `create_account_drawing_room(account_owner, ...)` creates a room with an account relationship while retaining
  separate browser capabilities for a trusted browser-facing flow.
- `list_account_drawing_rooms(account_owner)` returns only rooms explicitly owned by that account.
- `rename_account_drawing_room(room_id, account_owner, title)` and `close_account_drawing_room(...)` authorize by
  account identity and preserve the existing lifecycle event behavior.
- `rotate_account_drawing_room_keys(room_id, account_owner)` rotates the browser share capability by account
  identity. Its returned key is for a trusted browser adapter, not an MCP credential.
- `list_drawing_room_collaborators(...)`, `add_drawing_room_collaborator(...)`,
  `update_drawing_room_collaborator(...)`, and `remove_drawing_room_collaborator(...)` manage named accounts.
- `transfer_drawing_room_ownership(...)` performs the ownership handoff under a room row lock and revokes the old
  owner capability.

The REST endpoints are `/drawing-rooms/{id}/collaborators/`, `/drawing-rooms/{id}/collaborators/{user_id}/`, and
`/drawing-rooms/{id}/transfer-ownership/`. They require the current authenticated account owner; they do not accept
room keys.

The public guest functions remain key-based for compatibility with `/drawings/room#room=...` and the room
WebSocket. Keeping the two sets of functions separate makes it harder for an adapter to accidentally treat a guest
key as an account authorization.

## Future MCP contract

The reserved `drawing_rooms:manage` scope must remain unavailable until the adapter contract is complete. A future
room tool may use the caller's account identity to list, create, rename, close, or rotate an account-owned room, but
it must satisfy all of these rules:

1. It can address only rooms owned by the authenticated account.
2. It never accepts a room key as an argument or uses one as a bearer credential.
3. It does not include raw share or owner capability keys in tool results, logs, errors, or audit metadata.
4. It separates browser link handoff from MCP authorization; the browser flow must decide how a user receives a
   share link without making that link an MCP credential.
5. It uses the domain services so lifecycle events, row locking, expiry, and close semantics remain consistent with
   REST and admin paths.

Claiming a historical guest room remains a separate product decision and is not inferred from the nullable
account-owner relationship.

## Migration and verification

The new relationship is nullable and has no data backfill. Existing rooms therefore remain guest rooms. Regression
coverage verifies that account ownership scopes list and mutate only the matching user's rooms, that the canonical guest
key still opens an account-owned room for browser access, that account link rotation invalidates the old share key, and
that anonymous rooms remain outside the account query.
