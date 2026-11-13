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

    class LinkMode(models.TextChoices):
        VIEW = "view", "Can view"
        EDIT = "edit", "Can edit"

    title = models.CharField(max_length=200, default="Untitled whiteboard")
    document = models.JSONField(default=dict)
    room_key_hash = models.CharField(max_length=64, editable=False)
    link_mode = models.CharField(
        max_length=4,
        choices=LinkMode.choices,
        default=LinkMode.EDIT,
    )
    owner_key_hash = models.CharField(max_length=64, editable=False, blank=True, default="")
    # Kept only so rooms created before canonical links can still be opened.
    view_key_hash = models.CharField(max_length=64, editable=False, blank=True, default="")
    revision = models.PositiveIntegerField(default=1)
    spam_score = models.PositiveSmallIntegerField(default=0)
    spam_flagged_at = models.DateTimeField(null=True, blank=True, db_index=True)
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


class DrawingRoomCollaborator(BaseModel):
    class Role(models.TextChoices):
        VIEW = "view", "Can view"
        EDIT = "edit", "Can edit"

    room = models.ForeignKey(DrawingRoom, on_delete=models.CASCADE, related_name="collaborators")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="drawing_room_collaborations",
    )
    role = models.CharField(max_length=4, choices=Role.choices, default=Role.EDIT)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="drawing_room_invitations",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["room", "user"], name="drawings_room_collaborator_unique"),
        ]
        indexes = [models.Index(fields=["user", "room"])]

    def __str__(self):
        return f"{self.user} in {self.room}"


class DrawingRoomEvent(BaseModel):
    """Room audit records; keys, documents and raw client IP addresses are never stored."""

    room = models.ForeignKey(
        DrawingRoom,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )
    room_identifier = models.UUIDField(db_index=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="drawing_room_events",
    )
    kind = models.CharField(max_length=40)
    client_ip_hash = models.CharField(max_length=64, blank=True)
    spam_score = models.PositiveSmallIntegerField(default=0)
    metadata = models.JSONField(default=dict)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["room", "-created_at"]),
            models.Index(fields=["kind", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.kind} for {self.room_identifier}"
