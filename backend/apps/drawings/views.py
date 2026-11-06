import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.assets.uploads import reject_oversize_request

from . import services
from .exceptions import RevisionConflict
from .models import Drawing
from .parsers import DrawingJSONParser
from .serializers import (
    DrawingCreateSerializer,
    DrawingQuerySerializer,
    DrawingRoomCreateSerializer,
    DrawingRoomManageSerializer,
    DrawingRoomSerializer,
    DrawingSerializer,
    DrawingSummarySerializer,
    DrawingUpdateSerializer,
)
from .services import THUMBNAIL_MAX_BYTES

UUID_REGEX = "[0-9a-fA-F-]{36}"
log = logging.getLogger("doory.drawings")


def conflict_response(conflict: RevisionConflict) -> Response:
    return Response(
        {
            "error": {
                "code": "revision_conflict",
                "message": "This whiteboard was changed elsewhere. Reload it or save your work as a copy.",
            },
            "current": {"revision": conflict.revision, "updated_at": conflict.updated_at},
        },
        status=status.HTTP_409_CONFLICT,
    )


@extend_schema(tags=["drawings"])
class DrawingViewSet(viewsets.GenericViewSet):
    parser_classes = [DrawingJSONParser, MultiPartParser]
    lookup_value_regex = UUID_REGEX
    serializer_class = DrawingSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Drawing.objects.none()
        queryset = Drawing.objects.filter(owner=self.request.user)
        if self.action == "list":
            return queryset.defer("document")
        return queryset.filter(trashed_at__isnull=True)

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str, description="Title search (case-insensitive)."),
            OpenApiParameter("trashed", bool, description="List the trash instead of live whiteboards."),
        ],
        responses=DrawingSummarySerializer(many=True),
    )
    def list(self, request):
        query = DrawingQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        params = query.validated_data
        queryset = self.get_queryset().filter(trashed_at__isnull=not params.get("trashed", False))
        if params.get("q", "").strip():
            queryset = queryset.filter(title__icontains=params["q"].strip())
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(DrawingSummarySerializer(page, many=True).data)

    @extend_schema(request=DrawingCreateSerializer, responses={201: DrawingSerializer})
    def create(self, request):
        body = DrawingCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        drawing = services.create_drawing(
            request.user,
            title=body.validated_data.get("title", services.DEFAULT_TITLE),
            document=body.validated_data.get("document") or services.blank_document(),
        )
        return Response(DrawingSerializer(drawing).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        return Response(DrawingSerializer(self.get_object()).data)

    @extend_schema(
        request=DrawingUpdateSerializer,
        responses={200: DrawingSerializer, 409: None},
        description="Saving a document needs base_revision; a stale value answers 409 revision_conflict.",
    )
    def partial_update(self, request, *args, **kwargs):
        body = DrawingUpdateSerializer(data=request.data, partial=True)
        body.is_valid(raise_exception=True)
        try:
            drawing = services.update_drawing(kwargs["pk"], request.user, body.validated_data)
        except RevisionConflict as conflict:
            return conflict_response(conflict)
        return Response(DrawingSerializer(drawing).data)

    @extend_schema(responses={204: None})
    def destroy(self, request, *args, **kwargs):
        services.trash_drawing(kwargs["pk"], request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        request={
            "multipart/form-data": inline_serializer(
                "DrawingThumbnailUpload", {"image": serializers.ImageField()}
            )
        },
        responses=inline_serializer("DrawingThumbnailUrl", {"thumbnail_url": serializers.CharField()}),
    )
    @action(detail=True, methods=["put"], parser_classes=[MultiPartParser])
    def thumbnail(self, request, pk=None):
        drawing = self.get_object()
        reject_oversize_request(request, THUMBNAIL_MAX_BYTES)
        image = request.data.get("image")
        if image is None or not hasattr(image, "read"):
            raise serializers.ValidationError({"image": ["Upload the thumbnail as the image file field."]})
        drawing = services.set_thumbnail(drawing, image)
        return Response({"thumbnail_url": drawing.thumbnail.url})


class DrawingRoomCreateView(APIView):
    """Public room bootstrap protected by a high-entropy key from the URL fragment."""

    authentication_classes: list = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        body = DrawingRoomCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        room, edit_key, view_key, owner_key = services.create_drawing_room(
            title=body.validated_data.get("title", services.DEFAULT_TITLE),
            document=body.validated_data.get("document") or services.blank_document(),
        )
        data = DrawingRoomSerializer(room).data
        data.update({"key": edit_key, "view_key": view_key, "owner_key": owner_key, "mode": "edit"})
        return Response(data, status=status.HTTP_201_CREATED)


class DrawingRoomView(APIView):
    authentication_classes: list = []
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        access = services.get_drawing_room_access(pk, request.headers.get("X-Drawing-Room-Key"))
        if access is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        room, mode = access
        data = DrawingRoomSerializer(room).data
        data["mode"] = mode
        return Response(data)


class DrawingRoomManageView(APIView):
    """Owner capability actions. The owner key is never included in a share URL."""

    authentication_classes: list = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=DrawingRoomManageSerializer)
    def post(self, request, pk):
        body = DrawingRoomManageSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        owner_key = request.headers.get("X-Drawing-Room-Owner-Key")
        action = body.validated_data["action"]
        if action == "close":
            room = services.close_drawing_room(pk, owner_key or "")
            if room is None:
                return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
            notify_drawing_room(pk, "closed")
            data = DrawingRoomSerializer(room).data
            data["mode"] = "edit"
            return Response(data)

        if action == "rename":
            room = services.rename_drawing_room(pk, owner_key or "", body.validated_data["title"])
            if room is None:
                return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
            notify_drawing_room(pk, "renamed", title=room.title)
            data = DrawingRoomSerializer(room).data
            data["mode"] = "edit"
            return Response(data)

        rotated = services.rotate_drawing_room_keys(pk, owner_key or "")
        if rotated is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        room, edit_key, view_key = rotated
        notify_drawing_room(pk, "revoked")
        data = DrawingRoomSerializer(room).data
        data.update({"key": edit_key, "view_key": view_key, "mode": "edit"})
        return Response(data)


def notify_drawing_room(room_id, reason: str, *, title: str | None = None) -> None:
    layer = get_channel_layer()
    if layer is None:
        return
    try:
        event = (
            {"type": "drawing.room_renamed", "title": title}
            if reason == "renamed"
            else {"type": "drawing.room_closed", "reason": reason}
        )
        async_to_sync(layer.group_send)(
            f"doory.drawing-room.{room_id}",
            event,
        )
    except Exception:
        log.warning("could not notify drawing room=%s reason=%s", room_id, reason, exc_info=True)
