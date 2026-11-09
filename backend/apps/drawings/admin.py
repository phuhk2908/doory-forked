from django.contrib import admin

from . import services
from .models import Drawing, DrawingRoom, DrawingRoomCollaborator, DrawingRoomEvent


@admin.register(Drawing)
class DrawingAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "revision", "updated_at", "trashed_at")
    list_filter = ("trashed_at", "created_at")
    search_fields = ("title", "owner__email")
    readonly_fields = ("id", "created_at", "updated_at", "revision")


@admin.register(DrawingRoom)
class DrawingRoomAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "id",
        "account_owner",
        "revision",
        "spam_score",
        "spam_flagged_at",
        "closed_at",
        "expires_at",
        "updated_at",
    )
    list_filter = ("account_owner", "closed_at", "expires_at", "spam_flagged_at")
    search_fields = ("title", "id", "account_owner__email")
    readonly_fields = (
        "id",
        "created_at",
        "updated_at",
        "account_owner",
        "room_key_hash",
        "owner_key_hash",
        "view_key_hash",
        "revision",
        "spam_score",
        "spam_flagged_at",
    )
    actions = ("close_rooms",)

    @admin.action(description="Close selected rooms")
    def close_rooms(self, request, queryset):
        from .views import notify_drawing_room

        closed = 0
        for room in queryset:
            if services.moderate_close_drawing_room(room.pk, actor_id=request.user.pk, actor=request.user):
                notify_drawing_room(room.pk, "moderated")
                closed += 1
        self.message_user(request, f"Closed {closed} room(s).")


@admin.register(DrawingRoomEvent)
class DrawingRoomEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "kind", "room_identifier", "room", "actor", "spam_score", "client_ip_hash")
    list_filter = ("kind", "created_at", "spam_score")
    search_fields = ("room__title", "room__id", "room_identifier", "kind", "client_ip_hash", "actor__email")
    readonly_fields = (
        "id",
        "created_at",
        "updated_at",
        "room",
        "room_identifier",
        "actor",
        "kind",
        "client_ip_hash",
        "spam_score",
        "metadata",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(DrawingRoomCollaborator)
class DrawingRoomCollaboratorAdmin(admin.ModelAdmin):
    list_display = ("room", "user", "role", "invited_by", "created_at", "updated_at")
    list_filter = ("role", "created_at")
    search_fields = ("room__title", "room__id", "user__email", "invited_by__email")
    readonly_fields = ("id", "created_at", "updated_at")
