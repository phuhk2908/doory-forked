"""Per-connection and guest-room rate limiting."""

from __future__ import annotations

import time
from collections.abc import Callable
from hashlib import sha256

from django.conf import settings
from django.core.cache import cache


class TokenBucket:
    """Two token buckets, one counting messages and one counting bytes; a frame must fit in both."""

    def __init__(
        self,
        messages_per_second: float,
        message_burst: float,
        bytes_per_second: float,
        byte_burst: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._rates = (messages_per_second, bytes_per_second)
        self._capacity = (message_burst, byte_burst)
        self._tokens = [message_burst, byte_burst]
        self._clock = clock
        self._stamp = clock()

    @classmethod
    def from_settings(cls) -> TokenBucket:
        return cls(
            settings.REALTIME_RATE_MESSAGES_PER_SECOND,
            settings.REALTIME_RATE_BURST,
            settings.REALTIME_RATE_BYTES_PER_SECOND,
            settings.REALTIME_RATE_BYTES_BURST,
        )

    @classmethod
    def guest_room_from_settings(cls) -> TokenBucket:
        return cls(
            settings.DRAWING_ROOM_RATE_MESSAGES_PER_SECOND,
            settings.DRAWING_ROOM_RATE_BURST,
            settings.DRAWING_ROOM_RATE_BYTES_PER_SECOND,
            settings.DRAWING_ROOM_RATE_BYTES_BURST,
        )

    def allow(self, size: int) -> bool:
        """Take one message of `size` bytes; False (and nothing taken) when either bucket is short."""
        now = self._clock()
        elapsed, self._stamp = now - self._stamp, now
        for index in (0, 1):
            self._tokens[index] = min(
                self._capacity[index], self._tokens[index] + elapsed * self._rates[index]
            )
        if self._tokens[0] < 1 or self._tokens[1] < size:
            return False
        self._tokens[0] -= 1
        self._tokens[1] -= size
        return True


def guest_room_client_ip(scope: dict) -> str:
    """Use the address forwarded by the bundled proxy, then the ASGI peer address."""
    headers = dict(scope.get("headers", ()))
    forwarded = headers.get(b"x-real-ip") or headers.get(b"x-forwarded-for")
    if forwarded:
        return forwarded.decode("ascii", "ignore").split(",", 1)[0].strip() or "unknown"
    client = scope.get("client")
    return str(client[0]) if client else "unknown"


def _guest_room_counter(scope: str, identity: str, amount: int, limit: int, window: int) -> bool:
    if limit <= 0:
        return True
    bucket = int(time.time() // window)
    digest = sha256(identity.encode("utf-8")).hexdigest()[:24]
    key = f"guest-room-rate:{scope}:{digest}:{bucket}"
    if cache.add(key, amount, window + 1):
        return amount <= limit
    try:
        return cache.incr(key, amount) <= limit
    except ValueError:
        cache.set(key, amount, window + 1)
        return amount <= limit


def allow_guest_room_join(room_id: object, client_ip: str) -> bool:
    return _guest_room_counter(
        "join",
        f"{room_id}:{client_ip}",
        1,
        settings.DRAWING_ROOM_JOIN_RATE_PER_MINUTE,
        60,
    )


def allow_guest_room_fanout(room_id: object, recipients: int) -> bool:
    return _guest_room_counter(
        "fanout",
        str(room_id),
        max(1, recipients),
        settings.DRAWING_ROOM_FANOUT_PER_SECOND,
        1,
    )


def acquire_guest_room_slot(room_id: object) -> bool:
    """Reserve one room slot with a short lock so multiple realtime workers cannot over-admit."""
    room_key = f"guest-room-members:{room_id}"
    lock_key = f"{room_key}:lock"
    for _ in range(5):
        if not cache.add(lock_key, 1, 1):
            continue
        try:
            count = int(cache.get(room_key, 0))
            if count >= settings.DRAWING_ROOM_MAX_COLLABORATORS:
                return False
            cache.set(room_key, count + 1, settings.DRAWING_ROOM_MEMBER_TTL_SECONDS)
            return True
        finally:
            cache.delete(lock_key)
    return False


def release_guest_room_slot(room_id: object) -> None:
    room_key = f"guest-room-members:{room_id}"
    lock_key = f"{room_key}:lock"
    acquired = False
    for _ in range(5):
        if cache.add(lock_key, 1, 1):
            acquired = True
            break
        time.sleep(0.002)
    if not acquired:
        return
    try:
        count = int(cache.get(room_key, 0))
        if count <= 1:
            cache.delete(room_key)
        else:
            cache.set(room_key, count - 1, settings.DRAWING_ROOM_MEMBER_TTL_SECONDS)
    finally:
        cache.delete(lock_key)


def guest_room_member_count(room_id: object) -> int:
    """Return the cross-worker member count maintained by the room slot lease."""
    try:
        return max(0, int(cache.get(f"guest-room-members:{room_id}", 0)))
    except (TypeError, ValueError):
        return 0


def refresh_guest_room_slot(room_id: object) -> None:
    cache.touch(
        f"guest-room-members:{room_id}",
        settings.DRAWING_ROOM_MEMBER_TTL_SECONDS,
    )


def block_user(user_id: object) -> None:
    """Refuse the account's new live connections for `REALTIME_BLOCK_SECONDS` (shared cache)."""
    cache.set(f"collab-blocked:{user_id}", 1, settings.REALTIME_BLOCK_SECONDS)


def allow_connection_attempt(user_id: object) -> bool:
    """At most `REALTIME_CONNECTS_PER_MINUTE` new connections per account and minute (shared cache).

    An account that sent an update the engine needed seconds for (`block_user`) gets none for a while.
    """
    if cache.get(f"collab-blocked:{user_id}"):
        return False
    key = f"collab-connects:{user_id}"
    if cache.add(key, 1, 60):
        return True
    try:
        return cache.incr(key) <= settings.REALTIME_CONNECTS_PER_MINUTE
    except ValueError:  # the window ended between add() and incr()
        cache.set(key, 1, 60)
        return True
