from django.contrib import admin

from . import services
from .models import Drawing, DrawingRoom, DrawingRoomEvent


@admin.register(Drawing)
class DrawingAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "revision", "updated_at", "trashed_at")
    list_filter = ("trashed_at", "created_at")
    search_fields = ("title", "owner__email")
    readonly_fields = ("id", "created_at", "updated_at", "revision")


@admin.register(DrawingRoom)
class DrawingRoomAdmin(admin.ModelAdmin):
    list_display = ("title", "id", "revision", "closed_at", "expires_at", "updated_at")
    list_filter = ("closed_at", "expires_at")
    search_fields = ("title", "id")
    readonly_fields = (
        "id",
        "created_at",
        "updated_at",
        "room_key_hash",
        "owner_key_hash",
        "view_key_hash",
        "revision",
    )
    actions = ("close_rooms",)

    @admin.action(description="Close selected guest rooms")
    def close_rooms(self, request, queryset):
        from .views import notify_drawing_room

        closed = 0
        for room in queryset:
            if services.moderate_close_drawing_room(room.pk, actor_id=request.user.pk):
                notify_drawing_room(room.pk, "moderated")
                closed += 1
        self.message_user(request, f"Closed {closed} guest room(s).")


@admin.register(DrawingRoomEvent)
class DrawingRoomEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "kind", "room_identifier", "room", "client_ip_hash")
    list_filter = ("kind", "created_at")
    search_fields = ("room__title", "room__id", "room_identifier", "kind", "client_ip_hash")
    readonly_fields = (
        "id",
        "created_at",
        "updated_at",
        "room",
        "room_identifier",
        "kind",
        "client_ip_hash",
        "metadata",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
