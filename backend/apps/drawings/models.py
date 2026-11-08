import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


def drawing_thumbnail_path(instance, filename):
    return f"drawings/{instance.owner_id}/{instance.id}-{uuid.uuid4().hex[:10]}.webp"


def drawing_room_expiry():
    return timezone.now() + timedelta(days=settings.DRAWING_ROOM_TTL_DAYS)


class Drawing(BaseModel):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="drawings")
    title = models.CharField(max_length=200, default="Untitled whiteboard")
    document = models.JSONField(default=dict)
    thumbnail = models.ImageField(upload_to=drawing_thumbnail_path, blank=True)
    revision = models.PositiveIntegerField(default=1)
    trashed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["owner", "trashed_at", "-updated_at"])]

    def __str__(self):
        return self.title


class DrawingRoom(BaseModel):
    """A shareable whiteboard room.

    The key is deliberately stored as a digest.  The browser keeps the actual key in the URL
    fragment, which is never sent in an HTTP Referer header, and presents it only when it opens
    the room API or WebSocket.  ``account_owner`` is a separate, nullable relationship used by
    authenticated management paths; it is never a replacement for a browser capability key.
    """

    account_owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="drawing_rooms",
    )
    title = models.CharField(max_length=200, default="Untitled whiteboard")
    document = models.JSONField(default=dict)
    room_key_hash = models.CharField(max_length=64, editable=False)
    owner_key_hash = models.CharField(max_length=64, editable=False, blank=True, default="")
    view_key_hash = models.CharField(max_length=64, editable=False, blank=True, default="")
    revision = models.PositiveIntegerField(default=1)
    closed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    expires_at = models.DateTimeField(default=drawing_room_expiry, db_index=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title

    @property
    def is_closed(self) -> bool:
        return self.closed_at is not None

    @property
    def is_expired(self) -> bool:
        return self.expires_at <= timezone.now()


class DrawingRoomEvent(BaseModel):
    """Small audit records for room lifecycle and update activity; keys and documents are never stored."""

    room = models.ForeignKey(
        DrawingRoom,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )
    room_identifier = models.UUIDField(db_index=True)
    kind = models.CharField(max_length=40)
    client_ip_hash = models.CharField(max_length=64, blank=True)
    metadata = models.JSONField(default=dict)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["room", "-created_at"]),
            models.Index(fields=["kind", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.kind} for {self.room_identifier}"
