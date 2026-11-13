from apps.accounts.models import User
from apps.drawings import services
from apps.drawings.models import DrawingRoom


def drawing_document():
    return {"schemaVersion": 1, "elements": [], "background": "#ffffff"}


def test_account_owned_room_uses_user_identity_for_management(db):
    owner = User.objects.create_user("owner@example.com", "password-123456")
    stranger = User.objects.create_user("stranger@example.com", "password-123456")
    room, room_key, owner_key = services.create_account_drawing_room(
        owner,
        title="Account room",
        document=drawing_document(),
    )

    assert room.account_owner_id == owner.pk
    assert list(services.list_account_drawing_rooms(owner)) == [room]
    assert not services.list_account_drawing_rooms(stranger).exists()
    assert services.get_drawing_room(room.pk, room_key) is not None
    assert services.get_drawing_room_access(room.pk, room_key)[1] == "edit"

    assert services.rename_account_drawing_room(room.pk, stranger, "No access") is None
    renamed = services.rename_account_drawing_room(room.pk, owner, "Renamed")
    assert renamed is not None and renamed.title == "Renamed"

    changed = services.set_drawing_room_access(room.pk, owner_key, "view")
    assert changed is not None
    assert services.get_drawing_room_access(room.pk, room_key)[1] == "view"
    changed = services.set_drawing_room_access(room.pk, owner_key, "edit")
    assert changed is not None

    rotated = services.rotate_account_drawing_room_keys(room.pk, stranger)
    assert rotated is None
    rotated = services.rotate_account_drawing_room_keys(room.pk, owner)
    assert rotated is not None
    rotated_room, new_room_key = rotated
    assert services.get_drawing_room(room.pk, room_key) is None
    assert services.get_drawing_room(rotated_room.pk, new_room_key) is not None

    assert services.close_account_drawing_room(room.pk, stranger) is None
    closed = services.close_account_drawing_room(room.pk, owner)
    assert closed is not None and closed.closed_at is not None


def test_existing_guest_room_has_no_account_owner(db):
    room, _room_key, _owner_key = services.create_drawing_room(
        title="Guest room",
        document=drawing_document(),
    )

    room.refresh_from_db()
    assert room.account_owner_id is None
    assert not DrawingRoom.objects.filter(account_owner__isnull=False, pk=room.pk).exists()


def test_deleting_account_unbinds_room_without_removing_guest_access(db):
    owner = User.objects.create_user("owner@example.com", "password-123456")
    room, room_key, _owner_key = services.create_account_drawing_room(
        owner,
        title="Account room",
        document=drawing_document(),
    )

    owner.delete()

    room.refresh_from_db()
    assert room.account_owner_id is None
    assert services.get_drawing_room(room.pk, room_key) is not None


def test_named_collaborators_are_account_scoped_and_visible_in_presence(db):
    owner = User.objects.create_user("owner@example.com", "password-123456", display_name="Owner")
    collaborator = User.objects.create_user(
        "COLLABORATOR@example.com", "password-123456", display_name="Teammate"
    )
    stranger = User.objects.create_user("stranger@example.com", "password-123456")
    room, _room_key, _owner_key = services.create_account_drawing_room(
        owner,
        title="Account room",
        document=drawing_document(),
    )

    added = services.add_drawing_room_collaborator(room.pk, owner, "collaborator@example.com", "view")
    assert added is not None and added.user_id == collaborator.pk and added.role == "view"
    assert services.add_drawing_room_collaborator(room.pk, owner, owner.email, "edit") is False
    assert services.list_drawing_room_collaborators(room.pk, stranger) is None
    assert services.drawing_room_member_profile(room.pk, collaborator) == {
        "user_id": str(collaborator.pk),
        "name": "Teammate",
        "avatar_url": None,
        "role": "view",
    }

    updated = services.update_drawing_room_collaborator(room.pk, owner, collaborator.pk, "edit")
    assert updated is not None and updated.role == "edit"
    assert services.remove_drawing_room_collaborator(room.pk, owner, collaborator.pk)
    assert services.drawing_room_member_profile(room.pk, collaborator) is None


def test_transfer_moves_account_ownership_and_revokes_old_owner_capability(db):
    owner = User.objects.create_user("owner@example.com", "password-123456")
    target = User.objects.create_user("target@example.com", "password-123456")
    room, _room_key, owner_key = services.create_account_drawing_room(
        owner,
        title="Account room",
        document=drawing_document(),
    )

    transferred = services.transfer_drawing_room_ownership(room.pk, owner, "TARGET@example.com")

    assert transferred is not None and transferred.account_owner_id == target.pk
    assert services.close_drawing_room(room.pk, owner_key) is None
    assert services.drawing_room_member_profile(room.pk, owner)["role"] == "edit"
    assert services.drawing_room_member_profile(room.pk, target)["role"] == "owner"
    assert services.list_drawing_room_collaborators(room.pk, owner) is None
    assert services.list_drawing_room_collaborators(room.pk, target).count() == 2
