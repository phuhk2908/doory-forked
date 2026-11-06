# Excalidraw guest collaboration research

Reviewed against the current `master` source of the official Excalidraw repositories and
developer docs on 2026-11-06. Sources in this document are limited to
`github.com/excalidraw/excalidraw`, `github.com/excalidraw/excalidraw-room`, and
`docs.excalidraw.com`.

## Summary

Excalidraw.com treats collaboration as an anonymous, link-capability room:

- The room link stays on the editor's existing URL and stores `roomId` and `roomKey` in
  the hash: `#room=<roomId>,<roomKey>`.
- The browser opens a Socket.IO connection and sends the room ID to join a server-side
  Socket.IO room. The official example room server does not implement sign-in or room
  authorization.
- The room key is generated in the browser and used for AES-GCM encryption. Scene and
  realtime payloads are encrypted before they leave the client. Firebase persistence also
  stores encrypted scene data.
- Durable scene updates and ephemeral cursor/presence updates use different paths. Scene
  updates send only newer elements, while cursor and presence updates are volatile and
  throttled. The client periodically sends a full scene and saves a snapshot to recover
  from dropped messages.
- The current hosted app implementation uses Socket.IO plus Firebase. The
  `@excalidraw/excalidraw` package itself does not include collaboration; the host app owns
  that integration.

This is a useful transport and performance pattern for Doory. Its anonymous room server
is not a suitable authorization model for a board product without adding a separate guest
share token, permissions, expiry, revocation, and server-side validation.

## Doory implementation status

Doory now uses the same existing SPA room URL for guest collaboration:
`/drawings/room#room=<uuid>,<edit-key>` for editing and
`/drawings/room#room=<uuid>,<view-key>,view` for view-only access. The server stores only
key digests, while the owner capability stays in session storage and controls room close
and link rotation. Guest snapshots are validated, merged by element version under a row
lock, and sent through a coalescing 120 ms WebSocket queue; cursor and selection presence
use a separate bounded 33 ms volatile stream. Room expiry, revocation, view-only access,
save-to-account, and the floating editor controls are implemented in the P0/P1 scope.

## Room IDs and share URLs

The app creates a room ID from 10 random bytes and hex-encodes it. It creates a separate
AES-GCM encryption key in the browser. The current parser accepts the room format and
requires a 22-character room key. The generated link is the current origin and pathname
with a `#room=<roomId>,<roomKey>` fragment appended.

- [Room ID generation and link parsing](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/index.ts#L63-L155)
- [AES-GCM key generation and encryption](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/encryption.ts#L4-L27)

The distinction between the two values matters:

| Value | Client role | Server role |
| --- | --- | --- |
| `roomId` | Selects the collaboration room | Used as the Socket.IO room name and Firestore document ID |
| `roomKey` | Encrypts and decrypts scene, cursor, and presence payloads | Not needed to relay the payloads in the official room server |

The client sends the `roomId`, ciphertext, and IV through Socket.IO. The room server only
relays those values to other sockets in the room. This makes the room key a bearer secret
held by anyone who has the link, while the server remains unable to decode the scene in
this flow.

- [Client-side encrypted Socket.IO payload](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Portal.tsx#L78-L95)
- [Room server relay](https://github.com/excalidraw/excalidraw-room/blob/master/src/index.ts#L67-L81)

Excalidraw therefore does not need a route such as `/drawings/local/<id>` to identify a
room. Its SPA can be served at one pathname, and the hash selects the scene mode after
the page loads. The pathname is preserved when a room link is created.

## Guest access and authentication

There is no account sign-in step in the official live-collaboration path. If the browser
does not have a saved collaboration username, the client generates a random username and
saves it in local storage. That username is a display identity, not authentication.

- [Anonymous username initialization](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx#L457-L466)
- [Username local-storage persistence](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/localStorage.ts#L9-L31)

The official example room server accepts a Socket.IO connection, handles `join-room`, and
calls `socket.join(roomID)`. Its source has CORS configuration but no authentication
middleware or per-room authorization check. This is an observation about that example
server, not a claim that every deployment of a modified room server must remain
unauthenticated.

- [Socket.IO connection and room join](https://github.com/excalidraw/excalidraw-room/blob/master/src/index.ts#L38-L65)
- [Official developer docs: collaboration is host-app specific](https://docs.excalidraw.com/docs/%40excalidraw/excalidraw/faq)

The practical access control is possession of the full link. Anyone who obtains it can
join and edit the room. The UI describes the session as private because the scene is
end-to-end encrypted, not because the room server authenticates collaborators.

- [Official collaboration dialog and privacy description](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/share/ShareDialog.tsx#L53-L169)
- [Official discussion describing the room key as link-held private data](https://github.com/excalidraw/excalidraw/discussions/2787)

## Realtime transport and persistence

### Join and initial scene

When a user starts a new session, the client generates the link, pauses local scene
saving, and opens a Socket.IO client using `VITE_APP_WS_SERVER_URL`. When it joins an
existing link, it resets the local scene rather than merging the old local scene into the
room. The first client loads the encrypted snapshot from Firebase. When a new client joins,
an existing client sends a full `SCENE_INIT` payload to it.

- [Room start, Socket.IO connection, and initial setup](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx#L457-L548)
- [New-user full-scene initialization](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Portal.tsx#L33-L55)
- [First client and Firebase scene load](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx#L651-L718)

### Scene updates

The editor calls `syncElements()` from its `onChange` callback. `Collab` first checks the
scene version, then delegates to `Portal.broadcastScene()`. `Portal` tracks the last
broadcast version for each element ID and includes only new or newer syncable elements in
normal updates. Very small elements and old deleted elements are excluded from the
syncable set.

- [Editor `onChange` to collaboration sync](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/App.tsx#L676-L689)
- [Scene-version gate and periodic full-scene queue](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx#L905-L944)
- [Per-element version filtering](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Portal.tsx#L132-L171)
- [Syncable-element filtering and deleted-element retention](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/index.ts#L40-L59)

Incoming scene updates are decrypted and reconciled by element ID/version. The client
marks the resulting version before updating the scene, which prevents the received scene
from being broadcast back as a new local change. Remote updates use
`CaptureUpdateAction.NEVER`, so they do not create local undo entries.

- [Incoming message handling](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx#L549-L649)
- [Element reconciliation and rebroadcast guard](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx#L720-L774)

The persisted scene is stored in Firestore at `scenes/<roomId>`. The client encrypts the
element JSON with the room key, stores the ciphertext and IV, and uses a transaction to
reconcile concurrent persisted versions before writing. The same room key decrypts the
snapshot when a client reconnects.

- [Encrypted Firebase scene document and transactional save](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/firebase.ts#L79-L105)
- [Firestore save and reconciliation](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/firebase.ts#L162-L230)
- [Firestore load and decryption](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/firebase.ts#L232-L254)

### Ephemeral collaborator state

Cursor, idle status, and follow-mode viewport bounds use the same encrypted transport but
are sent through Socket.IO's volatile broadcast path. The room server is allowed to drop
volatile messages under pressure. This is appropriate for state where a newer message
supersedes an older one.

- [Volatile server event definitions](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/app_constants.ts#L14-L27)
- [Volatile cursor, idle, and viewport broadcasts](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Portal.tsx#L172-L237)
- [Room server's volatile relay](https://github.com/excalidraw/excalidraw-room/blob/master/src/index.ts#L74-L81)

## Throttling, batching, and lag behavior

The current source uses several separate controls rather than one global throttle:

| Path | Current mechanism | Current value | Reason |
| --- | --- | ---: | --- |
| Pointer/cursor updates | `lodash.throttle` | 33 ms, about 30 FPS | Keep cursor traffic bounded and allow dropped stale positions |
| Normal scene updates | Per-element ID/version filtering | Per update | Avoid resending unchanged elements |
| Full scene broadcast | Throttled full snapshot | 20 s | Repair divergence after dropped messages |
| Firebase scene save | Throttled, leading edge disabled | 20 s | Keep persistence off the drawing hot path |
| Image upload | Throttled file queue | 300 ms | Batch image persistence after changes |
| Image loading | Throttled fetch | 500 ms | Avoid repeated fetches while remote scene changes arrive |
| Initial scene fallback | Timer | 5 s | Load the persisted scene if the initial socket message does not arrive |

- [Timing constants](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/app_constants.ts#L0-L12)
- [Cursor throttle and scene/full-sync throttles](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx#L879-L944)
- [Image upload queue and per-element scene filtering](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Portal.tsx#L96-L170)
- [Initial scene timeout and connection fallback](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx#L497-L547)

The browser renders the local edit immediately. Realtime transport and persistence happen
alongside the editor, while remote data is reconciled into the scene without adding to
local history. This separation is the main reason to avoid saving a complete board through
REST for every pointer movement.

The upstream repository also contains a historical report of severe lag with 43 users
and a very high message count. The report is from an older implementation and is not a
current benchmark, but it is a useful warning that cursor traffic, full-scene broadcasts,
and fan-out cost must be measured at the target room size.

- [Official performance issue for large rooms](https://github.com/excalidraw/excalidraw/issues/1808)

## URL routing and lifecycle

`initializeScene()` checks the current query and hash. A collaboration hash is detected by
`getCollaborationLinkData(window.location.href)`, and then `startCollaboration()` receives
the parsed `{ roomId, roomKey }`. The app uses `history.pushState()` when creating a room,
so the browser URL changes without a server route transition.

- [Scene initialization and collaboration-link dispatch](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/App.tsx#L205-L354)
- [History update when a room is created](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx#L472-L483)

The app listens for `hashchange`. A new collaboration hash starts or switches a room; a
hash that is no longer a collaboration link stops the current session and returns to local
scene handling. This is why changing the room does not require a distinct `/room/<id>`
route.

- [Hash-change lifecycle](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/App.tsx#L530-L652)
- [Collaboration state cleanup](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx#L394-L409)

## What this means for Doory

### Recommended room/link model

Use the existing semantic Doory board route for navigation, then add a collaboration
capability in the fragment. For example:

```text
/drawings/<drawing-id>#collab=<room-id>,<client-key>
```

If the backend needs to authorize guest joins, add a separate opaque share token. Keep the
client encryption key in the fragment so it is not included in ordinary HTTP requests or
server logs. The WebSocket client can present the share token during its handshake, while
the backend stores only a hash of the token and checks its permission, expiry, and revocation
state before joining the room.

This gives Doory two independent controls:

1. The backend share token decides who may join and whether they may view or edit.
2. The client encryption key protects scene contents from the relay and persistence layer.

The token should be separate from the encryption key. That lets an owner revoke a guest
link without having to re-encrypt the whole drawing, and it avoids treating an
unauthorized room ID as sufficient access.

### Recommended first collaboration transport

For a smooth first release, copy the data-flow decisions rather than the Excalidraw
infrastructure:

1. Render local edits optimistically.
2. Send element-level deltas keyed by element ID and monotonically increasing version.
3. Send cursor, selection, and presence as a separate volatile stream with a 30 FPS cap.
4. Coalesce queued scene changes while a socket write is in flight.
5. Persist a debounced snapshot, not every drag event.
6. Send a full snapshot on join and periodically after that to repair dropped deltas.
7. Reconcile incoming elements without creating undo entries or rebroadcasting the same
   update.
8. Bound message size and scene size, and reject malformed or unauthorized updates on the
   server before fan-out.

The current Doory stack already has an ASGI WebSocket service and a collaboration domain,
so a dedicated room protocol can fit without adding Firebase. The existing Yjs-based
collaboration architecture should be evaluated separately if conflict-free concurrent
editing is needed. The Excalidraw.com implementation itself demonstrates that a
versioned-element protocol with periodic snapshots can work without a CRDT for its basic
room model.

### Security and operational requirements

Guest collaboration should add the following before production use:

- Per-room access checks for every WebSocket join, not only at the initial REST page load.
- View/edit permissions, expiry, revocation, and a way for the owner to rotate a share link.
- Server-side validation of element type, payload size, custom data, and referenced files.
- Rate limits for joins, scene updates, cursor messages, and snapshot writes.
- Metrics for active sockets, room fan-out, dropped volatile messages, update bytes, snapshot
  size, and end-to-end update latency.
- Reconnect handling that reloads the latest snapshot and replays or replaces stale local
  state safely.

The official repository also has a current security report about unsafe collaborative
element content. Doory should treat every guest scene update as untrusted input, especially
if future elements can embed HTML, URLs, or external content.

- [Official collaborative-content security issue](https://github.com/excalidraw/excalidraw/issues/11930)

### Suggested performance test matrix

Before choosing between a delta protocol and a CRDT for Doory, measure separate scenarios:

- Two guests drawing at the same time.
- Five, twenty, and the expected maximum number of collaborators.
- A large board while one user drags continuously.
- Cursor-only activity with no scene changes.
- A dropped connection followed by reconnect and full snapshot recovery.
- A board containing many images and a large persisted snapshot.

Record client render time, WebSocket message count and bytes, p50/p95 remote-update
latency, snapshot-save latency, reconnect time, and server CPU/memory per active room.
This will show whether the bottleneck is rendering, message fan-out, persistence, or
conflict reconciliation.

## Sources

- [Excalidraw developer docs: development and collaboration setup](https://docs.excalidraw.com/docs/introduction/development)
- [Excalidraw developer docs: FAQ](https://docs.excalidraw.com/docs/%40excalidraw/excalidraw/faq)
- [Excalidraw app collaboration data helpers](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/index.ts)
- [Excalidraw app collaboration lifecycle](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx)
- [Excalidraw app Socket.IO portal](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Portal.tsx)
- [Excalidraw app Firebase persistence](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/firebase.ts)
- [Excalidraw app URL routing](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/App.tsx)
- [Official Excalidraw room server](https://github.com/excalidraw/excalidraw-room/blob/master/src/index.ts)
