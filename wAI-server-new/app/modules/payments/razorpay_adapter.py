from __future__ import annotations

import hmac
import asyncio
from hashlib import sha256
from typing import Any

import httpx
import razorpay
import razorpay.errors


class RazorpayAdapter:
    def __init__(
        self,
        webhook_secret: str | None = None,
        *,
        key_id: str | None = None,
        key_secret: str | None = None,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.webhook_secret = webhook_secret
        self.key_id = key_id
        self.key_secret = key_secret
        self.http_client = http_client
        self._client = razorpay.Client(auth=(key_id, key_secret)) if key_id and key_secret else None

    async def create_order(self, *, amount: int, currency: str, receipt: str, notes: dict[str, Any] | None = None) -> dict[str, Any]:
        if amount < 100:
            raise ValueError("Minimum Razorpay order amount is 100 paise")
        if self._client is None:
            raise PermissionError("Razorpay key id/secret is not configured")
        try:
            return await asyncio.to_thread(
                self._client.order.create,
                {
                    "amount": amount,
                    "currency": currency,
                    "receipt": receipt[:40],
                    "notes": notes or {},
                },
            )
        except razorpay.errors.NoAuthorizationError as exc:
            raise PermissionError("Razorpay authentication failed")
        except razorpay.errors.BadRequestError as exc:
            raise ValueError(str(exc))

    async def fetch_payment(self, payment_id: str) -> dict[str, Any]:
        if self._client is None:
            raise PermissionError("Razorpay key id/secret is not configured")
        try:
            return await asyncio.to_thread(self._client.payment.fetch, payment_id)
        except razorpay.errors.NoAuthorizationError as exc:
            raise PermissionError("Razorpay authentication failed")

    async def capture_payment(self, payment_id: str, amount: int) -> dict[str, Any]:
        if self._client is None:
            raise PermissionError("Razorpay key id/secret is not configured")
        try:
            return await asyncio.to_thread(self._client.payment.capture, payment_id, amount)
        except razorpay.errors.NoAuthorizationError as exc:
            raise PermissionError("Razorpay authentication failed")
        except razorpay.errors.BadRequestError as exc:
            raise ValueError(str(exc))

    def verify_webhook(self, body: bytes, signature: str | None) -> bool:
        if not self.webhook_secret or not signature:
            return False
        digest = hmac.new(self.webhook_secret.encode("utf-8"), body, sha256).hexdigest()
        return hmac.compare_digest(digest, signature)

    def verify_payment_signature(self, *, order_id: str, payment_id: str, signature: str) -> bool:
        if not self.key_secret:
            return False
        message = f"{order_id}|{payment_id}".encode("utf-8")
        digest = hmac.new(self.key_secret.encode("utf-8"), message, sha256).hexdigest()
        return hmac.compare_digest(digest, signature)
