from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.collab.models import CollabInstance
from apps.drawings.metrics import GuestRoomMetrics, aggregate_guest_room_metrics


def test_guest_room_metrics_track_connections_updates_and_latency():
    metrics = GuestRoomMetrics(instance="drawing-room:test")
    metrics.open_connection("room-a", "client-a")
    metrics.open_connection("room-b", "client-b")
    metrics.record_message(120)
    metrics.record_outbound(80)
    metrics.record_fanout(2)
    metrics.record_update(12, 100)
    metrics.record_update(80, 200)
    metrics.record_invalid("json")
    metrics.record_dropped("rate_limited")
    metrics.close_connection("room-a")
    metrics.open_connection("room-a", "client-a")

    snapshot = metrics.snapshot()
    assert snapshot["active_rooms"] == 2
    assert snapshot["active_connections"] == 2
    assert snapshot["inbound_bytes"] == 120
    assert snapshot["outbound_bytes"] == 80
    assert snapshot["update_payload_bytes"] == 300
    assert snapshot["invalid_json"] == 1
    assert snapshot["dropped_rate_limited"] == 1
    aggregated = aggregate_guest_room_metrics([snapshot])
    assert aggregated["reconnects"] == 1
    assert aggregated["reconnect_rate"] == 0.3333
    assert aggregated["update_latency_ms"] == {
        "count": 2,
        "average_ms": 46,
        "p50_ms": 25,
        "p95_ms": 100,
        "max_ms": 80,
    }

    metrics.close_connection("room-a")
    metrics.close_connection("room-b")
    assert metrics.snapshot()["active_connections"] == 0


def test_collab_stats_includes_live_guest_room_metrics(db):
    staff = User.objects.create_user("staff@example.com", "password-123", is_staff=True)
    CollabInstance.objects.create(
        instance="drawing-room:host:1",
        shared_layer=True,
        heartbeat_at=timezone.now(),
        counters={
            "guest_room": {
                "active_rooms": 1,
                "active_connections": 2,
                "updates": 3,
                "update_latency_ms": {
                    "count": 3,
                    "total_ms": 90,
                    "max_ms": 50,
                    "buckets": {"25": 2, "100": 1},
                },
            }
        },
    )

    client = APIClient()
    client.force_login(staff)
    body = client.get("/api/v1/collab/stats/").json()

    assert body["guest_rooms"]["active_rooms"] == 1
    assert body["guest_rooms"]["active_connections"] == 2
    assert body["guest_rooms"]["updates"] == 3
    assert body["guest_rooms"]["update_latency_ms"]["p95_ms"] == 100
