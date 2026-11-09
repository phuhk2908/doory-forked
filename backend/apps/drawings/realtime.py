from __future__ import annotations

import asyncio
import json
import math
import secrets
import time
from collections import defaultdict
from typing import Any

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings

from apps.collab.availability import realtime_enabled
from apps.collab.limits import (
    TokenBucket,
    acquire_guest_room_slot,
    allow_connection_attempt,
    allow_guest_room_fanout,
    allow_guest_room_join,
    guest_room_client_ip,
    refresh_guest_room_slot,
    release_guest_room_slot,
)

from .events import drawing_group
from .exceptions import RevisionConflict
from .metrics import guest_room_metrics
from .models import Drawing
from .services import (
    get_drawing_room_access,
    record_drawing_room_event,
    save_drawing_room_update,
    update_drawing,
)
from .validators import InvalidDrawing, validate_drawing_delta, validate_drawing_document

REALTIME_PROTOCOL_VERSION = 2


def _protocol_version(value: Any) -> int:
    return REALTIME_PROTOCOL_VERSION if value == REALTIME_PROTOCOL_VERSION else 1


_members: dict[str, set[str]] = defaultdict(set)
_room_members: dict[str, set[str]] = defaultdict(set)
_room_presence: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)


class DrawingConsumer(AsyncJsonWebsocketConsumer):
    """Owner-only live snapshots for whiteboards.

    REST and the drawing service remain the durable write path. A committed document mutation emits one
    post-commit event; peers receive it immediately and can replace their clean local snapshot without
    competing with the durable save.
    """

    async def connect(self) -> None:
        self.drawing_id = self.scope["url_route"]["kwargs"]["drawing_id"]
        self.user = self.scope.get("user")
        self.group = drawing_group(self.drawing_id)
        self.protocol_version = 1
        if not realtime_enabled():
            await self.close(code=4403)
            return
        await self.accept()
        if self.user is None or not self.user.is_authenticated:
            await self.close(code=4401)
            return
        if not await database_sync_to_async(allow_connection_attempt)(self.user.pk):
            await self.close(code=4429)
            return
        members = _members[self.group]
        if len(members) >= settings.REALTIME_MAX_CONNECTIONS_PER_DESIGN:
            await self.close(code=4429)
            return
        self.bucket = TokenBucket.from_settings()
        snapshot = await self._load()
        if snapshot is None:
            await self.close(code=4404)
            return
        await self.channel_layer.group_add(self.group, self.channel_name)
        members.add(self.channel_name)
        await self._send_ready(snapshot)
        await self.channel_layer.group_send(
            self.group,
            {
                "type": "drawing.presence",
                "source": self.channel_name,
                "state": {"kind": "join", "count": len(_members[self.group])},
            },
        )

    async def disconnect(self, code: int) -> None:
        if not hasattr(self, "group"):
            return
        await self.channel_layer.group_discard(self.group, self.channel_name)
        members = _members.get(self.group)
        if members is not None:
            members.discard(self.channel_name)
            if not members:
                _members.pop(self.group, None)
            else:
                await self.channel_layer.group_send(
                    self.group,
                    {
                        "type": "drawing.presence",
                        "source": self.channel_name,
                        "state": {"kind": "leave", "count": len(members)},
                    },
                )

    async def receive(
        self, text_data: str | None = None, bytes_data: bytes | None = None, **kwargs: Any
    ) -> None:
        bucket = getattr(self, "bucket", None)
        if bucket is None:
            await self.close(code=4400)
            return
        size = len(bytes_data) if bytes_data is not None else len((text_data or "").encode("utf-8"))
        if not bucket.allow(size):
            await self.close(code=4429)
            return
        if bytes_data is not None or text_data is None:
            await self.close(code=4400)
            return
        if len(text_data.encode("utf-8")) > settings.REALTIME_MAX_FRAME_BYTES:
            await self.close(code=4409)
            return
        try:
            message = json.loads(text_data)
        except (TypeError, ValueError, RecursionError):
            await self.close(code=4400)
            return
        if not isinstance(message, dict):
            await self.close(code=4400)
            return
        await self.receive_json(message)

    async def receive_json(self, content: dict[str, Any], **kwargs: Any) -> None:
        kind = content.get("type")
        if kind == "hello":
            self.protocol_version = _protocol_version(content.get("protocol"))
            snapshot = await self._load()
            if snapshot is not None:
                await self._send_ready(snapshot)
            return
        if kind == "ping":
            await self.send_json({"type": "pong"})
            return
        if kind == "presence":
            state = content.get("state")
            if isinstance(state, dict):
                await self.channel_layer.group_send(
                    self.group,
                    {
                        "type": "drawing.presence",
                        "source": self.channel_name,
                        "state": state,
                    },
                )
            return
        if kind == "publish":
            # REST/service writes emit the committed event. Never fan out a client-supplied duplicate.
            return
        if kind != "update":
            await self.send_json({"type": "error", "code": "unknown_message"})
            return
        document = content.get("document")
        revision = content.get("revision")
        if not isinstance(revision, int) or revision < 1:
            await self.send_json({"type": "error", "code": "invalid_revision"})
            return
        try:
            validate_drawing_document(document, max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)
        except InvalidDrawing as exc:
            await self.send_json({"type": "error", "code": "invalid_document", "message": str(exc)})
            return

        base_revision = content.get("base_revision")
        if not isinstance(base_revision, int) or base_revision < 1:
            await self.send_json({"type": "error", "code": "invalid_revision"})
            return
        try:
            await self._save(document, base_revision)
        except RevisionConflict as exc:
            current = await self._load()
            await self.send_json(
                {
                    "type": "conflict",
                    "revision": exc.revision,
                    "document": current[0] if current else None,
                }
            )
            return

    async def drawing_document(self, event: dict[str, Any]) -> None:
        payload = {
            "type": "document",
            "revision": event["revision"],
            "source": event["source"],
        }
        if self.protocol_version >= REALTIME_PROTOCOL_VERSION and event.get("delta"):
            payload["delta"] = event["delta"]
        else:
            payload["document"] = event["document"]
        await self.send_json(payload)

    async def drawing_presence(self, event: dict[str, Any]) -> None:
        await self.send_json(
            {
                "type": "presence",
                "state": event["state"],
                "source": event["source"],
            }
        )

    async def _send_ready(self, snapshot: tuple[dict, int]) -> None:
        await self.send_json(
            {
                "type": "ready",
                "document": snapshot[0],
                "revision": snapshot[1],
                "peers": len(_members.get(self.group, set())),
            }
        )

    @database_sync_to_async
    def _load(self) -> tuple[dict, int] | None:
        drawing = (
            Drawing.objects.filter(
                pk=self.drawing_id,
                owner=self.user,
                trashed_at__isnull=True,
            )
            .only("document", "revision")
            .first()
        )
        return None if drawing is None else (drawing.document, drawing.revision)

    @database_sync_to_async
    def _save(self, document: dict, base_revision: int) -> dict:
        drawing = update_drawing(
            self.drawing_id,
            self.user,
            {"document": document, "base_revision": base_revision},
        )
        return {"document": drawing.document, "revision": drawing.revision}


class DrawingRoomConsumer(AsyncJsonWebsocketConsumer):
    """Anonymous room transport for share links.

    A room update is a validated document snapshot.  The client coalesces rapid local changes before
    sending, while the database merge keeps independent element edits from overwriting one another.
    The room key is authenticated in the first WebSocket frame and is never logged or placed in the
    WebSocket URL.
    """

    async def connect(self) -> None:
        self.room_id = self.scope["url_route"]["kwargs"]["room_id"]
        self.group = f"doory.drawing-room.{self.room_id}"
        self.state = "authenticating"
        self.key: str | None = None
        self.peer_id = secrets.token_urlsafe(6)
        self.room_mode: str | None = None
        self.client_id: str | None = None
        self.protocol_version = 1
        self.bucket = TokenBucket.guest_room_from_settings()
        self.client_ip = guest_room_client_ip(self.scope)
        self.member_slot = False
        if not realtime_enabled():
            await self.close(code=4403)
            return
        await self.accept()
        self._auth_timer = asyncio.create_task(self._auth_timeout())

    async def _auth_timeout(self) -> None:
        await asyncio.sleep(settings.REALTIME_AUTH_TIMEOUT_SECONDS)
        if self.state == "authenticating":
            await self.close(code=4408)

    async def disconnect(self, code: int) -> None:
        timer = getattr(self, "_auth_timer", None)
        if timer is not None:
            timer.cancel()
        if getattr(self, "state", None) != "active":
            return
        await self.channel_layer.group_discard(self.group, self.channel_name)
        if self.member_slot:
            await database_sync_to_async(release_guest_room_slot)(self.room_id)
            self.member_slot = False
        guest_room_metrics.close_connection(self.room_id)
        members = _room_members.get(self.group)
        if members is None:
            return
        members.discard(self.channel_name)
        presence = _room_presence.get(self.group)
        if presence is not None:
            presence.pop(self.peer_id, None)
        if not members:
            _room_members.pop(self.group, None)
            _room_presence.pop(self.group, None)
            return
        await self._fanout(
            {
                "type": "drawing.room_presence",
                "source": self.channel_name,
                "state": {"kind": "leave", "peer_id": self.peer_id, "count": len(members)},
            },
            len(members),
        )

    async def receive(
        self, text_data: str | None = None, bytes_data: bytes | None = None, **kwargs: Any
    ) -> None:
        size = len(bytes_data) if bytes_data is not None else len((text_data or "").encode("utf-8"))
        guest_room_metrics.record_message(size)
        if not self.bucket.allow(size):
            guest_room_metrics.record_dropped("rate_limited")
            await self.close(code=4429)
            return
        if bytes_data is not None or text_data is None:
            guest_room_metrics.record_invalid("frame")
            await self.close(code=4400)
            return
        if size > settings.REALTIME_MAX_FRAME_BYTES:
            guest_room_metrics.record_dropped("oversized")
            await self.close(code=4409)
            return
        try:
            message = json.loads(text_data)
        except (TypeError, ValueError, RecursionError):
            guest_room_metrics.record_invalid("json")
            await self.close(code=4400)
            return
        if not isinstance(message, dict):
            guest_room_metrics.record_invalid("message")
            await self.close(code=4400)
            return
        await self.receive_json(message, frame_size=size)

    async def receive_json(self, content: dict[str, Any], **kwargs: Any) -> None:
        if self.state == "authenticating":
            await self._authenticate(content)
            return
        if self.state != "active":
            return
        await database_sync_to_async(refresh_guest_room_slot)(self.room_id)
        kind = content.get("type")
        if kind == "ping":
            if await self._load() is None:
                await self._close_room("closed_or_expired")
                return
            await self.send_json({"type": "pong"})
            return
        if kind == "presence":
            state = self._clean_presence(content.get("state"))
            if state is not None:
                state = {
                    **state,
                    "kind": "update",
                    "peer_id": self.peer_id,
                    "mode": self.room_mode,
                    "count": len(_room_members.get(self.group, set())),
                }
                _room_presence[self.group][self.peer_id] = state
                await self._fanout(
                    {"type": "drawing.room_presence", "source": self.channel_name, "state": state},
                    len(_room_members.get(self.group, set())) - 1,
                )
            return
        if kind not in {"update", "publish"}:
            guest_room_metrics.record_invalid("type")
            await self.send_json({"type": "error", "code": "unknown_message"})
            return
        if self.room_mode != "edit":
            guest_room_metrics.record_dropped("read_only_update")
            await self.send_json({"type": "error", "code": "read_only", "message": "This room is view-only."})
            return
        recipients = max(0, len(_room_members.get(self.group, set())) - 1)
        if not await self._allow_fanout(recipients):
            guest_room_metrics.record_dropped("update")
            await self._reject(
                "fanout_rate_limited",
                "This room is receiving updates too quickly. Try again later.",
            )
            return
        started = time.perf_counter()
        frame_size = kwargs.get("frame_size")
        if not isinstance(frame_size, int) or isinstance(frame_size, bool):
            frame_size = len((await self.encode_json(content)).encode("utf-8"))
        document = content.get("document")
        delta = content.get("delta")
        client_id = content.get("client_id")
        if client_id is not None and (not isinstance(client_id, int) or client_id < 1):
            guest_room_metrics.record_invalid("client_id")
            await self.send_json({"type": "error", "code": "invalid_client_id"})
            return
        try:
            if (document is None) == (delta is None):
                raise InvalidDrawing("Provide exactly one drawing document or delta.")
            if document is not None:
                validate_drawing_document(document, max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)
                room = await self._save(document=document)
                update_kind = "snapshot"
            else:
                validate_drawing_delta(delta, max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)
                room = await self._save(delta=delta)
                update_kind = "delta"
        except InvalidDrawing as exc:
            guest_room_metrics.record_invalid("delta" if delta is not None else "update")
            await self.send_json(
                {
                    "type": "error",
                    "code": "invalid_delta" if delta is not None else "invalid_document",
                    "message": str(exc),
                }
            )
            return
        if room is None:
            guest_room_metrics.record_dropped("closed_room")
            await self._close_room("closed_or_expired")
            return
        guest_room_metrics.record_update(
            (time.perf_counter() - started) * 1000,
            frame_size,
            kind=update_kind,
        )
        guest_room_metrics.record_fanout(recipients)
        await self.send_json(
            {
                "type": "saved",
                "document": room["document"],
                "revision": room["revision"],
                "client_id": client_id,
            }
        )
        if room["changed"]:
            await self.channel_layer.group_send(
                self.group,
                {
                    "type": "drawing.room_document",
                    "source": self.channel_name,
                    "document": room["document"],
                    "delta": room["delta"],
                    "revision": room["revision"],
                },
            )

    async def _authenticate(self, content: dict[str, Any]) -> None:
        if content.get("type") != "auth" or not isinstance(content.get("key"), str):
            await self.close(code=4401)
            return
        if not await database_sync_to_async(allow_guest_room_join)(self.room_id, self.client_ip):
            guest_room_metrics.record_dropped("join_rate_limited")
            await self._reject("join_rate_limited", "Too many attempts to join this room. Try again later.")
            return
        client_id = content.get("client_id")
        if client_id is not None and (not isinstance(client_id, str) or len(client_id) > 64):
            guest_room_metrics.record_invalid("client_id")
            client_id = None
        self.client_id = client_id
        self.protocol_version = _protocol_version(content.get("protocol"))
        self.key = content["key"]
        snapshot = await self._load()
        if snapshot is None:
            await self.close(code=4404)
            return
        members = _room_members[self.group]
        if not await database_sync_to_async(acquire_guest_room_slot)(self.room_id):
            await self._reject("room_full", "This room has reached its collaborator limit.")
            return
        await self.channel_layer.group_add(self.group, self.channel_name)
        members.add(self.channel_name)
        self.member_slot = True
        self.room_mode = snapshot["mode"]
        _room_presence[self.group][self.peer_id] = {
            "peer_id": self.peer_id,
            "mode": self.room_mode,
            "cursor": None,
            "selection": [],
        }
        self.state = "active"
        await database_sync_to_async(record_drawing_room_event)(
            self.room_id,
            "joined",
            client_ip=self.client_ip,
        )
        guest_room_metrics.open_connection(self.room_id, self.client_id)
        guest_room_metrics.ensure_heartbeat()
        timer = getattr(self, "_auth_timer", None)
        if timer is not None:
            timer.cancel()
        await self.send_json(
            {
                "type": "ready",
                "document": snapshot["document"],
                "revision": snapshot["revision"],
                "peers": len(members),
                "peer_id": self.peer_id,
                "mode": self.room_mode,
                "can_edit": self.room_mode == "edit",
                "expires_at": snapshot["expires_at"],
                "presence": [
                    value for key, value in _room_presence[self.group].items() if key != self.peer_id
                ],
            }
        )
        await self._fanout(
            {
                "type": "drawing.room_presence",
                "source": self.channel_name,
                "state": {
                    "kind": "join",
                    "peer_id": self.peer_id,
                    "mode": self.room_mode,
                    "cursor": None,
                    "selection": [],
                    "count": len(members),
                },
            },
            len(members) - 1,
        )

    async def _allow_fanout(self, recipients: int) -> bool:
        return await database_sync_to_async(allow_guest_room_fanout)(self.room_id, recipients)

    async def _fanout(self, event: dict[str, Any], recipients: int) -> bool:
        if not await self._allow_fanout(recipients):
            guest_room_metrics.record_dropped("fanout_rate_limited")
            return False
        guest_room_metrics.record_fanout(recipients)
        await self.channel_layer.group_send(self.group, event)
        return True

    async def send_json(self, content: Any, close: bool = False) -> None:
        text = await self.encode_json(content)
        guest_room_metrics.record_outbound(len(text.encode("utf-8")))
        await super().send(text_data=text, close=close)

    async def _reject(self, code: str, message: str) -> None:
        await self.send_json({"type": "error", "code": code, "message": message})
        await self.close(code=4429)

    async def drawing_room_document(self, event: dict[str, Any]) -> None:
        if event["source"] == self.channel_name:
            return
        payload = {"type": "document", "revision": event["revision"]}
        if self.protocol_version >= REALTIME_PROTOCOL_VERSION and event.get("delta"):
            payload["delta"] = event["delta"]
        else:
            payload["document"] = event["document"]
        await self.send_json(payload)

    async def drawing_room_presence(self, event: dict[str, Any]) -> None:
        await self.send_json({"type": "presence", "state": event["state"]})

    async def drawing_room_closed(self, event: dict[str, Any]) -> None:
        await self._close_room(event.get("reason", "closed"))

    async def drawing_room_renamed(self, event: dict[str, Any]) -> None:
        await self.send_json({"type": "room_title", "title": event.get("title", "Untitled whiteboard")})

    async def _close_room(self, reason: str) -> None:
        await self.send_json({"type": "closed", "reason": reason})
        await self.close(code=4403)

    @staticmethod
    def _clean_presence(value: Any) -> dict[str, Any] | None:
        if not isinstance(value, dict):
            return None
        cursor = value.get("cursor")
        if cursor is not None:
            if not isinstance(cursor, dict):
                return None
            x, y = cursor.get("x"), cursor.get("y")
            if (
                not isinstance(x, (int, float))
                or isinstance(x, bool)
                or not isinstance(y, (int, float))
                or isinstance(y, bool)
                or not math.isfinite(x)
                or not math.isfinite(y)
                or abs(x) > 10_000_000
                or abs(y) > 10_000_000
            ):
                return None
            cursor = {"x": x, "y": y}
        selection = value.get("selection", [])
        if not isinstance(selection, list) or len(selection) > 100:
            return None
        if any(not isinstance(item, str) or len(item) > 128 for item in selection):
            return None
        return {"cursor": cursor, "selection": selection}

    @database_sync_to_async
    def _load(self) -> dict[str, Any] | None:
        access = get_drawing_room_access(self.room_id, self.key)
        if access is None:
            return None
        room, mode = access
        return {
            "document": room.document,
            "revision": room.revision,
            "mode": mode,
            "expires_at": room.expires_at.isoformat(),
        }

    @database_sync_to_async
    def _save(self, *, document: dict | None = None, delta: dict | None = None) -> dict | None:
        mutation = save_drawing_room_update(
            self.room_id,
            self.key or "",
            document=document,
            delta=delta,
        )
        if mutation is None:
            return None
        return {
            "document": mutation.document,
            "revision": mutation.revision,
            "delta": mutation.delta,
            "changed": mutation.changed,
        }
