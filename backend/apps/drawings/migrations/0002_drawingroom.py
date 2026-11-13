import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("drawings", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="DrawingRoom",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("title", models.CharField(default="Untitled whiteboard", max_length=200)),
                ("document", models.JSONField(default=dict)),
                ("room_key_hash", models.CharField(editable=False, max_length=64)),
                ("revision", models.PositiveIntegerField(default=1)),
            ],
            options={"ordering": ["-updated_at"]},
        ),
    ]
