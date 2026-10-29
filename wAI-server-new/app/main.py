from __future__ import annotations

import argparse
import asyncio
import os
from contextlib import asynccontextmanager

import aio_pika
import httpx
import uvicorn
from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient

from app.api.router import create_api_router
from app.core.middleware.handler import auth_middleware
from app.core.queue.consumer import consume_jobs
from app.core.state import AppState, Config


def load_dotenv_file() -> None:
    env_path = os.path.join(os.getcwd(), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as env_file:
        for line in env_file:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def parse_args() -> Config:
    load_dotenv_file()
    parser = argparse.ArgumentParser()
    parser.add_argument("--amqp-uri", default=os.getenv("AMQP_URI"))
    parser.add_argument("--mongo-uri", default=os.getenv("MONGO_URI"))
    parser.add_argument("--mongo-database", default=os.getenv("MONGO_DATABASE"))
    parser.add_argument("--ollama-url", default=os.getenv("OLLAMA_URL"))
    parser.add_argument("--jwt-secret", default=os.getenv("JWT_SECRET"))
    parser.add_argument("--public-token-secret", default=os.getenv("PUBIC_TOKEN_SECRET"))
    parser.add_argument("--app-base-url", default=os.getenv("APP_BASE_URL"))
    parser.add_argument("--whatsapp-provider-url", default=os.getenv("WHATSAPP_PROVIDER_URL"))
    parser.add_argument("--whatsapp-provider-token", default=os.getenv("WHATSAPP_PROVIDER_TOKEN"))
    parser.add_argument("--razorpay-key-id", default=os.getenv("RAZORPAY_KEY_ID"))
    parser.add_argument("--razorpay-key-secret", default=os.getenv("RAZORPAY_KEY_SECRET"))
    parser.add_argument("--razorpay-webhook-secret", default=os.getenv("RAZORPAY_WEBHOOK_SECRET"))
    parser.add_argument("--report-timezone", default=os.getenv("REPORT_TIMEZONE", "Asia/Kolkata"))
    args = parser.parse_args()
    missing = [
        name
        for name, value in {
            "AMQP_URI": args.amqp_uri,
            "MONGO_URI": args.mongo_uri,
            "MONGO_DATABASE": args.mongo_database,
            "OLLAMA_URL": args.ollama_url,
            "JWT_SECRET": args.jwt_secret,
            "PUBIC_TOKEN_SECRET": args.public_token_secret,
            "RAZORPAY_WEBHOOK_SECRET": args.razorpay_webhook_secret,
            "APP_BASE_URL": args.app_base_url,
        }.items()
        if not value
    ]
    if missing:
        parser.error(f"Missing required configuration: {', '.join(missing)}")
    return Config(
        amqp_uri=args.amqp_uri,
        mongo_uri=args.mongo_uri,
        mongo_database=args.mongo_database,
        ollama_url=args.ollama_url,
        jwt_secret=args.jwt_secret,
        public_token_secret=args.public_token_secret,
        app_base_url=args.app_base_url,
        whatsapp_provider_url=args.whatsapp_provider_url,
        whatsapp_provider_token=args.whatsapp_provider_token,
        razorpay_key_id=args.razorpay_key_id,
        razorpay_key_secret=args.razorpay_key_secret,
        razorpay_webhook_secret=args.razorpay_webhook_secret,
        report_timezone=args.report_timezone,
    )


def create_app(config: Config | None = None) -> FastAPI:
    if config is None:
        config = parse_args()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        mongo = AsyncIOMotorClient(config.mongo_uri)
        db = mongo["wai"]
        await db.command("ping")
        http_client = httpx.AsyncClient(timeout=None)
        amqp = await aio_pika.connect_robust(config.amqp_uri)
        state = AppState(config=config, db=db, http_client=http_client, amqp=amqp)
        app.state.app_state = state
        consumer_task = asyncio.create_task(consume_jobs(state))
        try:
            yield
        finally:
            consumer_task.cancel()
            await http_client.aclose()
            await amqp.close()
            mongo.close()

    app = FastAPI(lifespan=lifespan)
    app.middleware("http")(auth_middleware)
    app.include_router(create_api_router(), prefix="/api/main")
    return app


def main() -> None:
    uvicorn.run(create_app(), host="0.0.0.0", port=8082)


if __name__ == "__main__":
    main()
