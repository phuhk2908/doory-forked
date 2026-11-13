import pytest

from apps.drawings.validators import InvalidDrawing, validate_drawing_delta, validate_drawing_document


def document(*elements):
    return {"schemaVersion": 1, "elements": list(elements), "background": "#ffffff"}


def element(element_type="rectangle", **extra):
    return {
        "id": "element-1",
        "type": element_type,
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 80,
        "angle": 0,
        "style": {"stroke": "#111827"},
        **extra,
    }


def test_accepts_shapes_and_linear_elements():
    result = validate_drawing_document(
        document(
            element(id="rectangle-1"),
            element("arrow", id="arrow-1", points=[{"x": 0, "y": 0}, {"x": 100, "y": 80}]),
            element("text", id="text-1", text="Hello"),
        )
    )
    assert len(result["elements"]) == 3


def test_accepts_image_elements_with_external_file_metadata():
    image = element("image", id="image-1", fileId="asset-1", width=320, height=240)
    drawing = document(image)
    drawing["files"] = {
        "asset-1": {
            "id": "asset-1",
            "mime": "image/png",
            "name": "diagram.png",
            "url": "/media/diagram.png",
            "width": 640,
            "height": 480,
        }
    }

    assert validate_drawing_document(drawing) == drawing


@pytest.mark.parametrize(
    "value",
    [
        {},
        {"schemaVersion": 2, "elements": []},
        document(element("unknown")),
        document(element("line", points=[])),
        document(element("text", text="x" * 100_001)),
        document(element(locked="yes")),
        document(element("image", fileId="")),
        {
            **document(element("image", fileId="asset-1")),
            "files": {
                "asset-1": {
                    "id": "asset-1",
                    "mime": "image/png",
                    "name": "diagram.png",
                    "url": "data:image/png;base64,AAAA",
                }
            },
        },
    ],
)
def test_rejects_unsupported_or_malformed_documents(value):
    with pytest.raises(InvalidDrawing):
        validate_drawing_document(value)


def test_rejects_non_finite_geometry():
    with pytest.raises(InvalidDrawing):
        validate_drawing_document(document(element(x=float("nan"))))


def test_rejects_duplicate_element_ids():
    with pytest.raises(InvalidDrawing):
        validate_drawing_document(document(element(), element()))


def test_accepts_a_versioned_delta_with_optional_metadata():
    delta = {
        "schemaVersion": 1,
        "elements": [element("arrow", id="arrow-1", points=[{"x": 0, "y": 0}])],
        "background": "#f8fafc",
        "files": {},
    }

    assert validate_drawing_delta(delta) == delta


def test_accepts_a_complete_versioned_document_order():
    drawing = document(element(id="one"), element("ellipse", id="two"))
    drawing.update({"order": ["two", "one"], "orderVersion": 2, "orderVersionNonce": 9})

    assert validate_drawing_document(drawing) == drawing


@pytest.mark.parametrize(
    "order",
    [
        ["one", "one"],
        ["one"],
        ["missing", "one", "two"],
    ],
)
def test_rejects_incomplete_or_duplicate_document_order(order):
    drawing = document(element(id="one"), element("ellipse", id="two"))
    drawing["order"] = order

    with pytest.raises(InvalidDrawing):
        validate_drawing_document(drawing)


def test_delta_order_may_reference_elements_from_the_base_snapshot():
    delta = {
        "schemaVersion": 1,
        "elements": [element(id="two")],
        "order": ["two", "one"],
        "orderVersion": 1,
        "orderVersionNonce": 2,
    }

    assert validate_drawing_delta(delta) == delta


def test_accepts_boolean_lock_markers():
    locked = document(element(locked=True))

    assert validate_drawing_document(locked) == locked


def test_rejects_malformed_delta_elements():
    with pytest.raises(InvalidDrawing):
        validate_drawing_delta({"schemaVersion": 1, "elements": [element("unknown")]})


@pytest.mark.parametrize("url", ["", "data:image/png;base64,AAAA", "blob:local", "idb://local"])
def test_rejects_non_durable_image_urls(url):
    drawing = document(element("image", fileId="asset-1"))
    drawing["files"] = {
        "asset-1": {
            "id": "asset-1",
            "mime": "image/png",
            "name": "diagram.png",
            "url": url,
        }
    }

    with pytest.raises(InvalidDrawing):
        validate_drawing_document(drawing)
