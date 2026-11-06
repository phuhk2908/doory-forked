from __future__ import annotations

import asyncio
import logging
import math
import os
import socket
from collections import Counter, deque
from collections.abc import Iterable
from typing import Any

from channels.db import database_sync_to_async
from channels.layers import InMemoryChannelLayer, get_channel_layer

from apps.collab import store

log = logging.getLogger("doory.drawings")

_LATENCY_BUCKETS = (10, 25, 50, 100, 250, 500, 1_000, 2_000, 5_000)
_HEARTBEAT_SECONDS = 10.0
_INSTANCE_PREFIX = "drawing-room:"
_SEEN_CLIENT_LIMIT = 4_096


def _latency_summary(
    count: int, total: float, maximum: float, buckets: Counter[str]
) -> dict[str, float | int]:
    if count == 0:
        return {"count": 0, "average_ms": 0, "p50_ms": 0, "p95_ms": 0, "max_ms": 0}

    def percentile(fraction: float) -> int:
        target = max(1, math.ceil(count * fraction))
        seen = 0
        for upper_bound in _LATENCY_BUCKETS:
            seen += buckets[str(upper_bound)]
            if seen >= target:
                return upper_bound
        return _LATENCY_BUCKETS[-1]

    return {
        "count": count,
        "average_ms": round(total / count, 2),
        "p50_ms": percentile(0.5),
        "p95_ms": percentile(0.95),
        "max_ms": round(maximum, 2),
    }


def aggregate_guest_room_metrics(snapshots: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Combine the recent guest-room worker snapshots for the staff stats endpoint."""
    result: dict[str, Any] = {"active_rooms": 0, "active_connections": 0}
    count = 0
    total = 0.0
    maximum = 0.0
    buckets: Counter[str] = Counter()
    for snapshot in snapshots:
        for key, value in snapshot.items():
            if key == "update_latency_ms":
                latency = value if isinstance(value, dict) else {}
                count += int(latency.get("count", 0))
                total += float(latency.get("total_ms", 0))
                maximum = max(maximum, float(latency.get("max_ms", 0)))
                raw_buckets = latency.get("buckets", {})
                if isinstance(raw_buckets, dict):
                    buckets.update({str(name): int(amount) for name, amount in raw_buckets.items()})
            elif isinstance(value, int) and not isinstance(value, bool):
                result[key] = result.get(key, 0) + value
    connections = result.get("connections", 0)
    result["reconnect_rate"] = round(result.get("reconnects", 0) / connections, 4) if connections else 0
    result["update_latency_ms"] = _latency_summary(count, total, maximum, buckets)
    return result


class GuestRoomMetrics:
    """Small process-local counters published through the existing collab heartbeat table."""

    def __init__(self, *, instance: str | None = None) -> None:
        host = socket.gethostname()[:48]
        self.instance = instance or f"{_INSTANCE_PREFIX}{host}:{os.getpid()}"
        self._room_connections: Counter[str] = Counter()
        self._seen_clients: set[str] = set()
        self._seen_client_order: deque[str] = deque(maxlen=_SEEN_CLIENT_LIMIT)
        self._counters: Counter[str] = Counter()
        self._latency_buckets: Counter[str] = Counter()
        self._latency_total_ms = 0.0
        self._latency_max_ms = 0.0
        self._heartbeat_task: asyncio.Task[None] | None = None

    def open_connection(self, room_id: object, client_id: str | None = None) -> None:
        self._room_connections[str(room_id)] += 1
        self._counters["connections"] += 1
        if client_id:
            if client_id in self._seen_clients:
                self._counters["reconnects"] += 1
            elif len(self._seen_client_order) == self._seen_client_order.maxlen:
                self._seen_clients.discard(self._seen_client_order.popleft())
            if client_id not in self._seen_clients:
                self._seen_clients.add(client_id)
                self._seen_client_order.append(client_id)

    def close_connection(self, room_id: object) -> None:
        room_id = str(room_id)
        if self._room_connections[room_id] <= 1:
            self._room_connections.pop(room_id, None)
        else:
            self._room_connections[room_id] -= 1
        self._counters["disconnects"] += 1
        if not self._room_connections:
            self.stop_heartbeat()

    def record_message(self, size: int) -> None:
        self._counters["messages"] += 1
        self._counters["inbound_bytes"] += max(0, size)

    def record_outbound(self, size: int) -> None:
        self._counters["outbound_messages"] += 1
        self._counters["outbound_bytes"] += max(0, size)

    def record_fanout(self, recipients: int) -> None:
        self._counters["fanout_deliveries"] += max(0, recipients)

    def record_update(self, duration_ms: float, payload_bytes: int) -> None:
        duration_ms = max(0.0, duration_ms)
        self._counters["updates"] += 1
        self._counters["update_payload_bytes"] += max(0, payload_bytes)
        self._latency_total_ms += duration_ms
        self._latency_max_ms = max(self._latency_max_ms, duration_ms)
        upper_bound = next(
            (bound for bound in _LATENCY_BUCKETS if duration_ms <= bound), _LATENCY_BUCKETS[-1]
        )
        self._latency_buckets[str(upper_bound)] += 1

    def record_invalid(self, reason: str) -> None:
        self._counters[f"invalid_{reason}"] += 1

    def record_dropped(self, reason: str) -> None:
        self._counters[f"dropped_{reason}"] += 1

    def snapshot(self) -> dict[str, Any]:
        return {
            "active_rooms": len(self._room_connections),
            "active_connections": sum(self._room_connections.values()),
            **dict(self._counters),
            "update_latency_ms": {
                "count": sum(self._latency_buckets.values()),
                "total_ms": round(self._latency_total_ms, 2),
                "max_ms": round(self._latency_max_ms, 2),
                "buckets": dict(self._latency_buckets),
            },
        }

    def ensure_heartbeat(self) -> None:
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(self._heartbeat(), name="drawing-room-metrics")

    def stop_heartbeat(self) -> None:
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None

    async def _heartbeat(self) -> None:
        try:
            while self._room_connections:
                await self._write_heartbeat()
                await asyncio.sleep(_HEARTBEAT_SECONDS)
        except asyncio.CancelledError:
            raise

    async def _write_heartbeat(self) -> None:
        layer = get_channel_layer()
        try:
            await database_sync_to_async(store.heartbeat)(
                self.instance,
                not isinstance(layer, InMemoryChannelLayer),
                {"guest_room": self.snapshot()},
                [],
            )
        except Exception:
            log.exception("guest room metrics heartbeat failed")


guest_room_metrics = GuestRoomMetrics()
