import pytest

from apps.designs.services import apply_document, document_values

from .helpers import make_design, make_doc


@pytest.mark.django_db
def test_document_projection_keeps_design_fields_in_sync(user):
    document = make_doc(pages=2, width=321, height=123, meta={"presetId": "poster"})
    design = make_design(user)

    assert document_values(document) == {
        "document": document,
        "width": 321,
        "height": 123,
        "page_count": 2,
        "preset": "poster",
    }

    apply_document(design, document)

    assert design.document == document
    assert (design.width, design.height, design.page_count, design.preset) == (321, 123, 2, "poster")
