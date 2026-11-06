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
    """A shareable, anonymous whiteboard room.

    The key is deliberately stored as a digest.  The browser keeps the actual key in the URL
    fragment, which is never sent in an HTTP Referer header, and presents it only when it opens
    the room API or WebSocket.
    """

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
