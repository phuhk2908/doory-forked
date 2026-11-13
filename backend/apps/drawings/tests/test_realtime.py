import asyncio
from unittest.mock import AsyncMock, call, patch

import pytest
from asgiref.sync import async_to_sync
from channels.layers import InMemoryChannelLayer

from apps.drawings.events import broadcast_drawing_update
from apps.drawings.realtime import DrawingRoomConsumer


def test_account_drawing_updates_use_one_shared_broadcast_path():
    layer = InMemoryChannelLayer()
    channel = async_to_sync(layer.new_channel)()
    group = "doory.drawing.00000000-0000-4000-8000-000000000000"
    async_to_sync(layer.group_add)(group, channel)

    document = {"schemaVersion": 1, "elements": [], "background": "#ffffff"}
    delta = {"schemaVersion": 1, "elements": [], "background": "#eeeeee"}
    async_to_sync(broadcast_drawing_update)(
        "00000000-0000-4000-8000-000000000000",
        document,
        2,
        source="mcp",
        delta=delta,
        channel_layer=layer,
    )

    assert async_to_sync(layer.receive)(channel) == {
        "type": "drawing.document",
        "source": "mcp",
        "document": document,
        "delta": delta,
        "revision": 2,
    }


@pytest.mark.django_db
def test_guest_room_ping_rechecks_access_for_processes_without_shared_events():
    consumer = DrawingRoomConsumer()
    consumer.state = "active"
    consumer.room_id = "00000000-0000-4000-8000-000000000000"
    consumer.group = "doory.drawing-room." + consumer.room_id
    consumer.peer_id = "peer-1"
    consumer.room_mode = "edit"
    consumer.send_json = AsyncMock()
    consumer._load = AsyncMock(return_value={"mode": "view"})

    with patch("apps.drawings.realtime.refresh_guest_room_slot", return_value=None):
        asyncio.run(consumer.receive_json({"type": "ping"}))

    assert consumer.send_json.await_args_list == [
        call({"type": "access", "mode": "view", "can_edit": False}),
        call({"type": "pong"}),
    ]
