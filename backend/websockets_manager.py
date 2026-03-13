import json
import asyncio
from typing import Dict, List
from fastapi import WebSocket
import redis.asyncio as redis

# Optional Redis client for scalable Pub/Sub. 
# It will gracefully fallback to local memory if Redis isn't running.
redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.pubsub_tasks: Dict[str, asyncio.Task] = {}

    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
            
            # Start a Redis subscriber for this session
            try:
                # Test connection heartbeat
                await redis_client.ping()
                pubsub = redis_client.pubsub()
                await pubsub.subscribe(f"session:{session_id}")
                task = asyncio.create_task(self._listen_to_redis(session_id, pubsub))
                self.pubsub_tasks[session_id] = task
            except Exception:
                # If Redis is not running locally, that's fine for MVP
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
        """Broadcast either via Redis (so all nodes see it) or locally."""
        try:
            await redis_client.ping()
            await redis_client.publish(f"session:{session_id}", json.dumps(message))
            return
        except Exception:
            # Fallback to local broadcast if Redis is unreachable
            await self._broadcast_local(session_id, message)

    async def _broadcast_local(self, session_id: str, message: dict):
        if session_id in self.active_connections:
            for connection in list(self.active_connections[session_id]):
                try:
                    await connection.send_json(message)
                except Exception:
                    self.disconnect(session_id, connection)

ws_manager = ConnectionManager()
