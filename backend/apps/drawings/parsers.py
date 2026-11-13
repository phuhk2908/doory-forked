from django.conf import settings

from apps.assets.parsers import BoundedJSONParser


class DrawingJSONParser(BoundedJSONParser):
    def limit(self) -> int:
        return settings.MAX_DRAWING_DOCUMENT_BYTES + 256 * 1024
