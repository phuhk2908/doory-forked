from __future__ import annotations

import hashlib
import logging
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta
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
from .models import Drawing, DrawingRoom, DrawingRoomCollaborator, DrawingRoomEvent
from .moderation import score_drawing_document
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
    actor=None,
    client_ip: str | None = None,
    spam_score: int = 0,
    metadata: Mapping[str, object] | None = None,
) -> None:
    """Keep a room audit trail without retaining keys, documents or raw client addresses."""
    try:
        with transaction.atomic():
            DrawingRoomEvent.objects.create(
                room_id=room_id,
                room_identifier=room_id,
                actor_id=(
                    actor.pk
                    if getattr(actor, "is_authenticated", False) and getattr(actor, "pk", None) is not None
                    else None
                ),
                kind=kind[:40],
                client_ip_hash=(hashlib.sha256(client_ip.encode("utf-8")).hexdigest() if client_ip else ""),
                spam_score=max(0, min(100, int(spam_score))),
                metadata=dict(metadata or {}),
            )
    except (DatabaseError, TypeError, ValueError):
        log.warning("could not record drawing room event room=%s kind=%s", room_id, kind, exc_info=True)


def _room_access(room: DrawingRoom, key: str | None) -> str | None:
    if not _valid_room_key(key) or room.is_closed or room.is_expired:
        return None
    digest = _room_key_hash(key)
    if secrets.compare_digest(room.room_key_hash, digest):
        return room.link_mode
    # Legacy view links remain readable until their room's share key is rotated.
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


def _order_version(document: dict) -> tuple[int, int]:
    version = document.get("orderVersion")
    nonce = document.get("orderVersionNonce")
    return (
        version if isinstance(version, int) and not isinstance(version, bool) else 0,
        nonce if isinstance(nonce, int) and not isinstance(nonce, bool) else 0,
    )


def _complete_order(order: object, elements: list[dict]) -> list[str]:
    element_ids = {element["id"] for element in elements}
    seen: set[str] = set()
    complete: list[str] = []
    if isinstance(order, list):
        for element_id in order:
            if not isinstance(element_id, str) or element_id not in element_ids or element_id in seen:
                continue
            seen.add(element_id)
            complete.append(element_id)
    for element in elements:
        element_id = element["id"]
        if element_id in seen:
            continue
        seen.add(element_id)
        complete.append(element_id)
    return complete


def _order_elements(order: list[str], elements: list[dict]) -> list[dict]:
    by_id = {element["id"]: element for element in elements}
    ordered = [by_id[element_id] for element_id in order if element_id in by_id]
    seen = {element["id"] for element in ordered}
    ordered.extend(element for element in elements if element["id"] not in seen)
    return ordered


def _create_drawing_room(*, account_owner=None, title: str, document: dict) -> tuple[DrawingRoom, str, str]:
    validate_drawing_document(document, max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)
    spam_score, spam_reasons = score_drawing_document(document)
    room_key = secrets.token_urlsafe(32)
    owner_key = secrets.token_urlsafe(32)
    room = DrawingRoom(
        account_owner=account_owner,
        title=clean_title(title),
        document=document,
        room_key_hash=_room_key_hash(room_key),
        owner_key_hash=_room_key_hash(owner_key),
        spam_score=spam_score,
        spam_flagged_at=(
            timezone.now() if spam_score >= settings.DRAWING_ROOM_SPAM_SCORE_THRESHOLD else None
        ),
    )
    room.save()
    record_drawing_room_event(room.id, "created", actor=account_owner)
    if room.spam_flagged_at is not None:
        record_drawing_room_event(
            room.id,
            "spam_flagged",
            actor=account_owner,
            spam_score=spam_score,
            metadata={"revision": room.revision, "reasons": list(spam_reasons)},
        )
    return room, room_key, owner_key


def create_drawing_room(*, title: str, document: dict) -> tuple[DrawingRoom, str, str]:
    """Create an anonymous room managed only through its browser owner capability."""
    return _create_drawing_room(title=title, document=document)


def create_account_drawing_room(account_owner, *, title: str, document: dict):
    """Create a room bound to an account while retaining separate browser capabilities.

    The returned share and owner keys are for a trusted browser-facing adapter. MCP must not expose
    them as credentials or use them in place of ``account_owner``.
    """
    return _create_drawing_room(account_owner=account_owner, title=title, document=document)


def list_account_drawing_rooms(account_owner):
    """Return rooms explicitly owned by ``account_owner``; anonymous rooms are never included."""
    return DrawingRoom.objects.filter(account_owner=account_owner)


def list_drawing_room_collaborators(room_id, account_owner):
    room = DrawingRoom.objects.filter(pk=room_id, account_owner=account_owner).first()
    if room is None:
        return None
    return DrawingRoomCollaborator.objects.filter(room=room).select_related("user")


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
            record_drawing_room_event(room.id, "closed", actor=account_owner)
    return room


def rename_account_drawing_room(room_id, account_owner, title: str) -> DrawingRoom | None:
    """Rename a live account-owned room without accepting a browser owner key."""
    with transaction.atomic():
        room = _lock_account_drawing_room(room_id, account_owner)
        if room is None or room.is_closed or room.is_expired:
            return None
        room.title = clean_title(title)
        room.save(update_fields=["title", "updated_at"])
        record_drawing_room_event(room.id, "renamed", actor=account_owner)
    return room


def rotate_account_drawing_room_keys(room_id, account_owner) -> tuple[DrawingRoom, str] | None:
    """Rotate the browser share capability using account identity.

    The account owner relation remains the management authority.  Callers must keep the returned
    keys inside a trusted browser adapter; they are not MCP credentials.
    """
    with transaction.atomic():
        room = _lock_account_drawing_room(room_id, account_owner)
        if room is None or room.is_closed or room.is_expired:
            return None
        room_key = secrets.token_urlsafe(32)
        room.room_key_hash = _room_key_hash(room_key)
        room.view_key_hash = ""
        room.save(update_fields=["room_key_hash", "view_key_hash", "updated_at"])
        record_drawing_room_event(room.id, "keys_rotated", actor=account_owner)
    return room, room_key


def add_drawing_room_collaborator(room_id, account_owner, email: str, role: str):
    with transaction.atomic():
        room = _lock_account_drawing_room(room_id, account_owner)
        if room is None or room.is_closed or room.is_expired:
            return None
        user = get_user_model().objects.filter(email__iexact=email.strip(), is_active=True).first()
        if user is None or user.pk == account_owner.pk:
            return False
        collaborator, created = DrawingRoomCollaborator.objects.get_or_create(
            room=room,
            user=user,
            defaults={"role": role, "invited_by": account_owner},
        )
        if not created and collaborator.role != role:
            collaborator.role = role
            collaborator.invited_by = account_owner
            collaborator.save(update_fields=["role", "invited_by", "updated_at"])
            kind = "collaborator_role_changed"
        else:
            kind = "collaborator_added" if created else None
        if kind:
            record_drawing_room_event(
                room.id,
                kind,
                actor=account_owner,
                metadata={"user_id": str(user.pk), "role": role},
            )
    return collaborator


def update_drawing_room_collaborator(room_id, account_owner, user_id, role: str):
    with transaction.atomic():
        room = _lock_account_drawing_room(room_id, account_owner)
        if room is None or room.is_closed or room.is_expired:
            return None
        collaborator = (
            DrawingRoomCollaborator.objects.select_for_update()
            .filter(room=room, user_id=user_id)
            .select_related("user")
            .first()
        )
        if collaborator is None:
            return False
        if collaborator.role != role:
            collaborator.role = role
            collaborator.save(update_fields=["role", "updated_at"])
            record_drawing_room_event(
                room.id,
                "collaborator_role_changed",
                actor=account_owner,
                metadata={"user_id": str(collaborator.user_id), "role": role},
            )
    return collaborator


def remove_drawing_room_collaborator(room_id, account_owner, user_id) -> bool | None:
    with transaction.atomic():
        room = _lock_account_drawing_room(room_id, account_owner)
        if room is None or room.is_closed or room.is_expired:
            return None
        collaborator = DrawingRoomCollaborator.objects.filter(room=room, user_id=user_id).first()
        if collaborator is None:
            return False
        collaborator.delete()
        record_drawing_room_event(
            room.id,
            "collaborator_removed",
            actor=account_owner,
            metadata={"user_id": str(user_id)},
        )
    return True


def transfer_drawing_room_ownership(room_id, account_owner, email: str):
    with transaction.atomic():
        room = _lock_account_drawing_room(room_id, account_owner)
        if room is None or room.is_closed or room.is_expired:
            return None
        target = get_user_model().objects.filter(email__iexact=email.strip(), is_active=True).first()
        if target is None:
            return False
        if target.pk == account_owner.pk:
            return room
        DrawingRoomCollaborator.objects.update_or_create(
            room=room,
            user=account_owner,
            defaults={"role": DrawingRoomCollaborator.Role.EDIT, "invited_by": account_owner},
        )
        DrawingRoomCollaborator.objects.update_or_create(
            room=room,
            user=target,
            defaults={"role": DrawingRoomCollaborator.Role.EDIT, "invited_by": account_owner},
        )
        room.account_owner = target
        room.owner_key_hash = ""
        room.save(update_fields=["account_owner", "owner_key_hash", "updated_at"])
        record_drawing_room_event(
            room.id,
            "ownership_transferred",
            actor=account_owner,
            metadata={"from_user_id": str(account_owner.pk), "to_user_id": str(target.pk)},
        )
    return room


def drawing_room_member_profile(room_id, user):
    if not getattr(user, "is_authenticated", False):
        return None
    room = DrawingRoom.objects.filter(pk=room_id).only("account_owner_id").first()
    if room is None:
        return None
    role = "owner" if room.account_owner_id == user.pk else None
    if role is None:
        role = (
            DrawingRoomCollaborator.objects.filter(room_id=room_id, user_id=user.pk)
            .values_list("role", flat=True)
            .first()
        )
    if role is None:
        return None
    return {
        "user_id": str(user.pk),
        "name": user.name,
        "avatar_url": user.avatar.url if user.avatar else None,
        "role": role,
    }


def get_drawing_room(room_id, key: str | None) -> DrawingRoom | None:
    room = DrawingRoom.objects.filter(pk=room_id).first()
    return room if room is not None and _room_access(room, key) is not None else None


def get_drawing_room_access(room_id, key: str | None) -> tuple[DrawingRoom, str] | None:
    room = DrawingRoom.objects.filter(pk=room_id).first()
    if room is None:
        return None
    access = _room_access(room, key)
    return None if access is None else (room, access)


def rotate_drawing_room_keys(room_id, owner_key: str) -> tuple[DrawingRoom, str] | None:
    if not _valid_room_key(owner_key):
        return None
    with transaction.atomic():
        room = DrawingRoom.objects.select_for_update().filter(pk=room_id).first()
        if room is None or room.is_closed or room.is_expired or not room.owner_key_hash:
            return None
        if not secrets.compare_digest(room.owner_key_hash, _room_key_hash(owner_key)):
            return None
        room_key = secrets.token_urlsafe(32)
        room.room_key_hash = _room_key_hash(room_key)
        room.view_key_hash = ""
        room.save(update_fields=["room_key_hash", "view_key_hash", "updated_at"])
        record_drawing_room_event(room.id, "keys_rotated")
    return room, room_key


def set_drawing_room_access(room_id, owner_key: str, mode: str) -> DrawingRoom | None:
    """Change the permission attached to the room's single share capability."""
    if not _valid_room_key(owner_key) or mode not in DrawingRoom.LinkMode.values:
        return None
    with transaction.atomic():
        room = DrawingRoom.objects.select_for_update().filter(pk=room_id).first()
        if room is None or room.is_closed or room.is_expired or not room.owner_key_hash:
            return None
        if not secrets.compare_digest(room.owner_key_hash, _room_key_hash(owner_key)):
            return None
        if room.link_mode != mode:
            room.link_mode = mode
            room.save(update_fields=["link_mode", "updated_at"])
            record_drawing_room_event(room.id, "link_access_changed", metadata={"mode": mode})
    return room


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


def moderate_close_drawing_room(room_id, *, actor_id: object | None = None, actor=None) -> bool:
    with transaction.atomic():
        room = DrawingRoom.objects.select_for_update().filter(pk=room_id).first()
        if room is None or room.closed_at is not None:
            return False
        room.closed_at = timezone.now()
        room.save(update_fields=["closed_at", "updated_at"])
        record_drawing_room_event(
            room.id,
            "moderated_close",
            actor=actor,
            metadata={"actor_id": str(actor_id)} if actor_id is not None else None,
        )
    return True


def purge_expired_drawing_rooms() -> int:
    expired = DrawingRoom.objects.filter(expires_at__lte=timezone.now())
    count = expired.count()
    expired.delete()
    return count


def purge_expired_drawing_room_events(*, now=None) -> int:
    now = now or timezone.now()
    cutoff = now - timedelta(days=settings.DRAWING_ROOM_AUDIT_RETENTION_DAYS)
    deleted, _ = DrawingRoomEvent.objects.filter(created_at__lt=cutoff).delete()
    return deleted


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
    current_has_order = isinstance(current.get("order"), list)
    incoming_has_order = isinstance(incoming.get("order"), list)
    if incoming_has_order and (not current_has_order or _order_version(incoming) >= _order_version(current)):
        order_document = incoming
    elif current_has_order:
        order_document = current
    else:
        order_document = None
    order = _complete_order(order_document.get("order"), merged_elements) if order_document else None
    merged = {
        "schemaVersion": incoming["schemaVersion"],
        "elements": _order_elements(order, merged_elements) if order is not None else merged_elements,
        "background": incoming.get("background", current.get("background", "#ffffff")),
    }
    if order is not None and order_document is not None:
        merged["order"] = order
        merged["orderVersion"], merged["orderVersionNonce"] = _order_version(order_document)
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
    current_order = _complete_order(current.get("order"), current.get("elements", []))
    incoming_order = _complete_order(incoming.get("order"), incoming.get("elements", []))
    if current_order != incoming_order:
        delta["order"] = incoming_order
        incoming_order_version = _order_version(incoming)
        current_order_version = _order_version(current)
        delta["orderVersion"], delta["orderVersionNonce"] = (
            incoming_order_version if "order" in incoming else current_order_version
        )
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
    if "order" in delta and isinstance(delta["order"], list):
        incoming_order_version = _order_version(delta)
        if "order" not in current or incoming_order_version >= _order_version(current):
            order = _complete_order(delta["order"], merged["elements"])
            merged["elements"] = _order_elements(order, merged["elements"])
            merged["order"] = order
            merged["orderVersion"], merged["orderVersionNonce"] = incoming_order_version
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
    actor=None,
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
            spam_score, spam_reasons = score_drawing_document(merged)
            newly_flagged = (
                spam_score >= settings.DRAWING_ROOM_SPAM_SCORE_THRESHOLD and room.spam_flagged_at is None
            )
            room.document = merged
            room.revision += 1
            room.spam_score = spam_score
            update_fields = ["document", "revision", "spam_score", "updated_at"]
            if newly_flagged:
                room.spam_flagged_at = timezone.now()
                update_fields.append("spam_flagged_at")
            room.save(update_fields=update_fields)
            metadata = {
                "revision": room.revision,
                "element_count": len(merged.get("elements", [])),
                "spam_reasons": list(spam_reasons),
            }
            record_drawing_room_event(
                room.id,
                "updated",
                actor=actor,
                spam_score=spam_score,
                metadata=metadata,
            )
            if newly_flagged:
                record_drawing_room_event(
                    room.id,
                    "spam_flagged",
                    actor=actor,
                    spam_score=spam_score,
                    metadata={"revision": room.revision, "reasons": list(spam_reasons)},
                )
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
