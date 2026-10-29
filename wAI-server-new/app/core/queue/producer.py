from __future__ import annotations

import json
from typing import Any

import aio_pika

from app.core.state import AppState


async def publish_job(state: AppState, payload: dict[str, Any]) -> None:
    if state.amqp is None:
        return
    channel = await state.amqp.channel()
    await channel.default_exchange.publish(
        aio_pika.Message(json.dumps(payload).encode("utf-8")),
        routing_key="LLM_INFERENCE",
    )
