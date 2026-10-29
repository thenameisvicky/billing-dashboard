from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect


router = APIRouter()


@router.websocket("/ws")
async def websocket_handler(websocket: WebSocket) -> None:
    await websocket.accept()
    state = websocket.app.state.app_state
    client_id = str(uuid.uuid4())
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
    state.clients[client_id] = queue
    await websocket.send_text(f"CLIENT_ID:{client_id}")

    async def sender() -> None:
        while True:
            message = await queue.get()
            await websocket.send_text(message)

    task = asyncio.create_task(sender())
    try:
        while True:
            await websocket.receive()
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
        state.clients.pop(client_id, None)
