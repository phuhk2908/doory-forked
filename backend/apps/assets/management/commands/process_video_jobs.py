"""Run durable video conversions that are queued in the database."""

from django.core.management.base import BaseCommand, CommandError

from apps.assets.models import Asset
from apps.assets.video_jobs import run


class Command(BaseCommand):
    help = "Convert queued video assets, including jobs left behind by an API restart."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Process at most this many jobs (zero means all currently queued jobs).",
        )

    def handle(self, *args, **options):
        limit = options["limit"]
        if limit < 0:
            raise CommandError("--limit must be zero or greater.")
        jobs = Asset.objects.filter(
            kind=Asset.Kind.VIDEO,
            status=Asset.Status.PROCESSING,
            processing_source__gt="",
        ).order_by("created_at")
        if limit:
            jobs = jobs[:limit]

        attempted = skipped = 0
        for asset_id in jobs.values_list("pk", flat=True):
            if run(asset_id):
                attempted += 1
            else:
                skipped += 1
        self.stdout.write(f"Attempted {attempted} durable video job(s); skipped {skipped} leased job(s).")
