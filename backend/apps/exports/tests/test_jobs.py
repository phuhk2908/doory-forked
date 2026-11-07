from datetime import timedelta

import pytest
from django.utils import timezone

from apps.designs.tests.helpers import make_design, make_doc
from apps.exports import jobs
from apps.exports.models import ExportJob
from apps.exports.services import ImageBundle, ImageResult


def image_url(design) -> str:
    return f"/api/v1/designs/{design.pk}/export/image/"


@pytest.fixture(autouse=True)
def _image_export_on(settings):
    settings.SERVER_IMAGE_EXPORT_ENABLED = True


def test_background_export_snapshots_and_queues_the_request(
    client, user, monkeypatch, django_capture_on_commit_callbacks
):
    design = make_design(user, title="Queued", document=make_doc(pages=2))
    submitted: list[object] = []
    monkeypatch.setattr(jobs, "submit", submitted.append)

    with django_capture_on_commit_callbacks(execute=True):
        response = client.post(
            image_url(design), {"background": True, "page": 2, "format": "jpg"}, format="json"
        )

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == ExportJob.Status.QUEUED
    assert body["id"] == str(ExportJob.objects.get().pk)
    assert body["poll_url"].endswith(f"/api/v1/exports/jobs/{body['id']}/")
    assert response["Location"] == body["poll_url"]
    assert submitted == [ExportJob.objects.get().pk]
    job = ExportJob.objects.get()
    assert job.document == design.document
    assert job.request["pages"] == [1]
    assert job.request["format"] == "jpg"


def test_export_job_status_is_private(client, user, anon, monkeypatch):
    design = make_design(user, document=make_doc())
    response = client.post(image_url(design), {"background": True}, format="json")
    assert response.status_code == 202
    job = ExportJob.objects.get()

    assert client.get(f"/api/v1/exports/jobs/{job.pk}/").status_code == 200
    assert anon.get(f"/api/v1/exports/jobs/{job.pk}/").status_code == 401


def test_worker_stores_a_successful_result(user, monkeypatch):
    monkeypatch.setattr(jobs.connections, "close_all", lambda: None)
    design = make_design(user, title="Worker", document=make_doc())
    job = ExportJob.objects.create(
        owner=user,
        design=design,
        request={"format": "png", "pages": [0]},
        document=design.document,
        title=design.title,
        preset=design.preset,
    )
    result = ImageBundle(
        data=b"png-bytes",
        format="png",
        mime="image/png",
        filename="Worker.png",
        images=(
            ImageResult(
                data=b"png-bytes",
                format="png",
                mime="image/png",
                width=10,
                height=10,
                page_id=design.document["pages"][0]["id"],
                page_index=0,
                placeholders=2,
            ),
        ),
        filenames=("Worker.png",),
    )
    calls: list[dict] = []
    monkeypatch.setattr(jobs, "export_images", lambda design, **options: calls.append(options) or result)
    monkeypatch.setattr(
        jobs.delivery, "store_image", lambda data, mime: "http://testserver/exports/image/token/"
    )

    assert jobs.run(job.pk) is True

    job.refresh_from_db()
    assert job.status == ExportJob.Status.SUCCEEDED
    assert job.download_url.endswith("/exports/image/token/")
    assert job.filename == "Worker.png"
    assert job.placeholders == 2
    assert calls[0]["document"] == job.document


def test_stale_worker_lease_is_requeued_before_the_retry_limit(user, monkeypatch, settings):
    settings.EXPORT_JOB_MAX_ATTEMPTS = 3
    monkeypatch.setattr(jobs, "stale_after_seconds", lambda: 1)
    design = make_design(user, document=make_doc())
    job = ExportJob.objects.create(
        owner=user,
        design=design,
        status=ExportJob.Status.RUNNING,
        attempts=1,
        started_at=timezone.now() - timedelta(seconds=10),
        document=design.document,
    )

    assert jobs.requeue_stale() == (1, 0)
    job.refresh_from_db()
    assert job.status == ExportJob.Status.QUEUED
    assert job.started_at is None
    assert job.error_code == "export_interrupted"
