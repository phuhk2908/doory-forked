from __future__ import annotations

from django.conf import settings
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.assets.uploads import strip_unsafe_chars

from .models import Drawing, DrawingRoom
from .validators import validate_drawing_document

TITLE_MAX_LENGTH = 200


def clean_text(value: str) -> str:
    return " ".join(strip_unsafe_chars(value).split())


@extend_schema_field({"type": "object", "additionalProperties": True})
class DocumentField(serializers.Field):
    def to_internal_value(self, data):
        try:
            return validate_drawing_document(data, max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def to_representation(self, value):
        return value


class TitleField(serializers.CharField):
    def __init__(self, **kwargs):
        super().__init__(max_length=TITLE_MAX_LENGTH * 2, **kwargs)

    def to_internal_value(self, data):
        title = clean_text(super().to_internal_value(data))
        if len(title) > TITLE_MAX_LENGTH:
            raise serializers.ValidationError(
                f"Ensure this field has no more than {TITLE_MAX_LENGTH} characters."
            )
        return title


class DrawingDocumentField(DocumentField):
    pass


class DrawingSummarySerializer(serializers.ModelSerializer):
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = Drawing
        fields = (
            "id",
            "title",
            "thumbnail_url",
            "revision",
            "created_at",
            "updated_at",
            "trashed_at",
        )
        read_only_fields = fields

    def get_thumbnail_url(self, obj: Drawing) -> str | None:
        return obj.thumbnail.url if obj.thumbnail else None


class DrawingSerializer(DrawingSummarySerializer):
    document = DrawingDocumentField(read_only=True)

    class Meta(DrawingSummarySerializer.Meta):
        fields = (*DrawingSummarySerializer.Meta.fields, "document")
        read_only_fields = fields


class DrawingQuerySerializer(serializers.Serializer):
    q = serializers.CharField(max_length=200, required=False, allow_blank=True)
    trashed = serializers.BooleanField(required=False, default=False)


class DrawingCreateSerializer(serializers.Serializer):
    title = TitleField(required=False, allow_blank=True)
    document = DocumentField(required=False)


class DrawingUpdateSerializer(serializers.Serializer):
    title = TitleField(required=False, allow_blank=True)
    document = DocumentField(required=False)
    base_revision = serializers.IntegerField(min_value=1, required=False)

    def validate(self, attrs):
        if "document" in attrs and "base_revision" not in attrs:
            raise serializers.ValidationError({"base_revision": ["Required when saving a document."]})
        return attrs


class DrawingRoomCreateSerializer(serializers.Serializer):
    title = TitleField(required=False, allow_blank=True)
    document = DocumentField(required=False)


class DrawingRoomManageSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=("close", "rotate", "rename"))
    title = TitleField(required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs["action"] == "rename" and not attrs.get("title", "").strip():
            raise serializers.ValidationError({"title": ["A room name is required."]})
        return attrs


class DrawingRoomSerializer(serializers.ModelSerializer):
    document = DrawingDocumentField(read_only=True)

    class Meta:
        model = DrawingRoom
        fields = (
            "id",
            "title",
            "document",
            "revision",
            "created_at",
            "updated_at",
            "closed_at",
            "expires_at",
        )
        read_only_fields = fields
