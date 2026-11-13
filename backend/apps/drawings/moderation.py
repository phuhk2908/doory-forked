from __future__ import annotations

import re
from collections import Counter

URL_PATTERN = re.compile(r"https?://[^\s]+", re.IGNORECASE)


def score_drawing_document(document: dict) -> tuple[int, tuple[str, ...]]:
    """Return a bounded content-risk score without retaining any drawing text."""
    texts = [
        element.get("text", "").strip()
        for element in document.get("elements", [])
        if element.get("type") == "text" and isinstance(element.get("text"), str)
    ]
    non_empty = [text for text in texts if text]
    total_characters = sum(len(text) for text in non_empty)
    url_count = sum(len(URL_PATTERN.findall(text)) for text in non_empty)
    repeated = sum(max(0, count - 1) for count in Counter(text.casefold() for text in non_empty).values())
    score = 0
    reasons: list[str] = []

    if url_count >= 3:
        score += min(30, url_count * 5)
        reasons.append("many_links")
    if repeated:
        score += min(30, repeated * 6)
        reasons.append("repeated_text")
    if total_characters > 10_000:
        score += 15
        reasons.append("large_text_volume")
    if len(non_empty) > 100:
        score += 15
        reasons.append("many_text_elements")

    return min(score, 100), tuple(reasons)
