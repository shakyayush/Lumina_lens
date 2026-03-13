import json
import asyncio
import time
import os
from typing import Dict, List
from fastapi import WebSocket
import redis.asyncio as redis
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

# Read Redis URL from environment (supports rediss:// for TLS, e.g. Upstash)
# Falls back to localhost if REDIS_URL is not set.
_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_client = redis.from_url(_REDIS_URL, decode_responses=True)

# How often (seconds) to re-probe Redis after initial state is known.
_REDIS_RECHECK_INTERVAL = 30.0


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.pubsub_tasks: Dict[str, asyncio.Task] = {}
        # None = unknown, True = reachable, False = unreachable
        self.redis_available: bool | None = None
        self._redis_check_ts: float = 0.0

    async def _ensure_redis_availability(self) -> bool:
        """
        Determine whether Redis is reachable.
        Re-checked every _REDIS_RECHECK_INTERVAL seconds so that a
        mid-session Redis failure is detected and local fallback kicks in.
        """
        now = time.monotonic()
        if self.redis_available is None or (now - self._redis_check_ts) > _REDIS_RECHECK_INTERVAL:
            try:
                await asyncio.wait_for(redis_client.ping(), timeout=1.0)
                self.redis_available = True
            except Exception:
                self.redis_available = False
            self._redis_check_ts = now
        return self.redis_available

    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []

            # Start a Redis subscriber for this session if Redis is available
            try:
                if not await self._ensure_redis_availability():
                    raise RuntimeError("Redis unavailable")
                pubsub = redis_client.pubsub()
                await pubsub.subscribe(f"session:{session_id}")
                task = asyncio.create_task(self._listen_to_redis(session_id, pubsub))
                self.pubsub_tasks[session_id] = task
            except Exception:
                # Redis not running — fine for MVP; local broadcast still works
                pass

        self.active_connections[session_id].append(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket):
        if session_id in self.active_connections:
            if websocket in self.active_connections[session_id]:
                self.active_connections[session_id].remove(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]
                task = self.pubsub_tasks.pop(session_id, None)
                if task:
                    task.cancel()

    async def _listen_to_redis(self, session_id: str, pubsub):
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    data = json.loads(message["data"])
                    await self._broadcast_local(session_id, data)
        except asyncio.CancelledError:
            await pubsub.unsubscribe(f"session:{session_id}")
        except Exception:
            pass

    async def broadcast(self, session_id: str, message: dict):
        """Broadcast either via Redis pub/sub (multi-node) or locally (single-node fallback)."""
        if await self._ensure_redis_availability():
            try:
                await redis_client.publish(f"session:{session_id}", json.dumps(message))
                return
            except Exception:
                # Redis dropped mid-session — mark as unavailable and fall through
                self.redis_available = False
                self._redis_check_ts = 0.0  # Force re-check next time

        await self._broadcast_local(session_id, message)

    async def _broadcast_local(self, session_id: str, message: dict):
        if session_id in self.active_connections:
            for connection in list(self.active_connections[session_id]):
                try:
                    await connection.send_json(message)
                except Exception:
                    self.disconnect(session_id, connection)


ws_manager = ConnectionManager()
