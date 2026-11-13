"""Short-lived, cross-worker guest-room presence registry.

The WebSocket channel layer fans presence events out, but it cannot answer a new
connection's "who is already here?" query.  Keep the latest bounded state in the
shared Django cache so reconnects on another realtime worker can rebuild the
peer list.  This is deliberately ephemeral: the drawing database never stores
cursor or selection state.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from django.core.cache import cache

PRESENCE_TTL_SECONDS = 30
PRESENCE_INDEX_TTL_SECONDS = 3_600
_PREFIX = "drawing-room-presence:v1:"


def _state_key(room_id: object, peer_id: str) -> str:
    return f"{_PREFIX}{room_id}:peer:{peer_id}"


def _index_key(room_id: object) -> str:
    return f"{_PREFIX}{room_id}:index"


def _lock_key(room_id: object) -> str:
    return f"{_PREFIX}{room_id}:lock"


def _read_ids(room_id: object) -> list[str]:
    value = cache.get(_index_key(room_id), [])
    if not isinstance(value, list):
        return []
    ids: list[str] = []
    seen: set[str] = set()
    for peer_id in value:
        if not isinstance(peer_id, str) or not peer_id or peer_id in seen:
            continue
        seen.add(peer_id)
        ids.append(peer_id)
    return ids


def _mutate_ids(room_id: object, mutate: Callable[[list[str]], list[str]]) -> list[str]:
    """Update one room index while keeping concurrent worker changes bounded."""
    lock = _lock_key(room_id)
    acquired = False
    for _ in range(5):
        if cache.add(lock, 1, 1):
            acquired = True
            break
        time.sleep(0.002)
    if not acquired:
        return _read_ids(room_id)
    try:
        ids = mutate(_read_ids(room_id))
        if ids:
            cache.set(_index_key(room_id), ids, PRESENCE_INDEX_TTL_SECONDS)
        else:
            cache.delete(_index_key(room_id))
        return ids
    finally:
        if acquired:
            cache.delete(lock)


def set_room_presence(room_id: object, peer_id: str, state: dict[str, Any]) -> None:
    """Store a peer state and replace a stale entry using the same stable client id."""
    value = dict(state)
    value["peer_id"] = peer_id
    client_id = value.get("client_id")
    cache.set(_state_key(room_id, peer_id), value, PRESENCE_TTL_SECONDS)

    def mutate(ids: list[str]) -> list[str]:
        next_ids: list[str] = []
        for candidate in ids:
            if candidate == peer_id:
                continue
            candidate_state = cache.get(_state_key(room_id, candidate))
            if not isinstance(candidate_state, dict):
                continue
            if client_id and candidate_state.get("client_id") == client_id and candidate != peer_id:
                cache.delete(_state_key(room_id, candidate))
                continue
            next_ids.append(candidate)
        next_ids.append(peer_id)
        return next_ids

    _mutate_ids(room_id, mutate)


def update_room_presence(room_id: object, peer_id: str, state: dict[str, Any]) -> None:
    """Refresh an existing peer without taking the room-index lock on every cursor tick."""
    value = dict(state)
    value["peer_id"] = peer_id
    cache.set(_state_key(room_id, peer_id), value, PRESENCE_TTL_SECONDS)
    if peer_id not in _read_ids(room_id):
        _mutate_ids(
            room_id,
            lambda ids: ids if peer_id in ids else [*ids, peer_id],
        )


def list_room_presence(room_id: object) -> list[dict[str, Any]]:
    """Return live states and prune cache entries whose short TTL has elapsed."""
    ids = _read_ids(room_id)
    if not ids:
        return []
    states = cache.get_many({_state_key(room_id, peer_id): peer_id for peer_id in ids})
    live: list[dict[str, Any]] = []
    live_ids: list[str] = []
    for peer_id in ids:
        state = states.get(_state_key(room_id, peer_id))
        if not isinstance(state, dict):
            continue
        live_ids.append(peer_id)
        live.append(dict(state))
    if live_ids != ids:
        stale_ids = set(ids).difference(live_ids)
        _mutate_ids(
            room_id,
            lambda current: [
                peer_id
                for peer_id in current
                if peer_id not in stale_ids and isinstance(cache.get(_state_key(room_id, peer_id)), dict)
            ],
        )
    return live


def remove_room_presence(room_id: object, peer_id: str) -> None:
    cache.delete(_state_key(room_id, peer_id))
    _mutate_ids(room_id, lambda ids: [candidate for candidate in ids if candidate != peer_id])


def touch_room_presence(room_id: object, peer_id: str) -> bool:
    try:
        return bool(cache.touch(_state_key(room_id, peer_id), PRESENCE_TTL_SECONDS))
    except (AttributeError, KeyError, ValueError):
        return False
