# Doory architecture deep dive

This document describes the architecture as it exists in the repository. The source of truth is the code and the
deployment configuration, with the existing [architecture overview](architecture.md) used as the index.

## 1. What the system is

Doory is a browser-based, self-hostable design editor. The browser can create designs without an account and keep
them in local browser storage. An account adds server persistence, uploads, sharing, comments, brand kits, version
history, real-time co-editing and server-backed integrations. The editor's document is a structured JSON design made
of pages and objects, rather than a server-rendered HTML page.

The product supports static designs, presentations, animation, audio, video clips, templates, stock media and
multiple export formats. The browser does most drawing and most downloads locally. The server supplies persistence,
catalogues, authentication, uploads, optional AI work and the heavier export paths.

Sources: [README](../../README.md), [document types](../../frontend/src/types/document.ts), [architecture overview](architecture.md).

## 2. Runtime topology

The production topology is a same-origin web gateway in front of several Django processes:

```text
Browser
  |
  v
web: nginx, static SPA and media gateway
  |-- /api, /admin, /static  --> api: Django REST + admin + server export
  |-- /ws                   --> realtime: Django Channels + uvicorn
  |-- /mcp                  --> mcp: stateless MCP over Streamable HTTP
  |-- /, /assets, /media    --> frontend files or shared media volume

api, realtime, mcp
  |-- PostgreSQL
  |-- media storage
  |-- optional Redis channel layer
  |-- optional external providers and AI server
```

Docker Compose runs `db`, `api`, `realtime` and `web` by default. `mcp`, `redis` and `ai-server` are opt-in
profiles. The API, realtime and MCP services use the same backend image and settings, but different process entry
points. PostgreSQL is the production database. A database-backed cache is the default production cache, while Redis
is needed when several realtime workers or replicas must share rooms.

The web container is intentionally the only published application address. Its nginx config forwards all dynamic
paths and serves the built frontend, which keeps browser cookies, CSRF and WebSockets same-origin. TLS is expected to
be terminated by an outer proxy or tunnel. In the current deployment, that outer layer is Cloudflare Tunnel and the
web container listens on the local port mapped by Compose.

Sources: [Compose stack](../../docker-compose.yml), [self-hosting topology](../self-hosting/README.md), [nginx config](../../frontend/nginx.conf), [backend Dockerfile](../../backend/Dockerfile).

## 3. Backend process boundaries

There are three Django entry points:

| Entry point | Process | Responsibility |
|---|---|---|
| `doory.wsgi:application` | gunicorn | Normal HTTP, REST API, admin and health endpoints |
| `doory.asgi:application` | uvicorn | Normal HTTP plus `/ws/` WebSockets for live editing |
| `doory.mcp_asgi:application` | uvicorn | MCP HTTP transport at `/mcp` |

`doory.urls` mounts the admin site and all REST app URL modules below `/api/v1/`, with the AI module below
`/api/v1/ai/`. The ASGI application uses a protocol router: HTTP goes to Django, while WebSockets go through
`AuthMiddlewareStack`, the origin validator and the collaboration URL router. The MCP ASGI process initializes Django
and builds its own Starlette/MCP application.

The production settings enforce a long secret, secure cookies, forwarded TLS handling, HSTS, same-origin CSRF and
proxy-aware client IPs. The base DRF configuration requires authentication by default, uses bounded JSON parsing,
standard pagination, a JSON-only renderer and global anonymous/user throttles. Individual public endpoints explicitly
opt out of the default permission.

Sources: [URL routing](../../backend/doory/urls.py), [WSGI](../../backend/doory/wsgi.py), [ASGI](../../backend/doory/asgi.py), [MCP ASGI](../../backend/doory/mcp_asgi.py), [base settings](../../backend/doory/settings/base.py), [production settings](../../backend/doory/settings/prod.py).

## 4. Backend domain modules

The backend is split by domain rather than by transport. Each app normally owns its models, serializers, views,
services, management commands, admin registration and tests. REST and MCP call the same domain services where the
operation is shared.

| App | Architectural responsibility |
|---|---|
| `accounts` | Custom email-based users, sessions, registration, login, password reset, email verification, Google and OIDC sign-in |
| `core` | Shared settings/config endpoint, pagination, parsers, exception envelopes, security middleware, image helpers and background-removal model installation |
| `designs` | `Design`, `Folder` and `DesignVersion`; document validation; creation, update, optimistic concurrency, duplication, trash and restore; template fields and fill operations |
| `assets` | User uploads, quotas, image/SVG/audio validation, stock media, video probing and conversion jobs |
| `gallery` | Published templates and categories, template use and starter-content import |
| `elements` | Shapes, icon packs, emoji, illustrations and catalogue search |
| `fonts` | Public font catalogue and user-uploaded fonts |
| `brand` | User brand kits, colours, fonts and logos |
| `sharing` | Share links, roles, optional passwords, comments and public shared-design access |
| `exports` | Browser-assisted PDF/image/video rendering, file delivery and image optimizers |
| `collab` | WebSocket protocol, room actors, Yjs-compatible state, presence, persistence and realtime maintenance |
| `presets` | Size preset catalogue used by Create and Resize |
| `apitokens` | Personal tokens and scopes used by MCP |
| `mcp` | MCP tools, resources, prompts, token middleware and tool-level scope/rate/error handling |
| `ai` | Operator and user AI providers, encrypted provider credentials, model discovery, quotas and outbound network policy |

The API surface mirrors these boundaries. Examples include `/designs/`, `/assets/`, `/templates/`, `/fonts/`,
`/brand-kits/`, `/share-links/`, `/comments/`, `/exports/`, `/size-presets/` and `/ai/` under `/api/v1/`.

Sources: [backend app map](architecture.md), [REST URL modules](../../backend/apps), [top-level API routes](../../backend/doory/urls.py).

## 5. The frontend shell

The browser starts at `index.html`, imports the global fonts and styles in `main.tsx`, applies contrast preferences
before the first render, and mounts `App`. `App` adds the error boundary, query client, toast provider and auth
provider around a React Router provider.

The route tree separates public marketing pages, authentication pages, the guest editor, shared-link pages, the
account editor and authenticated dashboard pages:

| Route family | Mode |
|---|---|
| `/`, `/templates`, `/features`, `/faq`, `/contact` | Public marketing and catalogue pages |
| `/login`, `/signup`, password and email routes | Authentication |
| `/create` then `/local/:localId` | Guest design creation and local editing |
| `/design/:id` | Authenticated account design editor |
| `/s/:token` | Shared view, comment or edit link |
| `/dashboard/*`, `/settings` | Authenticated account management |

Pages are lazy-loaded. The editor and collaboration code are also split from the normal application shell. The
application uses TanStack Query for server state and a single HTTP seam in `lib/api/client.ts`. That client uses
same-origin `fetch`, session cookies, CSRF cookies and `X-CSRFToken` for unsafe requests. It converts every failure
into an `ApiError`, retries only network and 5xx query failures, and invokes the auth flow on an unexpected 401.

Sources: [frontend entry](../../frontend/src/main.tsx), [app shell](../../frontend/src/App.tsx), [providers](../../frontend/src/app/AppProviders.tsx), [routes](../../frontend/src/app/routes.tsx), [API client](../../frontend/src/lib/api/client.ts), [query policy](../../frontend/src/app/queryClient.ts).

## 6. The editor's internal architecture

The editor is deliberately behind an adapter boundary. `EditorAdapter` is the only contract between the shell and the
editor. It provides saving, account migration, asset resolution, catalogue services, sharing, comments, versions,
AI, video, audio, exports and an optional realtime connection. The editor does not know about React Router, Django,
session state or raw HTTP.

The main editor layers are:

```text
EditorApp
  -> EditorProvider and ChromeProvider
  -> EditorEngine
       -> Zustand editor store
       -> Fabric page canvases
       -> document operations: insert, arrange, style, pages, crop, clipboard
       -> history and snapshots
       -> font and asset managers
       -> animation, audio, video and presenter APIs
       -> PersistenceController
       -> optional CollabSession
```

`EditorEngine` is framework-independent. React components read selected state from its Zustand store and call its
feature APIs. A `PageCanvas` owns a live Fabric canvas for a mounted page. The editor only mounts the pages and
regions it needs, while the document remains the canonical in-memory state.

The persistence controller autosaves account or shared-edit documents about 1.5 seconds after changes, never runs
two saves concurrently, flushes on page lifecycle events, creates a first-page thumbnail and reports dirty, saving,
saved, conflict and error states. It sends the snapshot through `adapter.save`, so the same engine can save to local
IndexedDB, REST or a shared-link endpoint.

The adapter implementations are:

- `guestAdapter`: saves the document and local assets in IndexedDB using `idb://` references. A save/share action can
  authenticate the user, upload local assets and migrate the design to the account without deleting the local copy
  until migration succeeds.
- `accountAdapter`: saves through `PATCH /designs/{id}/` with `base_revision`, uploads assets and thumbnails, and
  exposes the authenticated services.
- `sharedAdapter`: uses the share token and role. View links are read-only, comment links can comment, and edit links
  can save. A signed-in edit-link visitor may also join the live room.

Sources: [adapter contract](../../frontend/src/types/adapter.ts), [editor shell](../../frontend/src/editor/EditorApp.tsx), [engine](../../frontend/src/editor/engine/editor.ts), [persistence](../../frontend/src/editor/engine/persistence.ts), [account adapter](../../frontend/src/features/editor/adapters/accountAdapter.ts), [guest adapter](../../frontend/src/features/editor/adapters/guestAdapter.ts), [shared adapter](../../frontend/src/features/editor/adapters/sharedAdapter.ts).

## 7. The document and persistence model

The canonical design format is schema version 1. It stores a document width and height, display unit, optional metadata,
optional audio tracks and an ordered list of pages. Each page has an id, optional size override, background, objects,
notes, duration, guides and transition. Objects are Fabric-compatible JSON plus Doory-specific properties. Unknown
object properties are preserved, which lets later editor features round-trip through older code.

The server stores the canonical document in `Design.document`. The `Design` row also stores derived width, height,
page count, preset, thumbnail, owner, folder, star state, revision and trash timestamp. `DesignVersion` stores full
document snapshots for manual and automatic history. Saves lock the row and require the caller's `base_revision` to
match the current revision. A mismatch returns a 409 revision conflict instead of silently overwriting another save.
The document-to-row projection is centralized in `apps.designs.services.document_values` and `apply_document`; REST,
shared-link saves, restores, design creation and realtime flushes reuse it while keeping their own concurrency and
versioning policies.

The server validator is a security and resource boundary, not a complete object schema. It bounds pages, dimensions,
objects, nodes, depth, document bytes, animation/audio values and local asset references. Uploads must be persisted
as server assets before an account document can refer to them.

Guest documents are the exception: their document and media stay in the browser's IndexedDB repository, and the
adapter translates local asset ids into object URLs. Signing in runs a migration that creates the server design and
uploads referenced assets.

Sources: [frontend document types](../../frontend/src/types/document.ts), [backend validator](../../backend/apps/designs/validators.py), [design models](../../backend/apps/designs/models.py), [design services](../../backend/apps/designs/services.py), [guest storage adapter](../../frontend/src/features/editor/adapters/guestAdapter.ts).

## 8. Realtime collaboration

Realtime editing is a second persistence path layered over the same design model.

### Client side

When an adapter exposes a realtime connection, the shell starts the room while the design is still loading. The editor
then creates a `CollabSession` containing:

- a Yjs document with garbage collection disabled so local undo can restore deleted items;
- a Yjs awareness object for participant presence and editing locks;
- a `CollabProvider` that speaks the binary sync/awareness protocol over WebSockets;
- a `DocBinding` that maps the editor document into Y maps and arrays;
- a local undo manager for this user's own changes.

The Y document starts empty. The server's first sync becomes the shared base. Local changes made while connecting are
rebased on top of that copy. Incoming changes are read incrementally, reusing unchanged object/page references so the
engine does not rebuild every canvas on every remote keystroke.

### Server side

The WebSocket path is `/ws/designs/<uuid>/`. The consumer checks the origin, authenticates the owner session or a
share-link token/password, applies connection and frame limits, and admits the member according to the share role.
Each design is represented by one in-process `Room` actor. The room serializes work through an inbox, validates and
applies updates in order, writes accepted updates to the database before broadcasting them, and handles awareness,
heartbeats, slow consumers, title updates and permission changes.

The CRDT state is backed by:

```text
YState.snapshot + YUpdate rows
       |
       v
Room loads pycrdt document and update log
       |
       +--> broadcasts accepted deltas to connected clients
       |
       +--> periodically converts the live Y state to DoryDocument
             and flushes it into Design.document
```

`YState.base_revision` tells the room which saved `Design.revision` its live state came from. `version` counts update
batches, while `flushed_version` records how far the canonical design document has caught up. Compaction folds update
rows into the snapshot. Maintenance saves unflushed rooms, compacts long logs and removes stale presence rows.

One worker can use the in-memory channel layer. Multiple workers or replicas must set `REDIS_URL`; Redis carries room
updates between processes, while PostgreSQL remains the durable store. The realtime service refuses a multi-worker
configuration without Redis.

If realtime cannot connect or the protocol/session fails before the first sync, the frontend falls back to normal REST
autosave. While a live room is active, normal document saves stop; `save now` asks the room to flush, while title and
thumbnail updates use their own paths. This avoids a REST write replacing a shared CRDT state.

Sources: [ASGI routing](../../backend/doory/asgi.py), [consumer](../../backend/apps/collab/consumers.py), [room actor](../../backend/apps/collab/room.py), [CRDT engine](../../backend/apps/collab/engine.py), [collab store](../../backend/apps/collab/store.py), [collab models](../../backend/apps/collab/models.py), [frontend session](../../frontend/src/editor/collab/session.ts), [frontend binding](../../frontend/src/editor/collab/binding.ts), [realtime operations guide](../self-hosting/realtime.md).

### Guest whiteboard rooms

The whiteboard room seam uses `/drawings/room#room=<uuid>,<key>` for edit links and
`/drawings/room#room=<uuid>,<key>,view` for view links. The UUID selects a `DrawingRoom`; the key remains in the
browser fragment, is hashed in the database, and is presented in the initial room request and WebSocket auth frame.
Possession of the edit or view link grants its specific permission. A separate owner capability controls close and
key rotation. The existing owner-only `/ws/drawings/<uuid>/` consumer is unchanged.

Guest room updates are bounded JSON snapshots rather than Yjs deltas. The browser sends only its latest pending
snapshot every 120ms, the server validates it and merges elements by `version`/`versionNonce` under a row lock, then
broadcasts the accepted snapshot to the other members. A `saved` acknowledgement lets the source client clear its
pending state. This keeps pointer interaction off the REST save path. Cursor and selection presence are volatile,
bounded, and sent separately at 33ms. Room close and expiry reject new access; heartbeats also detect a close when
API and realtime processes do not share an in-memory channel layer.

Sources: [guest room model](../../backend/apps/drawings/models.py), [guest room service](../../backend/apps/drawings/services.py), [guest room WebSocket](../../backend/apps/drawings/realtime.py), [room page](../../frontend/src/pages/DrawingRoomPage.tsx), [Excalidraw room research](./excalidraw-guest-collaboration.md).

## 9. REST and MCP edit semantics

MCP is not a separate design engine. It is a stateless HTTP front end over the same domain operations.

The MCP process builds a registry from decorated tools and resources. Bearer authentication resolves a personal API
token. Each tool declares a scope such as reading or editing designs, and the registry wrapper applies scope checks,
per-user MCP call limits, database connection hygiene, error translation and logging. The MCP server marks tool
annotations such as read-only, destructive and idempotent for clients.

For an `edit_design` operation, the design edit service first checks whether a live room exists. If not, it applies
validated operations under normal optimistic concurrency and saves a new canonical document. If a live room exists,
it converts the operation result into a Y update, appends it to the collaboration store and notifies the room. Open
editors therefore see MCP changes as collaborator changes rather than having their document replaced underneath them.
Every edit records a version before the change, subject to the version interval limits.

The `drawings` app is deliberately outside this MCP registry for now. Its account-owned whiteboards have a separate
REST document and revision model, while guest rooms authenticate with edit/view/owner capability keys rather than a
user identity. An MCP personal access token therefore cannot join or manage a guest room, and room keys must not be
passed as tool arguments. The proposed account-owned interface is documented in
[mcp-whiteboards.md](mcp-whiteboards.md): it adds dedicated scopes, a snapshot resource and a small set of tools
behind one drawing-service mutation seam. The seam must apply revisions and publish one post-commit event for
realtime clients; it must not write raw snapshots directly or open a guest-room WebSocket.

MCP is disabled by default. Docker requires both `MCP_ENABLED=true` and the `mcp` Compose profile. It authenticates
with personal tokens rather than OAuth, and the nginx route deliberately returns 404 for OAuth discovery paths.

Sources: [MCP server](../../backend/apps/mcp/server.py), [MCP registry](../../backend/apps/mcp/registry.py), [MCP auth](../../backend/apps/mcp/auth.py), [design edit service](../../backend/apps/designs/edits.py), [MCP operations guide](../self-hosting/mcp.md).

## 10. Assets, catalogues and external services

Assets are owned by users and are separate from the JSON document. The upload pipeline identifies content from bytes,
not the filename, applies hard size and quota limits, sanitizes SVG, normalizes raster images, parses audio and uses
ffprobe/ffmpeg for video. Video conversion can answer with a processing asset that the frontend polls. Local storage
uses Django file storage; S3-compatible storage can replace it through the configured storage backend.

Catalogues are mostly server data consumed through public or account-scoped services:

- templates and categories come from `gallery`;
- shapes, icons, emoji and illustrations come from `elements`;
- public and user fonts come from `fonts`;
- size presets come from `presets`;
- stock photos, stock videos and Freesound audio are proxied through `assets` so provider keys stay server-side;
- brand kits, comments and sharing use authenticated domain APIs.

Background removal has two paths. The default editor path can use an installed browser model through ONNX runtime.
The optional `ai` app and reference AI server provide server-side or remote providers. Provider credentials are
encrypted at rest, outbound hosts and addresses are checked, and the UI exposes when an option sends an image off the
installation.

Content is intentionally not fully seeded by a fresh install. Management commands add templates, fonts, element packs,
models, audio and presets. The Docker entrypoint runs migrations, creates the cache table and collects static files;
optional content sync flags run before the server starts and tolerate failed downloads so the service can still boot.

Sources: [asset model](../../backend/apps/assets/models.py), [upload pipeline](../../backend/apps/assets/services.py), [storage configuration](../../backend/doory/settings/base.py), [content guide](../self-hosting/content.md), [AI settings](../../backend/apps/ai), [Docker entrypoint](../../backend/docker-entrypoint.sh).

## 11. Export architecture

Export is intentionally hybrid:

1. The browser renders ordinary downloads with the same editor engine. This avoids a server browser for the common
   path and supports PNG, JPG, SVG, PDF, MP4, WebM and GIF locally.
2. The server accepts SVG pages for print PDF export and uses headless Chromium when server-side export is enabled.
3. Server image, SVG, PDF and video export opens the built frontend's `render.html`, which imports the headless editor
   renderer without UI. The backend supplies the saved design and assets, captures the result, converts formats,
   applies size and timeout limits, and optionally runs an optimizer.

The frontend build has three entry pages: the normal SPA, `presenter-view.html` for the second presenter window and
`render.html` for server-side drawing. The API container reaches the render page through the `doory-web` network alias.
The render browser is restricted to configured origins and the SVG response is served with a sandbox CSP. Large or
long-running exports are streamed from temporary or export storage and protected by per-user rates and expiry.

The frontend and backend must be deployed from compatible versions because the backend's server-side renderer is
executing the frontend's drawing code.

Sources: [Vite multi-entry build](../../frontend/vite.config.ts), [render page](../../frontend/render.html), [export views](../../backend/apps/exports/views.py), [export guide](../self-hosting/image-export.md), [Compose render URL](../../docker-compose.yml).

## 12. Deployment and lifecycle

### Docker

The backend image builds a Python virtual environment, optionally installs Chromium, ffmpeg and image optimizers,
runs as an unprivileged `doory` user and exposes the API/realtime ports internally. The frontend image uses Bun to
build the Vite output, then runs unprivileged nginx on port 8080. Compose healthchecks gate startup: the API waits for
PostgreSQL, realtime waits for the API, and web waits for API and realtime.

The API entrypoint owns migrations and static collection. It also creates the database cache table and can run
first-start content synchronizers. The entrypoint does not create an administrator automatically. Admin creation is
an explicit `manage.py createsuperuser` operation.

### Development

The normal local workflow runs Django and Vite on the host, with optional PostgreSQL and Redis in
`docker-compose.dev.yml`. Vite proxies `/api`, `/media`, `/admin`, `/static` and `/ws` to the Django process, which
keeps local browser behavior close to production.

### Without Docker

The `deploy/` directory provides nginx configuration and systemd units for API, realtime, MCP and the optional AI
server. The process boundaries remain the same; only the service supervisor and network addresses change.

Sources: [Docker guide](../self-hosting/docker.md), [development guide](README.md), [dev Compose](../../docker-compose.dev.yml), [entrypoint](../../backend/docker-entrypoint.sh), [systemd units](../../deploy).

## 13. Security and reliability boundaries

The important trust boundaries are explicit:

- session cookies plus CSRF protect browser mutations;
- production settings require secure cookies and forwarded HTTPS awareness;
- auth endpoints have throttles and account lockout behavior;
- DRF has global anonymous/user throttles and narrower upload, stock, AI, fill, export and optimizer budgets;
- documents are bounded and validated before persistence or CRDT flush;
- uploads are content-sniffed, normalized and quota-checked; SVG is sanitized;
- stock and URL-import features enforce provider and network policies;
- AI provider URLs are checked against allowed hosts and private-network rules;
- WebSockets require a trusted origin, authenticated access, share-role authorization, frame/message/connection limits,
  heartbeat checks and slow-consumer eviction;
- CRDT updates are scanned and budgeted before the native engine applies them, with a slow-apply circuit breaker;
- MCP tokens are scoped, revocable, rate-limited and never broaden automatically when new tools appear;
- server rendering is bounded by page, pixel, byte, concurrency and timeout limits;
- Docker services use non-root users, `no-new-privileges`, memory limits for hostile CRDT/export workloads and
  isolated volumes.

The main availability fallback is realtime to REST autosave. The main consistency mechanism is optimistic revision
checking for ordinary saves and the Y update log plus `base_revision` for live rooms. Scheduled maintenance is still
required because the application does not run cron internally. `manage.py maintenance --json` is the operational
entry point: it exposes task timing and failures while running realtime cleanup, durable video jobs, video-folder
cleanup and expired-export cleanup.

Sources: [security settings](../../backend/doory/settings/base.py), [production settings](../../backend/doory/settings/prod.py), [auth views](../../backend/apps/accounts/views.py), [upload pipeline](../../backend/apps/assets/services.py), [collaboration engine](../../backend/apps/collab/engine.py), [nginx security paths](../../frontend/nginx.conf), [scheduled tasks](../self-hosting/README.md).

## 14. Testing and change surface

Testing is colocated with the domain code. Backend tests cover each app and include dedicated collaboration protocol,
sync, persistence, hardening, fuzz replay, Redis and multi-process cases. Frontend unit tests sit beside editor,
feature and shell modules. Playwright has separate suites for the app, editor, collaboration, comments, print,
background removal, performance and visual flows.

CI runs backend tests on SQLite and PostgreSQL, supplies Redis for collaboration tests, checks migrations and production
settings, then runs frontend lint, typecheck, Vitest, build and bundle budgets. Docker smoke tests verify API/config,
the SPA, WebSocket upgrade, MCP reachability and the render page. End-to-end jobs are optional because they are long.

For a feature change, the usual path is:

1. Find the route or editor command with CodeGraph.
2. Trace the adapter or API client to its backend URL module, view and service.
3. Check the model, serializer/validator and permission/throttle behavior.
4. If the design can be open, inspect both REST and collaboration paths.
5. Update colocated unit tests and the relevant Playwright suite.
6. Update configuration or self-hosting docs when a setting or service changes.

Sources: [testing guide](testing.md), [CI workflow](../../.github/workflows/ci.yml), [backend test tree](../../backend/apps), [frontend Playwright configs](../../frontend).

## 15. Architectural summary

The core design choice is separation of concerns around one canonical document:

- React and Fabric provide the interactive local editing experience.
- `EditorAdapter` keeps that experience reusable across guest, account and shared-link modes.
- REST provides durable CRUD and integrations.
- Yjs/pycrdt adds a live overlay for collaboration without replacing the canonical design model.
- MCP and REST share domain services, so assistants use the same validation and permissions as the UI.
- The frontend render page is reused by server-side export, keeping output aligned with the editor.
- nginx presents all of those paths as one same-origin application.

The main operational constraints follow directly from those choices: Redis is required for horizontally scaled live
rooms, the render page and backend must be version-aligned, maintenance commands must be scheduled externally, and
large document/media/export workloads need the configured memory, byte and timeout limits. Video conversions keep
their source in storage and can be recovered by `process_video_jobs` after an API restart. Opt-in background image,
document and video exports use the same durable snapshot and lease pattern through `ExportJob` and
`process_export_jobs`.

## 16. Follow-up backlog

- [x] Reduce the editor's eager bundle closure instead of raising the budgets. Toolbar sections, size controls and
  export pipelines now load on use; the current `/local/:id` initial route is below the 450 kB gzip budget and the
  lazy-closure test is below 1,200,000 source characters.
- [x] Move opt-in server-side image, document and video exports behind durable `ExportJob` rows with document
  snapshots, retry leases, private result delivery and a Docker worker.
- [x] Split the `EditorAdapter` capability contract so persistence, export and image-optimization seams are explicit.
- [x] Expand CI/E2E coverage for the worker service and new lazy editor paths; API tests cover background export polling.
