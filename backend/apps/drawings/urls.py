from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import DrawingRoomCreateView, DrawingRoomManageView, DrawingRoomView, DrawingViewSet

router = SimpleRouter()
router.register("drawings", DrawingViewSet, basename="drawing")

urlpatterns = [
    path("drawing-rooms/", DrawingRoomCreateView.as_view(), name="drawing-room-create"),
    path("drawing-rooms/<uuid:pk>/", DrawingRoomView.as_view(), name="drawing-room-detail"),
    path("drawing-rooms/<uuid:pk>/manage/", DrawingRoomManageView.as_view(), name="drawing-room-manage"),
    *router.urls,
]
