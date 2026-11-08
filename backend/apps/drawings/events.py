from __future__ import annotations

import logging
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

log = logging.getLogger("doory.drawings")


def drawing_group(drawing_id: object) -> str:
    return f"doory.drawing.{drawing_id}"


def drawing_document_event(document: dict, revision: int, *, source: str) -> dict[str, Any]:
    return {
        "type": "drawing.document",
        "source": source,
        "document": document,
        "revision": revision,
    }


async def broadcast_drawing_update(
    drawing_id: object,
    document: dict,
    revision: int,
    *,
    source: str = "server",
    channel_layer: Any = None,
) -> None:
    """Publish one committed account-drawing snapshot to its realtime group."""
    layer = get_channel_layer() if channel_layer is None else channel_layer
    if layer is None:
        return
    await layer.group_send(
        drawing_group(drawing_id),
        drawing_document_event(document, revision, source=source),
    )


def publish_drawing_update(drawing_id: object, document: dict, revision: int) -> None:
    """Best-effort synchronous bridge for service-layer post-commit callbacks."""
    try:
        async_to_sync(broadcast_drawing_update)(drawing_id, document, revision)
    except Exception:
        # A missing or unhealthy channel layer must not turn a committed database write into a failure.
        log.warning("could not broadcast drawing=%s", drawing_id, exc_info=True)
