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
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _record(value: Any) -> bool:
    return isinstance(value, dict)


def _validate_binding(binding: Any) -> None:
    if binding is None:
        return
    if not _record(binding):
        raise InvalidDrawing("Drawing bindings must be objects or null.")
    if not isinstance(binding.get("elementId"), str) or not binding["elementId"]:
        raise InvalidDrawing("Drawing bindings need a target element id.")
    if (
        len(binding["elementId"]) > 128
        or not _finite(binding.get("focus"))
        or not _finite(binding.get("gap"))
    ):
        raise InvalidDrawing("Drawing bindings contain invalid geometry.")


def _validate_element(element: Any) -> None:
    if not _record(element):
        raise InvalidDrawing("Every drawing element must be an object.")
    if not isinstance(element.get("id"), str) or not element["id"] or len(element["id"]) > 128:
        raise InvalidDrawing("Every drawing element needs a valid id.")
    if element.get("type") not in ELEMENT_TYPES:
        raise InvalidDrawing("The drawing contains an unsupported element type.")
    if not all(_finite(element.get(key)) for key in ("x", "y", "width", "height", "angle")):
        raise InvalidDrawing("Drawing geometry must contain finite numbers.")
    if not _record(element.get("style")):
        raise InvalidDrawing("Every drawing element needs a style.")
    if "version" in element and (
        not isinstance(element["version"], int)
        or isinstance(element["version"], bool)
        or element["version"] < 1
    ):
        raise InvalidDrawing("Drawing element versions must be positive integers.")
    if "versionNonce" in element and (
        not isinstance(element["versionNonce"], int)
        or isinstance(element["versionNonce"], bool)
        or element["versionNonce"] < 0
    ):
        raise InvalidDrawing("Drawing element version nonces must be non-negative integers.")
    if "isDeleted" in element and not isinstance(element["isDeleted"], bool):
        raise InvalidDrawing("Drawing element deletion markers must be booleans.")
    if "groupIds" in element:
        group_ids = element["groupIds"]
        if (
            not isinstance(group_ids, list)
            or len(group_ids) > 32
            or any(
                not isinstance(group_id, str) or not group_id or len(group_id) > 128 for group_id in group_ids
            )
        ):
            raise InvalidDrawing("Drawing element groups must be a bounded list of ids.")
    if "customData" in element and not _record(element["customData"]):
        raise InvalidDrawing("Drawing element custom data must be an object.")
    if element["type"] in {"line", "arrow", "freedraw"}:
        points = element.get("points")
        if not isinstance(points, list) or not points or len(points) > MAX_POINTS:
            raise InvalidDrawing("Linear elements need a bounded list of points.")
        for point in points:
            if not _record(point) or not _finite(point.get("x")) or not _finite(point.get("y")):
                raise InvalidDrawing("Drawing points must contain finite numbers.")
            if "pressure" in point and not _finite(point["pressure"]):
                raise InvalidDrawing("Drawing point pressure must be finite.")
        if element["type"] in {"line", "arrow"}:
            _validate_binding(element.get("startBinding"))
            _validate_binding(element.get("endBinding"))
            for key in ("startArrowhead", "endArrowhead"):
                if key in element and element[key] not in {None, "arrow", "triangle"}:
                    raise InvalidDrawing("Drawing arrowheads are not supported.")
    if element["type"] == "text":
        if not isinstance(element.get("text"), str) or len(element["text"]) > MAX_TEXT:
            raise InvalidDrawing("Drawing text is too long.")
        if "originalText" in element and not isinstance(element["originalText"], str):
            raise InvalidDrawing("Original drawing text must be a string.")


def _validate_elements(elements: Any) -> None:
    if not isinstance(elements, list) or len(elements) > MAX_ELEMENTS:
        raise InvalidDrawing("The drawing must contain a bounded list of elements.")
    ids: set[str] = set()
    for element in elements:
        _validate_element(element)
        if element["id"] in ids:
            raise InvalidDrawing("Drawing element ids must be unique.")
        ids.add(element["id"])


def _validate_document_metadata(document: dict) -> None:
    if "background" in document and not isinstance(document["background"], str):
        raise InvalidDrawing("Drawing backgrounds must be strings.")
    files = document.get("files")
    if files is None:
        return
    if not _record(files) or len(files) > MAX_ELEMENTS:
        raise InvalidDrawing("Drawing files must be a bounded object.")
    for file_id, file in files.items():
        if not isinstance(file_id, str) or not file_id or len(file_id) > 128 or not _record(file):
            raise InvalidDrawing("Drawing files need valid ids and metadata.")
        for key in ("id", "mime", "name", "url"):
            if key in file and not isinstance(file[key], str):
                raise InvalidDrawing("Drawing file metadata must use strings.")


def _validate_json_size(value: dict, *, max_bytes: int, label: str) -> None:
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError, RecursionError) as exc:
        raise InvalidDrawing(f"The drawing {label} is not valid JSON.") from exc
    if len(encoded.encode("utf-8")) > max_bytes:
        raise InvalidDrawing(f"The drawing {label} is too large.")


def validate_drawing_document(document: Any, *, max_bytes: int = MAX_DOCUMENT_BYTES) -> dict:
    if not _record(document):
        raise InvalidDrawing("The drawing document must be an object.")
    _validate_json_size(document, max_bytes=max_bytes, label="document")
    if document.get("schemaVersion") != SCHEMA_VERSION:
        raise InvalidDrawing("The drawing schema version is not supported.")
    _validate_elements(document.get("elements"))
    _validate_document_metadata(document)
    return document


def validate_drawing_delta(delta: Any, *, max_bytes: int = MAX_DOCUMENT_BYTES) -> dict:
    """Validate a partial document used by the versioned realtime protocol."""
    if not _record(delta):
        raise InvalidDrawing("The drawing delta must be an object.")
    _validate_json_size(delta, max_bytes=max_bytes, label="delta")
    if delta.get("schemaVersion") != SCHEMA_VERSION:
        raise InvalidDrawing("The drawing schema version is not supported.")
    _validate_elements(delta.get("elements"))
    _validate_document_metadata(delta)
    return delta
