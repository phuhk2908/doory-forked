from asgiref.sync import async_to_sync
from channels.layers import InMemoryChannelLayer

from apps.drawings.events import broadcast_drawing_update


def test_account_drawing_updates_use_one_shared_broadcast_path():
    layer = InMemoryChannelLayer()
    channel = async_to_sync(layer.new_channel)()
    group = "doory.drawing.00000000-0000-4000-8000-000000000000"
    async_to_sync(layer.group_add)(group, channel)

    document = {"schemaVersion": 1, "elements": [], "background": "#ffffff"}
    async_to_sync(broadcast_drawing_update)(
        "00000000-0000-4000-8000-000000000000",
        document,
        2,
        source="mcp",
        channel_layer=layer,
    )

    assert async_to_sync(layer.receive)(channel) == {
        "type": "drawing.document",
        "source": "mcp",
        "document": document,
        "revision": 2,
    }
