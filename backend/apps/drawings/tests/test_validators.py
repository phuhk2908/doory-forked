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


@pytest.mark.parametrize(
    "value",
    [
        {},
        {"schemaVersion": 2, "elements": []},
        document(element("unknown")),
        document(element("line", points=[])),
        document(element("text", text="x" * 100_001)),
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


def test_rejects_malformed_delta_elements():
    with pytest.raises(InvalidDrawing):
        validate_drawing_delta({"schemaVersion": 1, "elements": [element("unknown")]})
