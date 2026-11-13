"""Durable workers for server-side exports.

The API submits a database row and may also nudge an in-process worker. A separate process can run the
management command, so a restart never loses a queued export and a stale lease can be reclaimed.
"""

from __future__ import annotations

import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import BinaryIO

from django.conf import settings
from django.db import connections, transaction
from django.utils import timezone

from apps.designs.fill import charge

from . import delivery
from .models import ExportJob
from .services import export_images
from .throttling import ExportRateThrottle, OffsiteOptimizeRateThrottle

logger = logging.getLogger("doory.exports")

STALE_GRACE_SECONDS = 60

_pool_lock = threading.Lock()
_pool: ThreadPoolExecutor | None = None


def stale_after_seconds() -> int:
    """The longest configured export plus a grace period for a process to finish its lease update."""
    return (
        max(
            int(settings.EXPORT_IMAGE_TIMEOUT_SECONDS),
            int(settings.EXPORT_VIDEO_TIMEOUT_SECONDS),
            int(settings.EXPORT_TIMEOUT_SECONDS) * 2,
        )
        + STALE_GRACE_SECONDS
    )


def _executor() -> ThreadPoolExecutor:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ThreadPoolExecutor(
                max_workers=max(1, int(getattr(settings, "EXPORT_JOB_WORKERS", 1))),
                thread_name_prefix="export-job",
            )
        return _pool


def submit(job_id) -> None:
    """Start a best-effort local worker; the persisted row is the source of truth."""
    _executor().submit(run, job_id)


def _claim(job_id) -> ExportJob | None:
    now = timezone.now()
    cutoff = now - timedelta(seconds=stale_after_seconds())
    with transaction.atomic():
        job = ExportJob.objects.select_for_update().filter(pk=job_id).first()
        if job is None or job.status in (ExportJob.Status.SUCCEEDED, ExportJob.Status.FAILED):
            return None
        if job.status == ExportJob.Status.RUNNING and job.started_at is not None and job.started_at >= cutoff:
            return None
        if job.attempts >= int(getattr(settings, "EXPORT_JOB_MAX_ATTEMPTS", 3)):
            job.status = ExportJob.Status.FAILED
            job.error_code = "export_interrupted"
            job.error = "The export worker stopped before it could finish."
            job.finished_at = now
            job.save(update_fields=["status", "error_code", "error", "finished_at", "updated_at"])
            return None
        job.status = ExportJob.Status.RUNNING
        job.started_at = now
        job.attempts += 1
        job.error_code = ""
        job.error = ""
        job.save(update_fields=["status", "started_at", "attempts", "error_code", "error", "updated_at"])
        return job


def _charge_pages(user, extra: int) -> None:
    for _ in range(extra):
        charge(ExportRateThrottle(), user)


def _charge_offsite(user, files: int) -> None:
    for _ in range(files):
        charge(OffsiteOptimizeRateThrottle(), user)


def _error(error: Exception) -> tuple[str, str]:
    code = getattr(error, "default_code", None) or getattr(error, "code", None) or "export_failed"
    detail = getattr(error, "detail", None)
    if isinstance(detail, dict):
        detail = json.dumps(detail, sort_keys=True)
    message = str(detail or error) or "The export failed."
    return str(code)[:64], message[:500]


def _source(result) -> bytes | BinaryIO:
    if result.file is None:
        return result.data
    result.file.seek(0)
    return result.file


def run(job_id) -> bool:
    """Claim and execute one job. False means another worker owns it or it is already terminal."""
    job = _claim(job_id)
    if job is None:
        connections.close_all()
        return False
    result = None
    try:
        from apps.designs.models import Design

        design = Design.objects.select_related("owner").get(pk=job.design_id)
        design.document = job.document
        design.title = job.title
        design.preset = job.preset
        result = export_images(
            design,
            document=job.document,
            charge=lambda extra: _charge_pages(job.owner, extra),
            charge_offsite=lambda files: _charge_offsite(job.owner, files),
            **job.request,
        )
        download_url = delivery.store_image(_source(result), result.mime)
        ExportJob.objects.filter(pk=job.pk, status=ExportJob.Status.RUNNING).update(
            status=ExportJob.Status.SUCCEEDED,
            finished_at=timezone.now(),
            download_url=download_url,
            filename=result.filename,
            mime=result.mime,
            placeholders=sum(image.placeholders for image in result.images),
            error_code="",
            error="",
            updated_at=timezone.now(),
        )
        return True
    except Exception as error:  # the job must never remain running after a handled failure
        code, message = _error(error)
        logger.exception("Export job %s failed", job_id)
        ExportJob.objects.filter(pk=job.pk, status=ExportJob.Status.RUNNING).update(
            status=ExportJob.Status.FAILED,
            finished_at=timezone.now(),
            error_code=code,
            error=message,
            updated_at=timezone.now(),
        )
        return True
    finally:
        if result is not None and result.file is not None:
            result.file.close()
        connections.close_all()


def requeue_stale() -> tuple[int, int]:
    """Requeue interrupted leases while permanently failing rows past their retry limit."""
    cutoff = timezone.now() - timedelta(seconds=stale_after_seconds())
    stale = ExportJob.objects.filter(status=ExportJob.Status.RUNNING, started_at__lt=cutoff)
    retry_limit = int(getattr(settings, "EXPORT_JOB_MAX_ATTEMPTS", 3))
    retry = stale.filter(attempts__lt=retry_limit).update(
        status=ExportJob.Status.QUEUED,
        started_at=None,
        error_code="export_interrupted",
        error="The previous worker stopped; the export was requeued.",
        updated_at=timezone.now(),
    )
    failed = stale.filter(attempts__gte=retry_limit).update(
        status=ExportJob.Status.FAILED,
        finished_at=timezone.now(),
        error_code="export_interrupted",
        error="The export worker stopped before it could finish.",
        updated_at=timezone.now(),
    )
    return retry, failed
