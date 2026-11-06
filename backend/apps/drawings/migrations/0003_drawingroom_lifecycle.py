from datetime import timedelta

from django.conf import settings
from django.db import migrations, models
from django.utils import timezone

from apps.drawings.models import drawing_room_expiry


def set_room_expiry(apps, schema_editor):
    DrawingRoom = apps.get_model("drawings", "DrawingRoom")
    expiry = timezone.now() + timedelta(days=settings.DRAWING_ROOM_TTL_DAYS)
    DrawingRoom.objects.filter(expires_at__isnull=True).update(expires_at=expiry)


class Migration(migrations.Migration):
    dependencies = [
        ("drawings", "0002_drawingroom"),
    ]

    operations = [
        migrations.AddField(
            model_name="drawingroom",
            name="closed_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="drawingroom",
            name="expires_at",
            field=models.DateTimeField(db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="drawingroom",
            name="owner_key_hash",
            field=models.CharField(blank=True, default="", editable=False, max_length=64),
        ),
        migrations.AddField(
            model_name="drawingroom",
            name="view_key_hash",
            field=models.CharField(blank=True, default="", editable=False, max_length=64),
        ),
        migrations.RunPython(set_room_expiry, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="drawingroom",
            name="expires_at",
            field=models.DateTimeField(db_index=True, default=drawing_room_expiry),
        ),
    ]
