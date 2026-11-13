import json
from io import StringIO

from django.core.management import call_command

from apps.core.management.commands import maintenance


def test_maintenance_json_runs_the_recurring_tasks(monkeypatch):
    calls = []

    def fake_call_command(name, *, stdout, stderr, **kwargs):
        calls.append((name, kwargs))
        stdout.write(f"{name} finished\n")

    monkeypatch.setattr(maintenance, "call_command", fake_call_command)
    output = StringIO()

    call_command("maintenance", "--json", stdout=output)

    summary = json.loads(output.getvalue())
    assert summary["ok"] is True
    assert [name for name, _ in calls] == [
        "collab_maintenance",
        "process_video_jobs",
        "sweep_video_jobs",
        "purge_exports",
    ]
    assert all(task["ok"] for task in summary["tasks"])
    assert all("duration_ms" in task for task in summary["tasks"])


def test_maintenance_can_include_trash_purge(monkeypatch):
    calls = []

    def fake_call_command(name, *, stdout, stderr, **kwargs):
        calls.append((name, kwargs))

    monkeypatch.setattr(maintenance, "call_command", fake_call_command)
    call_command("maintenance", "--json", "--purge-trash", "--trash-days", "14", stdout=StringIO())

    assert calls[0] == ("purge_trash", {"days": 14})
