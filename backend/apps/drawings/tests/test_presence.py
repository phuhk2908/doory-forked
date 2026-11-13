from django.core.cache import cache

from apps.drawings.presence import (
    list_room_presence,
    remove_room_presence,
    set_room_presence,
    touch_room_presence,
)


def test_presence_registry_replaces_reconnecting_client_and_lists_other_workers(db):
    cache.clear()
    try:
        set_room_presence(
            "room-1",
            "old-peer",
            {"peer_id": "old-peer", "client_id": "stable", "mode": "edit"},
        )
        set_room_presence(
            "room-1",
            "other-peer",
            {"peer_id": "other-peer", "client_id": "other", "mode": "view"},
        )
        set_room_presence(
            "room-1",
            "new-peer",
            {"peer_id": "new-peer", "client_id": "stable", "mode": "edit"},
        )

        assert list_room_presence("room-1") == [
            {"peer_id": "other-peer", "client_id": "other", "mode": "view"},
            {"peer_id": "new-peer", "client_id": "stable", "mode": "edit"},
        ]
        assert touch_room_presence("room-1", "new-peer")
        remove_room_presence("room-1", "other-peer")
        assert list_room_presence("room-1") == [
            {"peer_id": "new-peer", "client_id": "stable", "mode": "edit"},
        ]
    finally:
        cache.clear()
