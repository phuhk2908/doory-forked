import hashlib
from datetime import timedelta

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
