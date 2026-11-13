"""Account-owned whiteboard MCP tools use the drawing service and never guest-room keys."""

from __future__ import annotations

import pytest
from mcp.server.mcpserver.exceptions import ResourceError, ToolError

from apps.apitokens.scopes import DESIGNS_READ, DESIGNS_WRITE
from apps.drawings import services
from apps.drawings.models import Drawing
from apps.mcp import resources
from apps.mcp.tools import drawings

pytestmark = pytest.mark.django_db


def document(*, background: str = "#ffffff", elements: list[dict] | None = None) -> dict:
    return {
        "schemaVersion": 1,
        "elements": elements or [],
        "background": background,
    }


def rectangle(element_id: str = "shape-1") -> dict:
    return {
        "id": element_id,
        "type": "rectangle",
        "x": 10,
        "y": 20,
        "width": 80,
        "height": 40,
        "angle": 0,
        "style": {},
    }


def test_design_scoped_tokens_do_not_gain_whiteboard_access(as_caller):
    as_caller.token.scopes = [DESIGNS_READ, DESIGNS_WRITE]
    with pytest.raises(ToolError, match="drawings:read"):
        drawings.list_drawings()


def test_account_whiteboard_tools_use_service_and_check_revision(as_caller, user, other):
    own = services.create_drawing(user, title="Own board", document=document())
    foreign = services.create_drawing(other, title="Not mine", document=document())

    listed = drawings.list_drawings()
    assert listed["total"] == 1 and listed["drawings"][0]["id"] == str(own.pk)
    assert "document" not in listed["drawings"][0]

    created = drawings.create_drawing(title="Created", document=document(elements=[rectangle()]))
    assert created["title"] == "Created" and created["document"]["elements"][0]["id"] == "shape-1"
    assert created["editor_url"].endswith(f"/drawings/{created['id']}")

    read = drawings.get_drawing(created["id"], include_document=True)
    assert read["document"] == created["document"] and "untrusted" in read["notice"]
    renamed = drawings.rename_drawing(created["id"], "Renamed")
    assert renamed["title"] == "Renamed" and renamed["revision"] == 1

    edited = drawings.edit_drawing(
        created["id"],
        document(background="#eeeeee", elements=[rectangle()]),
        base_revision=1,
    )
    assert edited["revision"] == 2 and edited["document"]["background"] == "#eeeeee"
    conflict = drawings.edit_drawing(created["id"], document(), base_revision=1)
    assert conflict["conflict"] is True and conflict["revision"] == 2
    assert Drawing.objects.get(pk=created["id"]).revision == 2

    with pytest.raises(ToolError, match="Not found"):
        drawings.get_drawing(str(foreign.pk))
    assert Drawing.objects.filter(owner=user).count() == 2


def test_whiteboard_trash_is_private_and_resource_is_a_snapshot(as_caller, user, other):
    own = services.create_drawing(user, title="Trash me", document=document())
    foreign = services.create_drawing(other, title="Foreign", document=document())

    assert drawings.trash_drawing(str(own.pk)) == {"id": str(own.pk), "trashed": True}
    assert drawings.list_drawings()["total"] == 0
    assert drawings.list_drawings(in_trash=True)["drawings"][0]["id"] == str(own.pk)
    with pytest.raises(ToolError, match="Not found"):
        drawings.trash_drawing(str(foreign.pk))
    with pytest.raises(ResourceError, match="Not found"):
        resources.drawing_summary(str(own.pk))


def test_whiteboard_writes_reject_unowned_file_metadata_and_custom_data(as_caller):
    with pytest.raises(ToolError, match="file metadata"):
        drawings.create_drawing(document={**document(), "files": {"file-1": {"id": "file-1"}}})
    with pytest.raises(ToolError, match="customData"):
        drawings.create_drawing(document={**document(), "elements": [{**rectangle(), "customData": {}}]})
