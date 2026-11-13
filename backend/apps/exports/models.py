"""Database records for exports that outlive the HTTP request."""

from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class ExportJob(BaseModel):
    """A durable server-side export request and its private, expiring result link.

    The document is a snapshot, so a queued export is deterministic even when the design is edited before a
    worker gets to it. The file itself remains in the private export storage and is removed by its normal TTL.
    """

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="export_jobs")
    design = models.ForeignKey("designs.Design", on_delete=models.CASCADE, related_name="export_jobs")
    request = models.JSONField(default=dict)
    document = models.JSONField(default=dict)
    title = models.CharField(max_length=200, blank=True)
    preset = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED, db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    download_url = models.URLField(max_length=2048, blank=True)
    filename = models.CharField(max_length=255, blank=True)
    mime = models.CharField(max_length=128, blank=True)
    placeholders = models.PositiveIntegerField(default=0)
    error_code = models.CharField(max_length=64, blank=True)
    error = models.CharField(max_length=500, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["owner", "-created_at"]),
            models.Index(fields=["status", "created_at"]),
        ]
