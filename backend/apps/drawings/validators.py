from __future__ import annotations

import json
import math
from typing import Any

SCHEMA_VERSION = 1
MAX_ELEMENTS = 10_000
MAX_POINTS = 20_000
MAX_TEXT = 100_000
MAX_DOCUMENT_BYTES = 12 * 1024 * 1024
ELEMENT_TYPES = frozenset({"rectangle", "ellipse", "diamond", "line", "arrow", "freedraw", "text"})


class InvalidDrawing(ValueError):
    pass


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def _record(value: Any) -> bool:
    return isinstance(value, dict)


def validate_drawing_document(document: Any, *, max_bytes: int = MAX_DOCUMENT_BYTES) -> dict:
    if not _record(document):
        raise InvalidDrawing("The drawing document must be an object.")
    try:
        encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError, RecursionError) as exc:
        raise InvalidDrawing("The drawing document is not valid JSON.") from exc
    if len(encoded.encode("utf-8")) > max_bytes:
        raise InvalidDrawing("The drawing document is too large.")
    if document.get("schemaVersion") != SCHEMA_VERSION:
        raise InvalidDrawing("The drawing schema version is not supported.")
    elements = document.get("elements")
    if not isinstance(elements, list) or len(elements) > MAX_ELEMENTS:
        raise InvalidDrawing("The drawing must contain a bounded list of elements.")
    ids: set[str] = set()
    for element in elements:
        if not _record(element):
            raise InvalidDrawing("Every drawing element must be an object.")
        if not isinstance(element.get("id"), str) or not element["id"] or len(element["id"]) > 128:
            raise InvalidDrawing("Every drawing element needs a valid id.")
        if element["id"] in ids:
            raise InvalidDrawing("Drawing element ids must be unique.")
        ids.add(element["id"])
        if element.get("type") not in ELEMENT_TYPES:
            raise InvalidDrawing("The drawing contains an unsupported element type.")
        if not all(_finite(element.get(key)) for key in ("x", "y", "width", "height", "angle")):
            raise InvalidDrawing("Drawing geometry must contain finite numbers.")
        if not _record(element.get("style")):
            raise InvalidDrawing("Every drawing element needs a style.")
        if element["type"] in {"line", "arrow", "freedraw"}:
            points = element.get("points")
            if not isinstance(points, list) or not points or len(points) > MAX_POINTS:
                raise InvalidDrawing("Linear elements need a bounded list of points.")
            for point in points:
                if not _record(point) or not _finite(point.get("x")) or not _finite(point.get("y")):
                    raise InvalidDrawing("Drawing points must contain finite numbers.")
        if element["type"] == "text" and (
            not isinstance(element.get("text"), str) or len(element["text"]) > MAX_TEXT
        ):
            raise InvalidDrawing("Drawing text is too long.")
    return document
