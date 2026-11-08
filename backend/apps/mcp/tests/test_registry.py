from apps.drawings.exceptions import RevisionConflict as DrawingRevisionConflict
from apps.mcp.registry import explain


def test_drawing_revision_conflicts_are_actionable():
    message = explain(DrawingRevisionConflict(4, None))

    assert message == (
        "The whiteboard changed since the revision you sent; it is now at revision 4. "
        "Read it again with get_drawing and retry."
    )
