# Developer shortcuts. Run `make help` for the list.
#
# Override the interpreter to reuse an existing virtualenv:  make test PY=/path/to/venv/bin/python

PYTHON ?= python3
VENV   ?= backend/.venv
PY     ?= $(VENV)/bin/python
MANAGE  = cd backend && $(abspath $(PY)) manage.py
NODE_VERSION_FILE ?= .nvmrc
BUN_VERSION ?= 1.4.4

# Font families `make content` installs: the N most popular of the curated list (253 in all).
FONT_FAMILIES ?= 100

# Optional first administrator for `make seed`: make seed ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=...
ADMIN_EMAIL    ?= admin@doory.local
ADMIN_PASSWORD ?=
export ADMIN_EMAIL ADMIN_PASSWORD

.DEFAULT_GOAL := help
.PHONY: help setup check check-node check-bun check-tooling check-backend check-migrations dev-api dev-web test test-api test-web lint docs-check fmt seed content migrate docker-up docker-down

help: ## List the available targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

setup: check-tooling ## Install backend and frontend dependencies and prepare the local database
	test -x $(PY) || $(PYTHON) -m venv $(VENV)
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r backend/requirements-dev.txt
	test -f backend/.env || cp backend/.env.example backend/.env
	$(MANAGE) check
	$(MANAGE) migrate --noinput
	cd frontend && bun install --frozen-lockfile

check: check-tooling check-backend check-migrations ## Verify Node, Bun, Django settings and migration state

check-node: ## Verify that the active Node.js major matches .nvmrc
	@test -s "$(NODE_VERSION_FILE)" || { echo "Missing $(NODE_VERSION_FILE)." >&2; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo "Node.js is required. Run 'nvm install && nvm use'." >&2; exit 1; }
	@node -e 'const fs = require("node:fs"); const expected = fs.readFileSync(process.argv[1], "utf8").trim().replace(/^v/, "").split(".")[0]; const actual = process.versions.node.split(".")[0]; if (actual !== expected) { console.error("Node.js " + process.versions.node + " is active; this project requires Node.js " + expected + ". Run: nvm install && nvm use"); process.exit(1); }' "$(NODE_VERSION_FILE)"

check-bun: ## Verify the Bun version used by the lockfile and CI
	@command -v bun >/dev/null 2>&1 || { echo "Bun is required (version $(BUN_VERSION))." >&2; exit 1; }
	@actual="$$(bun --version)"; test "$$actual" = "$(BUN_VERSION)" || { echo "Bun $$actual is active; this project requires $(BUN_VERSION)." >&2; exit 1; }

check-tooling: check-node check-bun ## Verify the JavaScript toolchain

check-backend: ## Run Django's local-settings system checks
	@test -x "$(PY)" || { echo "Missing $(PY); run 'make setup' first." >&2; exit 1; }
	$(MANAGE) check

check-migrations: ## Verify that migrations match the Django models
	@test -x "$(PY)" || { echo "Missing $(PY); run 'make setup' first." >&2; exit 1; }
	cd backend && DJANGO_SETTINGS_MODULE=doory.settings.dev $(abspath $(PY)) manage.py makemigrations --check --dry-run

dev-api: check-backend ## Run the Django API on http://localhost:8000
	$(MANAGE) runserver 8000

dev-web: check-tooling ## Run the Vite dev server on http://localhost:5173 (proxies /api to the API)
	cd frontend && bun run dev

migrate: check-backend ## Apply database migrations
	$(MANAGE) migrate --noinput

test: check-tooling check-migrations test-api test-web ## Run the backend and frontend test suites

test-api: check-migrations ## Backend tests (pytest)
	cd backend && $(abspath $(PY)) -m pytest

test-web: check-tooling ## Frontend tests (vitest)
	cd frontend && bun run test

lint: docs-check check-tooling check-backend check-migrations ## Ruff, Oxlint, Oxfmt, TypeScript and docs checks (no changes)
	cd backend && $(abspath $(PY)) -m ruff check . && $(abspath $(PY)) -m ruff format --check .
	cd frontend && bun run lint && bun run format:check && bun run check

docs-check: ## Check that every setting is documented in docs/self-hosting/configuration.md
	sh docs/check-settings.sh

fmt: ## Auto-fix and format backend and frontend code
	cd backend && $(abspath $(PY)) -m ruff check --fix . && $(abspath $(PY)) -m ruff format .
	cd frontend && bun run format

# The downloads are independent and every command can simply be run again, so one failing source
# (make prints "Error 1 (ignored)") does not stop the others.
content: migrate ## Install first-run content: template categories and starter templates, elements, fonts, model, audio library (network, minutes)
	$(MANAGE) seed_gallery
	$(MANAGE) seed_templates
	$(MANAGE) seed_elements
	-$(MANAGE) sync_element_packs
	-$(MANAGE) sync_fonts --popular $(FONT_FAMILIES)
	-$(MANAGE) sync_models
	$(MANAGE) sync_audio

seed: export DJANGO_SUPERUSER_EMAIL = $(ADMIN_EMAIL)
seed: export DJANGO_SUPERUSER_PASSWORD = $(ADMIN_PASSWORD)
seed: content ## Prepare a fresh dev database: the first-run content and, with ADMIN_PASSWORD, an admin account
	@if [ -z "$$ADMIN_PASSWORD" ]; then echo "Pass ADMIN_PASSWORD=... to create an admin account ($$ADMIN_EMAIL)."; \
	else out=$$($(MANAGE) createsuperuser --noinput 2>&1) \
	  && echo "Admin account created: $$ADMIN_EMAIL" || echo "$$out"; fi

docker-up: ## Build and start the full stack (requires a .env file, see .env.example)
	@test -f .env || { echo "Create .env first: cp .env.example .env"; exit 1; }
	docker compose up --build --detach
	@echo "Doory is starting on http://localhost:$${WEB_PORT:-8080}"

docker-down: ## Stop the Docker stack (data volumes are kept)
	docker compose down

# Keep every local Django management command on the same settings module. Pytest has its own explicit test setting
# below, while Docker and the ASGI/WSGI entrypoints set production settings in their own environments.
setup migrate dev-api content seed check-backend: export DJANGO_SETTINGS_MODULE = doory.settings.dev
test-api check-migrations: export DJANGO_SETTINGS_MODULE = doory.settings.test
