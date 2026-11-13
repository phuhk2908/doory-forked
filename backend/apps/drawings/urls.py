from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import (
    DrawingRoomCollaboratorDetailView,
    DrawingRoomCollaboratorListView,
    DrawingRoomCreateView,
    DrawingRoomManageView,
    DrawingRoomTransferOwnershipView,
    DrawingRoomView,
    DrawingViewSet,
)

router = SimpleRouter()
router.register("drawings", DrawingViewSet, basename="drawing")

urlpatterns = [
    path("drawing-rooms/", DrawingRoomCreateView.as_view(), name="drawing-room-create"),
    path("drawing-rooms/<uuid:pk>/", DrawingRoomView.as_view(), name="drawing-room-detail"),
    path("drawing-rooms/<uuid:pk>/manage/", DrawingRoomManageView.as_view(), name="drawing-room-manage"),
    path(
        "drawing-rooms/<uuid:pk>/collaborators/",
        DrawingRoomCollaboratorListView.as_view(),
        name="drawing-room-collaborator-list",
    ),
    path(
        "drawing-rooms/<uuid:pk>/collaborators/<uuid:user_id>/",
        DrawingRoomCollaboratorDetailView.as_view(),
        name="drawing-room-collaborator-detail",
    ),
    path(
        "drawing-rooms/<uuid:pk>/transfer-ownership/",
        DrawingRoomTransferOwnershipView.as_view(),
        name="drawing-room-transfer-ownership",
    ),
    *router.urls,
]
