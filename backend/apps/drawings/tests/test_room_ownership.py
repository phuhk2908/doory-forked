from apps.accounts.models import User
from apps.drawings import services
from apps.drawings.models import DrawingRoom


def drawing_document():
    return {"schemaVersion": 1, "elements": [], "background": "#ffffff"}


def test_account_owned_room_uses_user_identity_for_management(db):
    owner = User.objects.create_user("owner@example.com", "password-123456")
    stranger = User.objects.create_user("stranger@example.com", "password-123456")
    room, edit_key, view_key, _owner_key = services.create_account_drawing_room(
        owner,
        title="Account room",
        document=drawing_document(),
    )

    assert room.account_owner_id == owner.pk
    assert list(services.list_account_drawing_rooms(owner)) == [room]
    assert not services.list_account_drawing_rooms(stranger).exists()
    assert services.get_drawing_room(room.pk, edit_key) is not None
    assert services.get_drawing_room(room.pk, view_key) is not None

    assert services.rename_account_drawing_room(room.pk, stranger, "No access") is None
    renamed = services.rename_account_drawing_room(room.pk, owner, "Renamed")
    assert renamed is not None and renamed.title == "Renamed"

    rotated = services.rotate_account_drawing_room_keys(room.pk, stranger)
    assert rotated is None
    rotated = services.rotate_account_drawing_room_keys(room.pk, owner)
    assert rotated is not None
    rotated_room, new_edit_key, new_view_key = rotated
    assert services.get_drawing_room(room.pk, edit_key) is None
    assert services.get_drawing_room(room.pk, view_key) is None
    assert services.get_drawing_room(rotated_room.pk, new_edit_key) is not None
    assert services.get_drawing_room(rotated_room.pk, new_view_key) is not None

    assert services.close_account_drawing_room(room.pk, stranger) is None
    closed = services.close_account_drawing_room(room.pk, owner)
    assert closed is not None and closed.closed_at is not None


def test_existing_guest_room_has_no_account_owner(db):
    room, _edit_key, _view_key, _owner_key = services.create_drawing_room(
        title="Guest room",
        document=drawing_document(),
    )

    room.refresh_from_db()
    assert room.account_owner_id is None
    assert not DrawingRoom.objects.filter(account_owner__isnull=False, pk=room.pk).exists()


def test_deleting_account_unbinds_room_without_removing_guest_access(db):
    owner = User.objects.create_user("owner@example.com", "password-123456")
    room, edit_key, _view_key, _owner_key = services.create_account_drawing_room(
        owner,
        title="Account room",
        document=drawing_document(),
    )

    owner.delete()

    room.refresh_from_db()
    assert room.account_owner_id is None
    assert services.get_drawing_room(room.pk, edit_key) is not None
