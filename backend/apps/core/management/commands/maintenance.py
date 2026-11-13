"""Run the recurring housekeeping tasks with one observable entry point."""

from __future__ import annotations

import json
import logging
import time
from io import StringIO

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

logger = logging.getLogger("doory.maintenance")


class Command(BaseCommand):
    help = (
        "Run realtime cleanup, durable video jobs, export cleanup and interrupted-job cleanup. "
        "Use --purge-trash for the daily permanent trash deletion."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--json",
            action="store_true",
            help="Write one machine-readable summary instead of human-readable task output.",
        )
        parser.add_argument(
            "--purge-trash",
            action="store_true",
            help="Also permanently delete designs past the trash retention period.",
        )
        parser.add_argument(
            "--trash-days",
            type=int,
            default=30,
            help="Trash retention when --purge-trash is used (default: 30).",
        )

    def handle(self, *args, **options):
        if options["trash_days"] < 0:
            raise CommandError("--trash-days must be zero or greater.")

        tasks = []
        if options["purge_trash"]:
            tasks.append(("purge_trash", {"days": options["trash_days"]}))
        tasks.extend(
            [
                ("collab_maintenance", {}),
                ("process_video_jobs", {}),
                ("sweep_video_jobs", {}),
                ("purge_exports", {}),
            ]
        )

        results = []
        for name, kwargs in tasks:
            output = StringIO()
            started = time.monotonic()
            error = None
            try:
                call_command(name, stdout=output, stderr=output, **kwargs)
            except Exception as exc:  # one failed cleanup must not hide the remaining task failures
                error = str(exc) or exc.__class__.__name__
                logger.exception("Maintenance task %s failed.", name)
            duration_ms = round((time.monotonic() - started) * 1000)
            record = {
                "task": name,
                "ok": error is None,
                "duration_ms": duration_ms,
                "output": output.getvalue().strip(),
            }
            if error is not None:
                record["error"] = error
            results.append(record)
            logger.info(
                "maintenance task=%s status=%s duration_ms=%d output=%s",
                name,
                "ok" if error is None else "failed",
                duration_ms,
                record["output"],
            )
            if not options["json"]:
                status = "ok" if error is None else f"failed: {error}"
                self.stdout.write(f"{name}: {status} ({duration_ms} ms)")
                if record["output"]:
                    for line in record["output"].splitlines():
                        self.stdout.write(f"  {line}")

        failed = [record["task"] for record in results if not record["ok"]]
        summary = {"ok": not failed, "tasks": results}
        if options["json"]:
            self.stdout.write(json.dumps(summary, sort_keys=True))
        if failed:
            raise CommandError(f"Maintenance failed for: {', '.join(failed)}")
