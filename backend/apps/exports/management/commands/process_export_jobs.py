"""Run durable server-side exports that are queued in the database."""

from django.core.management.base import BaseCommand, CommandError

from apps.exports import jobs
from apps.exports.models import ExportJob


class Command(BaseCommand):
    help = "Process queued server-side exports, including jobs left behind by an API restart."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Process at most this many jobs (zero means all jobs currently queued).",
        )

    def handle(self, *args, **options):
        limit = options["limit"]
        if limit < 0:
            raise CommandError("--limit must be zero or greater.")
        requeued, failed = jobs.requeue_stale()
        queue = ExportJob.objects.filter(status=ExportJob.Status.QUEUED).order_by("created_at")
        if limit:
            queue = queue[:limit]
        attempted = succeeded = skipped = 0
        for job_id in queue.values_list("pk", flat=True):
            if not jobs.run(job_id):
                skipped += 1
                continue
            attempted += 1
            succeeded += ExportJob.objects.filter(pk=job_id, status=ExportJob.Status.SUCCEEDED).exists()
        self.stdout.write(
            f"Attempted {attempted} export job(s); succeeded {succeeded}; skipped {skipped}; "
            f"requeued {requeued}; failed stale {failed}."
        )
