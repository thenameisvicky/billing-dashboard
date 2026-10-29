from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import aio_pika
import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase


@dataclass
class Config:
    amqp_uri: str
    mongo_uri: str
    mongo_database: str
    ollama_url: str
    jwt_secret: str
    public_token_secret: str
    app_base_url: str
    whatsapp_provider_url: str | None = None
    whatsapp_provider_token: str | None = None
    razorpay_key_id: str | None = None
    razorpay_key_secret: str | None = None
    razorpay_webhook_secret: str | None = None
    report_timezone: str = "Asia/Kolkata"


@dataclass
class AppState:
    config: Config
    db: AsyncIOMotorDatabase
    http_client: httpx.AsyncClient
    amqp: aio_pika.RobustConnection | None = None
    clients: dict[str, Any] = field(default_factory=dict)
