from __future__ import annotations

from collections.abc import Iterator

import pytest
from django.core.cache import cache
from django.db import connection

from apps.accounts.models import User
from apps.apitokens import services as tokens
from apps.apitokens.scopes import SCOPES
from apps.mcp import context

PASSWORD = "correct-horse-battery-1"


@pytest.fixture(autouse=True)
def _mcp_on(settings):
    settings.MCP_ENABLED = True  # the server is opt-in


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def keep_the_test_connection() -> Iterator[None]:
    """MCP tools close obsolete connections in production, but not the test transaction's shared connection."""
    from apps.mcp import registry

    original = registry.close_old_connections

    def close_old_connections_outside_test_transaction() -> None:
        if connection.in_atomic_block:
            return
        original()

    with pytest.MonkeyPatch.context() as patcher:
        patcher.setattr(registry, "close_old_connections", close_old_connections_outside_test_transaction)
        yield


@pytest.fixture
def user(db):
    return User.objects.create_user(email="alice@example.com", password=PASSWORD, display_name="Alice")


@pytest.fixture
def other(db):
    return User.objects.create_user(email="bob@example.com", password=PASSWORD)


@pytest.fixture
def issued(user):
    return tokens.issue_token(user, name="Claude", scopes=list(SCOPES), expires_in_days=30)


@pytest.fixture
def as_caller(issued, keep_the_test_connection):
    """Run tool functions directly, as the holder of `issued`."""
    bound = context.bind(context.Caller(issued.token.owner, issued.token))
    yield issued
    context.unbind(bound)
