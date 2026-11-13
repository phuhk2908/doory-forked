import pytest
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIRequestFactory

from apps.collab.limits import (
    TokenBucket,
    acquire_guest_room_slot,
    allow_guest_room_fanout,
    allow_guest_room_join,
    guest_room_client_ip,
    guest_room_member_count,
    release_guest_room_slot,
)
from apps.drawings.throttling import GuestRoomCreateThrottle

pytestmark = pytest.mark.django_db


def setup_function():
    cache.clear()


def test_guest_room_creation_throttle_uses_the_client_ip():
    factory = APIRequestFactory()
    throttle = GuestRoomCreateThrottle()
    throttle.num_requests, throttle.duration = 1, 60
    assert throttle.allow_request(factory.post("/", REMOTE_ADDR="198.51.100.10"), None)
    assert not throttle.allow_request(factory.post("/", REMOTE_ADDR="198.51.100.10"), None)


def test_guest_room_join_rate_is_scoped_to_room_and_client():
    with override_settings(DRAWING_ROOM_JOIN_RATE_PER_MINUTE=2):
        assert allow_guest_room_join("room-a", "198.51.100.10")
        assert allow_guest_room_join("room-a", "198.51.100.10")
        assert not allow_guest_room_join("room-a", "198.51.100.10")
        assert allow_guest_room_join("room-a", "198.51.100.11")
        assert allow_guest_room_join("room-b", "198.51.100.10")


def test_guest_room_fanout_counts_recipient_deliveries():
    with override_settings(DRAWING_ROOM_FANOUT_PER_SECOND=3):
        assert allow_guest_room_fanout("room-a", 2)
        assert not allow_guest_room_fanout("room-a", 2)
        assert allow_guest_room_fanout("room-b", 3)


def test_guest_room_collaborator_slots_release_and_reuse():
    with override_settings(
        DRAWING_ROOM_MAX_COLLABORATORS=2,
        DRAWING_ROOM_MEMBER_TTL_SECONDS=60,
    ):
        assert acquire_guest_room_slot("room-a")
        assert acquire_guest_room_slot("room-a")
        assert guest_room_member_count("room-a") == 2
        assert not acquire_guest_room_slot("room-a")
        release_guest_room_slot("room-a")
        assert guest_room_member_count("room-a") == 1
        assert acquire_guest_room_slot("room-a")


def test_guest_room_connections_use_the_guest_budget_and_forwarded_ip():
    with override_settings(
        DRAWING_ROOM_RATE_MESSAGES_PER_SECOND=3,
        DRAWING_ROOM_RATE_BURST=3,
        DRAWING_ROOM_RATE_BYTES_PER_SECOND=100,
        DRAWING_ROOM_RATE_BYTES_BURST=100,
    ):
        bucket = TokenBucket.guest_room_from_settings()
        assert bucket.allow(10)
        assert bucket.allow(10)
        assert bucket.allow(10)
        assert not bucket.allow(10)
    assert (
        guest_room_client_ip({"headers": [(b"x-real-ip", b"198.51.100.10")], "client": ("10.0.0.1", 1)})
        == "198.51.100.10"
    )
