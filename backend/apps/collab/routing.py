"""WebSocket URL routes."""

from django.conf import settings
from django.urls import path

from apps.drawings.realtime import DrawingConsumer, DrawingRoomConsumer

from .consumers import CollabConsumer

websocket_urlpatterns = (
    [
        path("ws/designs/<uuid:design_id>/", CollabConsumer.as_asgi()),
        path("ws/drawings/<uuid:drawing_id>/", DrawingConsumer.as_asgi()),
        path("ws/drawing-rooms/<uuid:room_id>/", DrawingRoomConsumer.as_asgi()),
    ]
    if settings.REALTIME_ENABLED
    else []
)
