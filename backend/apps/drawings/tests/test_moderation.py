import hashlib
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from apps.drawings import services
from apps.drawings.models import DrawingRoomEvent


def drawing_document():
    return {"schemaVersion": 1, "elements": [], "background": "#ffffff"}


def test_room_audit_records_lifecycle_without_keys_or_documents(db):
    room, edit_key, _view_key, owner_key = services.create_drawing_room(
        title="Room", document=drawing_document()
    )
    services.record_drawing_room_event(room.id, "joined", client_ip="198.51.100.10")
    services.save_drawing_room_update(room.id, edit_key, {**drawing_document(), "elements": []})
    services.rename_drawing_room(room.id, owner_key, "Renamed")
    services.rotate_drawing_room_keys(room.id, owner_key)
    services.close_drawing_room(room.id, owner_key)

    events = list(DrawingRoomEvent.objects.filter(room=room).order_by("created_at"))
    assert {event.kind for event in events} == {
        "created",
        "joined",
        "renamed",
        "keys_rotated",
        "closed",
    }
    joined = next(event for event in events if event.kind == "joined")
    assert joined.client_ip_hash == hashlib.sha256(b"198.51.100.10").hexdigest()
    assert all(edit_key not in str(event.metadata) for event in events)


def test_staff_can_close_a_room_and_the_action_is_audited(db):
    room, _edit_key, _view_key, _owner_key = services.create_drawing_room(
        title="Room", document=drawing_document()
    )

    assert services.moderate_close_drawing_room(room.id, actor_id="staff-id")
    assert not services.moderate_close_drawing_room(room.id, actor_id="staff-id")

    event = DrawingRoomEvent.objects.get(room=room, kind="moderated_close")
    assert event.metadata == {"actor_id": "staff-id"}


def test_expired_room_cleanup_keeps_its_audit_events(db):
    room, _edit_key, _view_key, _owner_key = services.create_drawing_room(
        title="Room", document=drawing_document()
    )
    room.expires_at = timezone.now() - timedelta(minutes=1)
    room.save(update_fields=["expires_at"])

    assert services.purge_expired_drawing_rooms() == 1
    event = DrawingRoomEvent.objects.get(room_identifier=room.id, kind="created")
    assert event.room_id is None


def spam_document():
    return {
        "schemaVersion": 1,
        "elements": [
            {
                "id": "spam-text",
                "type": "text",
                "x": 0,
                "y": 0,
                "width": 100,
                "height": 20,
                "angle": 0,
                "style": {},
                "text": "https://one.example https://two.example https://three.example",
            }
        ],
        "background": "#ffffff",
    }


def test_content_score_flags_initial_and_updated_room_documents(db):
    with override_settings(DRAWING_ROOM_SPAM_SCORE_THRESHOLD=12):
        room, edit_key, _view_key, _owner_key = services.create_drawing_room(
            title="Room", document=spam_document()
        )

    room.refresh_from_db()
    assert room.spam_score == 15
    assert room.spam_flagged_at is not None
    event = DrawingRoomEvent.objects.get(room=room, kind="spam_flagged")
    assert event.spam_score == 15
    assert event.metadata == {"revision": 1, "reasons": ["many_links"]}
    assert "one.example" not in str(event.metadata)

    with override_settings(DRAWING_ROOM_SPAM_SCORE_THRESHOLD=12):
        mutation = services.save_drawing_room_update(
            room.pk,
            edit_key,
            {"schemaVersion": 1, "elements": [], "background": "#ffffff"},
        )
    assert mutation is not None and mutation.changed
    assert DrawingRoomEvent.objects.filter(room=room, kind="spam_flagged").count() == 1


def test_room_audit_retention_removes_only_old_events(db):
    room, _edit_key, _view_key, _owner_key = services.create_drawing_room(
        title="Room", document=drawing_document()
    )
    old_event = DrawingRoomEvent.objects.create(room=room, room_identifier=room.id, kind="old")
    fresh_event = DrawingRoomEvent.objects.create(room=room, room_identifier=room.id, kind="fresh")
    old_time = timezone.now() - timedelta(days=8)
    DrawingRoomEvent.objects.filter(pk=old_event.pk).update(created_at=old_time)

    with override_settings(DRAWING_ROOM_AUDIT_RETENTION_DAYS=7):
        assert services.purge_expired_drawing_room_events(now=timezone.now()) == 1

    assert not DrawingRoomEvent.objects.filter(pk=old_event.pk).exists()
    assert DrawingRoomEvent.objects.filter(pk=fresh_event.pk).exists()
