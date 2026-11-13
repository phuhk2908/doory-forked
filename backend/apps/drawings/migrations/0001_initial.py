import uuid

import apps.drawings.models
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Drawing",
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
                (
                    "thumbnail",
                    models.ImageField(
                        blank=True,
                        upload_to=apps.drawings.models.drawing_thumbnail_path,
                    ),
                ),
                ("revision", models.PositiveIntegerField(default=1)),
                ("trashed_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="drawings",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-updated_at"],
                "indexes": [
                    models.Index(
                        fields=["owner", "trashed_at", "-updated_at"],
                        name="drawings_dr_owner_i_15c7ce_idx",
                    )
                ],
            },
        ),
    ]
