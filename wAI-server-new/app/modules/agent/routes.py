from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.queue import publish_job
from app.core.response import json_response


router = APIRouter()


@router.post("/chat")
async def chat(request: Request, payload: dict):
    await publish_job(
        request.app.state.app_state,
        {"client_id": payload.get("client_id"), "prompt": payload.get("prompt")},
    )
    return json_response({"status": "queued"})
