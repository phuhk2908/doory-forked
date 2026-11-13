from apps.drawings.services import apply_drawing_delta, compute_drawing_delta, merge_drawing_documents


def element(element_id: str, element_type: str = "rectangle") -> dict:
    return {
        "id": element_id,
        "type": element_type,
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 80,
        "angle": 0,
        "style": {"stroke": "#111827"},
        "version": 1,
        "versionNonce": 1,
    }


def document(elements: list[dict], **metadata: object) -> dict:
    return {
        "schemaVersion": 1,
        "elements": elements,
        "background": "#ffffff",
        **metadata,
    }


def test_reorder_only_delta_round_trips_through_merge():
    one = element("one")
    two = element("two", "ellipse")
    current = document(
        [one, two],
        order=["one", "two"],
        orderVersion=1,
        orderVersionNonce=10,
    )
    incoming = document(
        [two, one],
        order=["two", "one"],
        orderVersion=2,
        orderVersionNonce=20,
    )

    delta = compute_drawing_delta(current, incoming)

    assert delta["elements"] == []
    assert delta["order"] == ["two", "one"]
    assert [item["id"] for item in apply_drawing_delta(current, delta)["elements"]] == ["two", "one"]


def test_older_snapshot_cannot_overwrite_newer_layer_order():
    one = element("one")
    two = element("two", "ellipse")
    current = document(
        [two, one],
        order=["two", "one"],
        orderVersion=3,
        orderVersionNonce=30,
    )
    stale = document(
        [one, two],
        order=["one", "two"],
        orderVersion=2,
        orderVersionNonce=99,
    )

    merged = merge_drawing_documents(current, stale)

    assert [item["id"] for item in merged["elements"]] == ["two", "one"]


def test_legacy_element_addition_gets_an_explicit_complete_order_delta():
    one = element("one")
    two = element("two", "ellipse")
    three = element("three", "diamond")
    current = document([one, two])
    incoming = document([two, one, three])

    delta = compute_drawing_delta(current, incoming)
    merged = apply_drawing_delta(current, delta)

    assert delta["order"] == ["two", "one", "three"]
    assert [item["id"] for item in merged["elements"]] == ["two", "one", "three"]
