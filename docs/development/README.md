# Development

## Requirements

- Python 3.12
- nvm, Node.js 22 and Bun 1.4.4. Newer Node.js versions can make some frontend tests fail.
- Optional: Docker, for PostgreSQL and Redis (`docker-compose.dev.yml`)
- Optional: Playwright's Chromium, for server-side export and the end-to-end tests

## Set up and run

```bash
nvm install    # reads the repository's .nvmrc
nvm use
make setup     # virtualenv in backend/.venv, dependencies, backend/.env, local SQLite database
make check     # verifies Node/Bun, Django settings and migrations
make dev-api   # API on http://localhost:8000 (also serves WebSockets)
make dev-web   # app on http://localhost:5173, in a second terminal; proxies /api and /ws to the API
```

To reuse an existing virtualenv: `make <target> PY=/path/to/venv/bin/python`.

The local settings are in `backend/.env`, created from [`backend/.env.example`](../../backend/.env.example).
Every setting is described in [configuration.md](../self-hosting/configuration.md).

The local `backend/.env.example` leaves the optional built-in image optimizer off because the lightweight setup does
not install mozjpeg (`cjpeg`) and oxipng. Set `IMAGE_OPTIMIZERS=builtin` only when both programs are on `PATH`.
The Docker image installs them by default through `INSTALL_IMAGE_OPTIMIZERS=true`.

## Make targets

| Target | What it does |
|--------|--------------|
| `make help` | List the targets |
| `make check` | Verify Node/Bun, local Django settings and migration state |
| `make setup` | Install dependencies and prepare the local database |
| `make dev-api`, `make dev-web` | Run the API and the frontend |
| `make migrate` | Apply migrations |
| `make content` | Install the first-run content (templates, elements, fonts, model, audio); downloads, takes minutes |
| `make seed ADMIN_PASSWORD=…` | `content`, plus an admin account (`ADMIN_EMAIL`, default `admin@doory.local`) |
| `make test` | Backend and frontend unit tests ([testing.md](testing.md)) |
| `make lint` | Ruff, Oxlint, Oxfmt, TypeScript and `docs-check` |
| `make fmt` | Format the backend and frontend code |
| `make docs-check` | Check that every setting is documented in configuration.md |
| `make docker-up`, `make docker-down` | Start and stop the full Docker stack |

## Optional local services

```bash
docker compose -f docker-compose.dev.yml up -d                    # PostgreSQL
docker compose -f docker-compose.dev.yml --profile redis up -d    # and Redis
```

Then set `DATABASE_URL` (and `REDIS_URL`) in `backend/.env`.

## Next

- [architecture.md](architecture.md): how the code is organised
- [architecture-deep-dive.md](architecture-deep-dive.md): runtime flows, persistence and service boundaries
- [mcp-whiteboards.md](mcp-whiteboards.md): proposed account-owned whiteboard MCP interface and implementation seam
- [whiteboard-realtime.md](whiteboard-realtime.md): document contract, delta protocol and realtime recovery behavior
- [whiteboard-roadmap.md](whiteboard-roadmap.md): completed guest-room/editor scope and remaining scale work
- [excalidraw-guest-collaboration.md](excalidraw-guest-collaboration.md): collaboration and URL design research
- [testing.md](testing.md): unit and end-to-end tests
- [CONTRIBUTING.md](../../CONTRIBUTING.md): pull requests and documentation rules
- [AGENTS.md](../../AGENTS.md): instructions for AI coding agents (`CLAUDE.md` loads the same file)
