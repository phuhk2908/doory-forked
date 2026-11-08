from __future__ import annotations

import asyncio
import json
import math
import time
from typing import Any

from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.drawings.metrics import guest_room_metrics
from apps.drawings.services import blank_document, create_drawing_room


def parse_sizes(value: str, maximum: int) -> list[int]:
    sizes: list[int] = []
    for raw in value.split(","):
        size_text = raw.strip().lower()
        if not size_text:
            continue
        size = maximum if size_text == "max" else int(size_text) if size_text.isdigit() else 0
        if size < 2 or size > maximum:
            raise ValueError(f"collaborator size must be between 2 and {maximum}: {raw}")
        if size not in sizes:
            sizes.append(size)
    if not sizes:
        raise ValueError("at least one collaborator size is required")
    return sizes


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(len(ordered) * fraction) - 1))
    return round(ordered[index], 2)


def _benchmark_element(index: int) -> dict[str, Any]:
    return {
        "id": f"benchmark-{index}",
        "type": "rectangle",
        "x": index,
        "y": index,
        "width": 20,
        "height": 20,
        "angle": 0,
        "style": {},
        "version": 1,
        "versionNonce": index + 1,
    }


async def _drain(socket: WebsocketCommunicator) -> None:
    while True:
        try:
            await socket.receive_json_from(timeout=0.02)
        except TimeoutError:
            return


async def _run_case(application: Any, size: int, rounds: int) -> dict[str, Any]:
    room, edit_key, _, _ = await database_sync_to_async(create_drawing_room)(
        title=f"benchmark-{size}", document=blank_document()
    )
    sockets = [
        WebsocketCommunicator(
            application,
            f"/ws/drawing-rooms/{room.id}/",
            headers=[(b"origin", b"http://localhost:5173"), (b"host", b"localhost:5173")],
        )
        for _ in range(size)
    ]
    before = guest_room_metrics.snapshot()
    latencies: list[float] = []
    sent_bytes = 0
    received_bytes = 0
    try:
        for index, socket in enumerate(sockets):
            connected, _ = await socket.connect()
            if not connected:
                raise RuntimeError(f"collaborator {index + 1} could not connect")
            await socket.send_json_to(
                {
                    "type": "auth",
                    "key": edit_key,
                    "client_id": f"benchmark-{size}-{index}",
                    "protocol": 2,
                }
            )
            ready = await socket.receive_json_from(timeout=10)
            if ready.get("type") != "ready":
                raise RuntimeError(f"collaborator {index + 1} was not ready: {ready}")
        await asyncio.gather(*(_drain(socket) for socket in sockets))

        for index in range(rounds):
            message = {
                "type": "update",
                "delta": {"schemaVersion": 1, "elements": [_benchmark_element(index)]},
                "client_id": index + 1,
            }
            encoded = json.dumps(message, separators=(",", ":")).encode("utf-8")
            sent_bytes += len(encoded)
            started = time.perf_counter()
            await sockets[0].send_json_to(message)
            responses = await asyncio.gather(*(socket.receive_json_from(timeout=10) for socket in sockets))
            latencies.append((time.perf_counter() - started) * 1000)
            if responses[0].get("type") != "saved":
                raise RuntimeError(f"sender did not receive saved acknowledgement: {responses[0]}")
            if any(response.get("type") != "document" for response in responses[1:]):
                raise RuntimeError("a collaborator did not receive the document delta")
            received_bytes += sum(
                len(json.dumps(response, separators=(",", ":")).encode("utf-8")) for response in responses
            )
        after = guest_room_metrics.snapshot()
        return {
            "collaborators": size,
            "rounds": rounds,
            "latency_ms": {
                "p50": percentile(latencies, 0.5),
                "p95": percentile(latencies, 0.95),
                "max": round(max(latencies, default=0), 2),
            },
            "payload_bytes": {
                "sent": sent_bytes,
                "received": received_bytes,
                "server_updates": after.get("updates", 0) - before.get("updates", 0),
                "server_update_payload": after.get("update_payload_bytes", 0)
                - before.get("update_payload_bytes", 0),
            },
            "expected_update_fanout": rounds * max(0, size - 1),
            "delta_updates": after.get("delta_updates", 0) - before.get("delta_updates", 0),
            "snapshot_updates": after.get("snapshot_updates", 0) - before.get("snapshot_updates", 0),
        }
    finally:
        await asyncio.gather(*(socket.disconnect() for socket in sockets), return_exceptions=True)
        await database_sync_to_async(room.delete)()


class Command(BaseCommand):
    help = "Measure guest whiteboard WebSocket transport at several collaborator counts."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--sizes",
            default="2,5,20,max",
            help="Comma-separated collaborator counts; use max for DRAWING_ROOM_MAX_COLLABORATORS.",
        )
        parser.add_argument("--rounds", type=int, default=10, help="Updates sent per collaborator size.")

    def handle(self, *args, **options) -> None:
        maximum = settings.DRAWING_ROOM_MAX_COLLABORATORS
        if options["rounds"] < 1:
            raise CommandError("--rounds must be positive")
        try:
            sizes = parse_sizes(options["sizes"], maximum)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        try:
            from doory.asgi import application

            report = asyncio.run(self._run(application, sizes, options["rounds"]))
        except Exception as exc:
            raise CommandError(f"drawing room benchmark failed: {exc}") from exc
        self.stdout.write(json.dumps(report, indent=2, sort_keys=True))

    @staticmethod
    async def _run(application: Any, sizes: list[int], rounds: int) -> dict[str, Any]:
        return {
            "protocol": 2,
            "channel_layer": settings.CHANNEL_LAYERS.get("default", {}).get("BACKEND", "unknown"),
            "cases": [await _run_case(application, size, rounds) for size in sizes],
        }
