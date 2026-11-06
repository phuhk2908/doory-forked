from django.contrib import admin

from .models import Drawing, DrawingRoom


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
