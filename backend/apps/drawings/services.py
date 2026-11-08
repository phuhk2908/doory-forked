from __future__ import annotations

import hashlib
import logging
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from functools import partial
from io import BytesIO

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import DatabaseError, transaction
from django.http import Http404
from django.utils import timezone

from apps.assets.exceptions import FileTooLarge, InvalidFile, LimitReached
from apps.assets.storage import delete_files_on_commit
from apps.assets.uploads import strip_unsafe_chars
from apps.core.images import ImageError, make_thumbnail, process_image_upload

from .events import publish_drawing_update
from .exceptions import RevisionConflict
from .models import Drawing, DrawingRoom, DrawingRoomEvent
from .validators import validate_drawing_delta, validate_drawing_document

DEFAULT_TITLE = "Untitled whiteboard"
THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024
THUMBNAIL_MAX_PIXELS = 16_000_000
THUMBNAIL_SIDE = 480
log = logging.getLogger("doory.drawings")


@dataclass(frozen=True)
class DrawingRoomMutation:
    room: DrawingRoom
    document: dict
    revision: int
    delta: dict
    changed: bool


def blank_document() -> dict:
    return {"schemaVersion": 1, "elements": [], "background": "#ffffff"}


def clean_title(title: str) -> str:
    return " ".join(strip_unsafe_chars(title).split())[:200].strip() or DEFAULT_TITLE


def _room_key_hash(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _valid_room_key(key: str | None) -> bool:
    return isinstance(key, str) and 32 <= len(key) <= 128


def record_drawing_room_event(
    room_id,
    kind: str,
    *,
    client_ip: str | None = None,
    metadata: Mapping[str, object] | None = None,
) -> None:
    """Keep a small room audit trail without retaining keys, documents or raw client addresses."""
    try:
        with transaction.atomic():
            DrawingRoomEvent.objects.create(
                room_id=room_id,
                room_identifier=room_id,
                kind=kind[:40],
                client_ip_hash=(hashlib.sha256(client_ip.encode("utf-8")).hexdigest() if client_ip else ""),
                metadata=dict(metadata or {}),
            )
    except (DatabaseError, TypeError, ValueError):
        log.warning("could not record drawing room event room=%s kind=%s", room_id, kind, exc_info=True)


def _room_access(room: DrawingRoom, key: str | None) -> str | None:
    if not _valid_room_key(key) or room.is_closed or room.is_expired:
        return None
    digest = _room_key_hash(key)
    if secrets.compare_digest(room.room_key_hash, digest):
        return "edit"
    if room.view_key_hash and secrets.compare_digest(room.view_key_hash, digest):
        return "view"
    return None


def _element_version(element: dict) -> tuple[int, int]:
    version = element.get("version")
    nonce = element.get("versionNonce")
    return (
        version if isinstance(version, int) and not isinstance(version, bool) else 1,
        nonce if isinstance(nonce, int) and not isinstance(nonce, bool) else 0,
    )


def _normalise_element(element: dict) -> dict:
    version, nonce = _element_version(element)
    return {**element, "version": version, "versionNonce": nonce}


def _create_drawing_room(
    *, account_owner=None, title: str, document: dict
) -> tuple[DrawingRoom, str, str, str]:
    validate_drawing_document(document, max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)
    edit_key = secrets.token_urlsafe(32)
    view_key = secrets.token_urlsafe(32)
    owner_key = secrets.token_urlsafe(32)
    room = DrawingRoom(
        account_owner=account_owner,
        title=clean_title(title),
        document=document,
        room_key_hash=_room_key_hash(edit_key),
        view_key_hash=_room_key_hash(view_key),
        owner_key_hash=_room_key_hash(owner_key),
    )
    room.save()
    record_drawing_room_event(room.id, "created")
    return room, edit_key, view_key, owner_key


def create_drawing_room(*, title: str, document: dict) -> tuple[DrawingRoom, str, str, str]:
    """Create an anonymous room managed only through its browser owner capability."""
    return _create_drawing_room(title=title, document=document)


def create_account_drawing_room(account_owner, *, title: str, document: dict):
    """Create a room bound to an account while retaining separate browser capabilities.

    The returned keys are for a trusted browser-facing adapter.  MCP must not expose them as
    credentials or use them in place of ``account_owner``.
    """
    return _create_drawing_room(account_owner=account_owner, title=title, document=document)


def list_account_drawing_rooms(account_owner):
    """Return rooms explicitly owned by ``account_owner``; anonymous rooms are never included."""
    return DrawingRoom.objects.filter(account_owner=account_owner)


def _lock_account_drawing_room(room_id, account_owner) -> DrawingRoom | None:
    return DrawingRoom.objects.select_for_update().filter(pk=room_id, account_owner=account_owner).first()


def close_account_drawing_room(room_id, account_owner) -> DrawingRoom | None:
    """Close a room through account identity, without accepting a browser owner key."""
    with transaction.atomic():
        room = _lock_account_drawing_room(room_id, account_owner)
        if room is None:
            return None
        if room.closed_at is None:
            room.closed_at = timezone.now()
            room.save(update_fields=["closed_at", "updated_at"])
            record_drawing_room_event(room.id, "closed")
    return room


def rename_account_drawing_room(room_id, account_owner, title: str) -> DrawingRoom | None:
    """Rename a live account-owned room without accepting a browser owner key."""
    with transaction.atomic():
        room = _lock_account_drawing_room(room_id, account_owner)
        if room is None or room.is_closed or room.is_expired:
            return None
        room.title = clean_title(title)
        room.save(update_fields=["title", "updated_at"])
        record_drawing_room_event(room.id, "renamed")
    return room


def rotate_account_drawing_room_keys(room_id, account_owner) -> tuple[DrawingRoom, str, str] | None:
    """Rotate browser edit/view capabilities using account identity.

    The account owner relation remains the management authority.  Callers must keep the returned
    keys inside a trusted browser adapter; they are not MCP credentials.
    """
    with transaction.atomic():
        room = _lock_account_drawing_room(room_id, account_owner)
        if room is None or room.is_closed or room.is_expired:
            return None
        edit_key = secrets.token_urlsafe(32)
        view_key = secrets.token_urlsafe(32)
        room.room_key_hash = _room_key_hash(edit_key)
        room.view_key_hash = _room_key_hash(view_key)
        room.save(update_fields=["room_key_hash", "view_key_hash", "updated_at"])
        record_drawing_room_event(room.id, "keys_rotated")
    return room, edit_key, view_key


def get_drawing_room(room_id, key: str | None) -> DrawingRoom | None:
    room = DrawingRoom.objects.filter(pk=room_id).first()
    return room if room is not None and _room_access(room, key) is not None else None


def get_drawing_room_access(room_id, key: str | None) -> tuple[DrawingRoom, str] | None:
    room = DrawingRoom.objects.filter(pk=room_id).first()
    if room is None:
        return None
    access = _room_access(room, key)
    return None if access is None else (room, access)


def rotate_drawing_room_keys(room_id, owner_key: str) -> tuple[DrawingRoom, str, str] | None:
    if not _valid_room_key(owner_key):
        return None
    with transaction.atomic():
        room = DrawingRoom.objects.select_for_update().filter(pk=room_id).first()
        if room is None or room.is_closed or room.is_expired or not room.owner_key_hash:
            return None
        if not secrets.compare_digest(room.owner_key_hash, _room_key_hash(owner_key)):
            return None
        edit_key = secrets.token_urlsafe(32)
        view_key = secrets.token_urlsafe(32)
        room.room_key_hash = _room_key_hash(edit_key)
        room.view_key_hash = _room_key_hash(view_key)
        room.save(update_fields=["room_key_hash", "view_key_hash", "updated_at"])
        record_drawing_room_event(room.id, "keys_rotated")
    return room, edit_key, view_key


def close_drawing_room(room_id, owner_key: str) -> DrawingRoom | None:
    if not _valid_room_key(owner_key):
        return None
    with transaction.atomic():
        room = DrawingRoom.objects.select_for_update().filter(pk=room_id).first()
        if room is None or not room.owner_key_hash:
            return None
        if not secrets.compare_digest(room.owner_key_hash, _room_key_hash(owner_key)):
            return None
        if room.closed_at is None:
            room.closed_at = timezone.now()
            room.save(update_fields=["closed_at", "updated_at"])
            record_drawing_room_event(room.id, "closed")
    return room


def rename_drawing_room(room_id, owner_key: str, title: str) -> DrawingRoom | None:
    if not _valid_room_key(owner_key):
        return None
    with transaction.atomic():
        room = DrawingRoom.objects.select_for_update().filter(pk=room_id).first()
        if room is None or room.is_closed or room.is_expired or not room.owner_key_hash:
            return None
        if not secrets.compare_digest(room.owner_key_hash, _room_key_hash(owner_key)):
            return None
        room.title = clean_title(title)
        room.save(update_fields=["title", "updated_at"])
        record_drawing_room_event(room.id, "renamed")
    return room


def moderate_close_drawing_room(room_id, *, actor_id: object | None = None) -> bool:
    with transaction.atomic():
        room = DrawingRoom.objects.select_for_update().filter(pk=room_id).first()
        if room is None or room.closed_at is not None:
            return False
        room.closed_at = timezone.now()
        room.save(update_fields=["closed_at", "updated_at"])
        record_drawing_room_event(
            room.id,
            "moderated_close",
            metadata={"actor_id": str(actor_id)} if actor_id is not None else None,
        )
    return True


def purge_expired_drawing_rooms() -> int:
    expired = DrawingRoom.objects.filter(expires_at__lte=timezone.now())
    count = expired.count()
    expired.delete()
    return count


def merge_drawing_documents(current: dict, incoming: dict) -> dict:
    """Merge element-level edits so two guests can draw at the same time.

    Elements are immutable snapshots identified by id.  The larger version wins; the nonce
    breaks ties when two clients edited the same element from the same base state.  Deleted
    elements remain as tombstones, so a stale client cannot resurrect them.
    """

    current_elements = {element["id"]: _normalise_element(element) for element in current["elements"]}
    incoming_elements = {element["id"]: _normalise_element(element) for element in incoming["elements"]}
    merged_elements = []
    for element in current["elements"]:
        element = current_elements[element["id"]]
        candidate = incoming_elements.get(element["id"])
        if candidate is None:
            merged_elements.append(element)
            continue
        current_version = _element_version(element)
        incoming_version = _element_version(candidate)
        merged_elements.append(candidate if incoming_version >= current_version else element)
    merged_elements.extend(
        incoming_elements[element["id"]]
        for element in incoming["elements"]
        if element["id"] not in current_elements
    )
    merged = {
        "schemaVersion": incoming["schemaVersion"],
        "elements": merged_elements,
        "background": incoming.get("background", current.get("background", "#ffffff")),
    }
    current_files = current.get("files") if isinstance(current.get("files"), dict) else {}
    incoming_files = incoming.get("files") if isinstance(incoming.get("files"), dict) else {}
    files = {**current_files, **incoming_files}
    if files:
        merged["files"] = files
    return validate_drawing_document(merged, max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)


def compute_drawing_delta(current: dict, incoming: dict) -> dict:
    current_by_id = {element["id"]: element for element in current.get("elements", [])}
    elements = [
        element for element in incoming.get("elements", []) if current_by_id.get(element["id"]) != element
    ]
    delta = {"schemaVersion": incoming["schemaVersion"], "elements": elements}
    if current.get("background") != incoming.get("background"):
        delta["background"] = incoming.get("background", "#ffffff")
    current_files = current.get("files") if isinstance(current.get("files"), dict) else {}
    incoming_files = incoming.get("files") if isinstance(incoming.get("files"), dict) else {}
    if current_files != incoming_files:
        delta["files"] = incoming_files
    return delta


def apply_drawing_delta(current: dict, delta: dict) -> dict:
    incoming = {
        "schemaVersion": delta["schemaVersion"],
        "elements": delta["elements"],
        "background": delta.get("background", current.get("background", "#ffffff")),
    }
    if "files" in delta:
        incoming["files"] = delta["files"]
    merged = merge_drawing_documents(current, incoming)
    if "files" in delta:
        if delta["files"]:
            merged["files"] = delta["files"]
        else:
            merged.pop("files", None)
    return validate_drawing_document(merged, max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)


def save_drawing_room_update(
    room_id,
    key: str,
    document: dict | None = None,
    *,
    delta: dict | None = None,
) -> DrawingRoomMutation | None:
    if not _valid_room_key(key):
        return None
    if (document is None) == (delta is None):
        raise ValueError("Provide exactly one drawing document or delta.")
    with transaction.atomic():
        room = DrawingRoom.objects.select_for_update().filter(pk=room_id).first()
        if room is None or _room_access(room, key) != "edit":
            return None
        if document is not None:
            validate_drawing_document(document, max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)
            merged = merge_drawing_documents(room.document, document)
        else:
            validate_drawing_delta(delta, max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)
            merged = apply_drawing_delta(room.document, delta)
        previous = room.document
        changed = merged != previous
        if changed:
            room.document = merged
            room.revision += 1
            room.save(update_fields=["document", "revision", "updated_at"])
            record_drawing_room_event(room.id, "updated", metadata={"revision": room.revision})
        return DrawingRoomMutation(
            room=room,
            document=room.document,
            revision=room.revision,
            delta=compute_drawing_delta(previous, room.document),
            changed=changed,
        )


def _check_drawing_limit(owner) -> None:
    get_user_model().objects.select_for_update().filter(pk=owner.pk).first()
    if Drawing.objects.filter(owner=owner, trashed_at__isnull=True).count() >= settings.MAX_DESIGNS_PER_USER:
        raise LimitReached(f"You can keep at most {settings.MAX_DESIGNS_PER_USER} whiteboards.")


def create_drawing(owner, *, title: str, document: dict) -> Drawing:
    validate_drawing_document(document, max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)
    with transaction.atomic():
        _check_drawing_limit(owner)
        drawing = Drawing(
            owner=owner,
            title=clean_title(title),
            document=document,
        )
        drawing.save()
    return drawing


def _lock(drawing_id, owner) -> Drawing:
    try:
        drawing = Drawing.objects.select_for_update().get(pk=drawing_id, owner=owner)
    except Drawing.DoesNotExist as exc:
        raise Http404 from exc
    if drawing.trashed_at is not None:
        raise Http404
    return drawing


def update_drawing(drawing_id, owner, data: dict) -> Drawing:
    with transaction.atomic():
        drawing = _lock(drawing_id, owner)
        touched: set[str] = set()
        delta = None
        if "title" in data:
            drawing.title = clean_title(data["title"])
            touched.update(("title", "updated_at"))
        if "document" in data:
            if drawing.revision != data["base_revision"]:
                raise RevisionConflict(drawing.revision, drawing.updated_at)
            validate_drawing_document(data["document"], max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)
            previous = drawing.document
            drawing.document = data["document"]
            drawing.revision += 1
            delta = compute_drawing_delta(previous, drawing.document)
            touched.update(("document", "revision", "updated_at"))
        if touched:
            drawing.save(update_fields=sorted(touched))
            if "document" in data:
                transaction.on_commit(
                    partial(
                        publish_drawing_update,
                        drawing.pk,
                        drawing.document,
                        drawing.revision,
                        delta=delta,
                    )
                )
    return drawing


def trash_drawing(drawing_id, owner) -> None:
    Drawing.objects.filter(pk=drawing_id, owner=owner, trashed_at__isnull=True).update(
        trashed_at=timezone.now()
    )


def set_thumbnail(drawing: Drawing, uploaded) -> Drawing:
    if drawing.trashed_at is not None:
        raise Http404
    if uploaded.size is not None and uploaded.size > THUMBNAIL_MAX_BYTES:
        raise FileTooLarge("The thumbnail is larger than 2 MB.")
    data = uploaded.read(THUMBNAIL_MAX_BYTES + 1)
    if len(data) > THUMBNAIL_MAX_BYTES:
        raise FileTooLarge("The thumbnail is larger than 2 MB.")
    try:
        processed = process_image_upload(
            BytesIO(data), max_bytes=THUMBNAIL_MAX_BYTES, max_pixels=THUMBNAIL_MAX_PIXELS
        )
        webp = make_thumbnail(processed.data, THUMBNAIL_SIDE)
    except ImageError as exc:
        raise InvalidFile(str(exc)) from exc
    with transaction.atomic():
        previous = drawing.thumbnail.name
        drawing.thumbnail.save(f"{drawing.id}.webp", ContentFile(webp), save=False)
        drawing.save(update_fields=["thumbnail"])
        if previous:
            delete_files_on_commit(drawing.thumbnail.storage, [previous])
    return drawing
