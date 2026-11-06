from __future__ import annotations

import asyncio
import json
import math
import secrets
from collections import defaultdict
from typing import Any

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings

from apps.collab.availability import realtime_enabled
from apps.collab.limits import TokenBucket, allow_connection_attempt

from .exceptions import RevisionConflict
from .models import Drawing
from .services import get_drawing_room_access, save_drawing_room_update, update_drawing
from .validators import InvalidDrawing, validate_drawing_document

_members: dict[str, set[str]] = defaultdict(set)
_room_members: dict[str, set[str]] = defaultdict(set)
_room_presence: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)


class DrawingConsumer(AsyncJsonWebsocketConsumer):
    """Owner-only live snapshots for whiteboards.

    REST remains the durable write path. A client publishes a document only after its REST PATCH succeeds;
    peers receive it immediately and can replace their clean local snapshot without competing with the REST
    save.
    """

    async def connect(self) -> None:
        self.drawing_id = self.scope["url_route"]["kwargs"]["drawing_id"]
        self.user = self.scope.get("user")
        self.group = f"doory.drawing.{self.drawing_id}"
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
        if kind not in {"publish", "update"}:
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

        if kind == "update":
            base_revision = content.get("base_revision")
            if not isinstance(base_revision, int) or base_revision < 1:
                await self.send_json({"type": "error", "code": "invalid_revision"})
                return
            try:
                drawing = await self._save(document, base_revision)
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
            revision = drawing["revision"]
            document = drawing["document"]
        else:
            current = await self._load()
            if current is None:
                await self.close(code=4404)
                return
            if current[1] != revision:
                await self.send_json({"type": "conflict", "revision": current[1], "document": current[0]})
                return

        await self.channel_layer.group_send(
            self.group,
            {
                "type": "drawing.document",
                "source": self.channel_name,
                "document": document,
                "revision": revision,
            },
        )

    async def drawing_document(self, event: dict[str, Any]) -> None:
        await self.send_json(
            {
                "type": "document",
                "document": event["document"],
                "revision": event["revision"],
                "source": event["source"],
            }
        )

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
        self.bucket = TokenBucket.from_settings()
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
        await self.channel_layer.group_send(
            self.group,
            {
                "type": "drawing.room_presence",
                "source": self.channel_name,
                "state": {"kind": "leave", "peer_id": self.peer_id, "count": len(members)},
            },
        )

    async def receive(
        self, text_data: str | None = None, bytes_data: bytes | None = None, **kwargs: Any
    ) -> None:
        size = len(bytes_data) if bytes_data is not None else len((text_data or "").encode("utf-8"))
        if not self.bucket.allow(size):
            await self.close(code=4429)
            return
        if bytes_data is not None or text_data is None:
            await self.close(code=4400)
            return
        if size > settings.REALTIME_MAX_FRAME_BYTES:
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
        if self.state == "authenticating":
            await self._authenticate(content)
            return
        if self.state != "active":
            return
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
                await self.channel_layer.group_send(
                    self.group,
                    {
                        "type": "drawing.room_presence",
                        "source": self.channel_name,
                        "state": state,
                    },
                )
            return
        if kind not in {"update", "publish"}:
            await self.send_json({"type": "error", "code": "unknown_message"})
            return
        if self.room_mode != "edit":
            await self.send_json({"type": "error", "code": "read_only", "message": "This room is view-only."})
            return
        document = content.get("document")
        client_id = content.get("client_id")
        if client_id is not None and (not isinstance(client_id, int) or client_id < 1):
            await self.send_json({"type": "error", "code": "invalid_client_id"})
            return
        try:
            validate_drawing_document(document, max_bytes=settings.MAX_DRAWING_DOCUMENT_BYTES)
            room = await self._save(document)
        except InvalidDrawing as exc:
            await self.send_json({"type": "error", "code": "invalid_document", "message": str(exc)})
            return
        if room is None:
            await self._close_room("closed_or_expired")
            return
        await self.send_json(
            {
                "type": "saved",
                "document": room["document"],
                "revision": room["revision"],
                "client_id": client_id,
            }
        )
        await self.channel_layer.group_send(
            self.group,
            {
                "type": "drawing.room_document",
                "source": self.channel_name,
                "document": room["document"],
                "revision": room["revision"],
            },
        )

    async def _authenticate(self, content: dict[str, Any]) -> None:
        if content.get("type") != "auth" or not isinstance(content.get("key"), str):
            await self.close(code=4401)
            return
        self.key = content["key"]
        snapshot = await self._load()
        if snapshot is None:
            await self.close(code=4404)
            return
        members = _room_members[self.group]
        if len(members) >= settings.REALTIME_MAX_CONNECTIONS_PER_DESIGN:
            await self.close(code=4429)
            return
        await self.channel_layer.group_add(self.group, self.channel_name)
        members.add(self.channel_name)
        self.room_mode = snapshot["mode"]
        _room_presence[self.group][self.peer_id] = {
            "peer_id": self.peer_id,
            "mode": self.room_mode,
            "cursor": None,
            "selection": [],
        }
        self.state = "active"
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
        await self.channel_layer.group_send(
            self.group,
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
        )

    async def drawing_room_document(self, event: dict[str, Any]) -> None:
        if event["source"] == self.channel_name:
            return
        await self.send_json(
            {
                "type": "document",
                "document": event["document"],
                "revision": event["revision"],
            }
        )

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
    def _save(self, document: dict) -> dict | None:
        room = save_drawing_room_update(self.room_id, self.key or "", document)
        return None if room is None else {"document": room.document, "revision": room.revision}
