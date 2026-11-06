from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.drawings import services
from apps.drawings.models import DrawingRoom


def drawing_document():
    return {"schemaVersion": 1, "elements": [], "background": "#ffffff"}


def test_owner_can_create_update_with_revision_and_list(db):
    user = User.objects.create_user("ada@example.com", "password-123456")
    client = APIClient()
    client.force_authenticate(user=user)

    created = client.post(
        "/api/v1/drawings/",
        {"title": "  Workshop board  ", "document": drawing_document()},
        format="json",
    )
    assert created.status_code == 201
    assert created.data["title"] == "Workshop board"
    drawing_id = created.data["id"]

    updated_document = {
        **drawing_document(),
        "elements": [
            {
                "id": "shape-1",
                "type": "rectangle",
                "x": 10,
                "y": 20,
                "width": 80,
                "height": 40,
                "angle": 0,
                "style": {"stroke": "#000000"},
            }
        ],
    }
    updated = client.patch(
        f"/api/v1/drawings/{drawing_id}/",
        {"document": updated_document, "base_revision": 1},
        format="json",
    )
    assert updated.status_code == 200
    assert updated.data["revision"] == 2

    conflict = client.patch(
        f"/api/v1/drawings/{drawing_id}/",
        {"document": drawing_document(), "base_revision": 1},
        format="json",
    )
    assert conflict.status_code == 409
    assert conflict.data["current"]["revision"] == 2

    listed = client.get("/api/v1/drawings/")
    assert listed.status_code == 200
    assert listed.data["count"] == 1
    assert listed.data["results"][0]["id"] == drawing_id


def test_drawings_are_private_and_invalid_documents_are_rejected(db):
    owner = User.objects.create_user("owner@example.com", "password-123456")
    stranger = User.objects.create_user("stranger@example.com", "password-123456")
    owner_client = APIClient()
    owner_client.force_authenticate(user=owner)
    response = owner_client.post(
        "/api/v1/drawings/",
        {"document": drawing_document()},
        format="json",
    )
    drawing_id = response.data["id"]

    stranger_client = APIClient()
    stranger_client.force_authenticate(user=stranger)
    assert stranger_client.get(f"/api/v1/drawings/{drawing_id}/").status_code == 404

    invalid = owner_client.post(
        "/api/v1/drawings/",
        {"document": {"schemaVersion": 1, "elements": [{"type": "script"}]}},
        format="json",
    )
    assert invalid.status_code == 400


def test_guest_room_uses_the_fragment_key_as_access_control(db):
    client = APIClient()
    created = client.post(
        "/api/v1/drawing-rooms/",
        {"title": "Planning room", "document": drawing_document()},
        format="json",
    )
    assert created.status_code == 201
    room_id = created.data["id"]
    key = created.data["key"]
    assert len(key) >= 32
    assert created.data["view_key"] != key
    assert created.data["owner_key"] != key

    assert client.get(f"/api/v1/drawing-rooms/{room_id}/").status_code == 404
    opened = client.get(
        f"/api/v1/drawing-rooms/{room_id}/",
        HTTP_X_DRAWING_ROOM_KEY=key,
    )
    assert opened.status_code == 200
    assert opened.data["title"] == "Planning room"
    assert opened.data["mode"] == "edit"
    assert "key" not in opened.data
    view = client.get(
        f"/api/v1/drawing-rooms/{room_id}/",
        HTTP_X_DRAWING_ROOM_KEY=created.data["view_key"],
    )
    assert view.status_code == 200
    assert view.data["mode"] == "view"


def test_guest_room_merges_independent_element_versions(db):
    room, key, view_key, _ = services.create_drawing_room(title="Room", document=drawing_document())
    first = {
        **drawing_document(),
        "elements": [
            {
                "id": "one",
                "type": "rectangle",
                "x": 0,
                "y": 0,
                "width": 10,
                "height": 10,
                "angle": 0,
                "style": {},
                "version": 1,
                "versionNonce": 1,
            }
        ],
    }
    second = {
        **drawing_document(),
        "elements": [
            {
                "id": "two",
                "type": "ellipse",
                "x": 20,
                "y": 20,
                "width": 10,
                "height": 10,
                "angle": 0,
                "style": {},
                "version": 1,
                "versionNonce": 2,
            }
        ],
    }
    assert services.save_drawing_room_update(room.id, view_key, first) is None
    services.save_drawing_room_update(room.id, key, first)
    services.save_drawing_room_update(room.id, key, second)

    merged = DrawingRoom.objects.get(pk=room.pk)
    assert merged.revision == 3
    assert {element["id"] for element in merged.document["elements"]} == {"one", "two"}


def test_guest_room_expiry_blocks_access_and_is_cleaned_up(db):
    room, key, _, _ = services.create_drawing_room(title="Room", document=drawing_document())
    room.expires_at = timezone.now() - timedelta(minutes=1)
    room.save(update_fields=["expires_at"])

    assert services.get_drawing_room(room.id, key) is None
    assert services.purge_expired_drawing_rooms() == 1
    assert not DrawingRoom.objects.filter(pk=room.pk).exists()


def test_guest_room_owner_can_rotate_and_close_links(db):
    client = APIClient()
    created = client.post("/api/v1/drawing-rooms/", {"document": drawing_document()}, format="json")
    room_id = created.data["id"]
    old_edit = created.data["key"]
    owner_key = created.data["owner_key"]

    renamed = client.post(
        f"/api/v1/drawing-rooms/{room_id}/manage/",
        {"action": "rename", "title": "  New room name  "},
        format="json",
        HTTP_X_DRAWING_ROOM_OWNER_KEY=owner_key,
    )
    assert renamed.status_code == 200
    assert renamed.data["title"] == "New room name"

    rotated = client.post(
        f"/api/v1/drawing-rooms/{room_id}/manage/",
        {"action": "rotate"},
        format="json",
        HTTP_X_DRAWING_ROOM_OWNER_KEY=owner_key,
    )
    assert rotated.status_code == 200
    assert rotated.data["key"] != old_edit
    assert (
        client.get(f"/api/v1/drawing-rooms/{room_id}/", HTTP_X_DRAWING_ROOM_KEY=old_edit).status_code == 404
    )
    assert (
        client.get(
            f"/api/v1/drawing-rooms/{room_id}/", HTTP_X_DRAWING_ROOM_KEY=rotated.data["key"]
        ).status_code
        == 200
    )

    closed = client.post(
        f"/api/v1/drawing-rooms/{room_id}/manage/",
        {"action": "close"},
        format="json",
        HTTP_X_DRAWING_ROOM_OWNER_KEY=owner_key,
    )
    assert closed.status_code == 200
    assert closed.data["closed_at"] is not None
    assert (
        client.get(
            f"/api/v1/drawing-rooms/{room_id}/", HTTP_X_DRAWING_ROOM_KEY=rotated.data["key"]
        ).status_code
        == 404
    )
