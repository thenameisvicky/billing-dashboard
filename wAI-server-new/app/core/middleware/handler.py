from __future__ import annotations

import hmac
import time
from hashlib import sha256
from typing import Any

import jwt
from bson import ObjectId
from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.middleware.utils import decode_public_token


PUBLIC_PATHS = {"/api/main/signup", "/api/main/login"}
PUBLIC_PREFIXES = (
)
PUBLIC_TOKEN_PREFIXES = (
    "/api/main/pay/",
    "/api/main/payments/create-order/",
    "/api/main/payments/verify-checkout/",
    "/api/main/payments/checkout-failure/",
)
PUBLIC_TOKEN_HEADER_PATHS = {
    "/api/main/public/payments/razorpayEvents",
}

PUBLIC_TOKEN_HEADER = b"x-public-company-id"
PUBLIC_TOKEN_REQUEST_HEADER = b"x-public-token"
RAZORPAY_SIGNATURE_HEADER = b"x-razorpay-signature"


def public_token_from_path(request: Request) -> str | None:
    """Return the token path parameter for public payment endpoints."""
    path = request.url.path
    for prefix in PUBLIC_TOKEN_PREFIXES:
        if path.startswith(prefix):
            token = path.removeprefix(prefix).split("/", 1)[0]
            return token or None
    return None


def attach_public_company(request: Request, company_id: str) -> None:
    """Make verified public-token context available to downstream handlers."""
    headers = [(key, value) for key, value in request.scope["headers"] if key.lower() != PUBLIC_TOKEN_HEADER]
    headers.append((PUBLIC_TOKEN_HEADER, company_id.encode("utf-8")))
    request.scope["headers"] = headers
    request.state.public_company_id = company_id


def request_header(request: Request, header_name: bytes) -> str | None:
    for key, value in request.scope["headers"]:
        if key.lower() == header_name:
            return value.decode("utf-8")
    return None


def validate_public_token(request: Request, token: str) -> JSONResponse | None:
    try:
        claims = decode_public_token(
            token,
            request.app.state.app_state.config.public_token_secret,
        )
        attach_public_company(request, claims["company_id"])
    except Exception:
        return JSONResponse({"status": "error", "message": "Invalid public token"}, status_code=401)
    return None


async def verify_razorpay_webhook(request: Request) -> JSONResponse | None:
    signature = request_header(request, RAZORPAY_SIGNATURE_HEADER)
    secret = request.app.state.app_state.config.razorpay_webhook_secret
    if not signature or not secret:
        return JSONResponse(
            {"status": "error", "message": "Invalid Razorpay webhook signature"},
            status_code=401,
        )

    expected = hmac.new(secret.encode("utf-8"), await request.body(), sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return JSONResponse(
            {"status": "error", "message": "Invalid Razorpay webhook signature"},
            status_code=401,
        )
    return None


async def auth_middleware(request: Request, call_next):
    public_token = public_token_from_path(request)
    if request.url.path.startswith(PUBLIC_TOKEN_PREFIXES):
        if public_token is None:
            return JSONResponse({"status": "error", "message": "Invalid public token"}, status_code=401)
        error = validate_public_token(request, public_token)
        if error is not None:
            return error
        return await call_next(request)

    if request.url.path in PUBLIC_TOKEN_HEADER_PATHS:
        error = await verify_razorpay_webhook(request)
        if error is not None:
            return error
        return await call_next(request)

    if request.url.path in PUBLIC_PATHS or request.url.path.startswith(PUBLIC_PREFIXES):
        return await call_next(request)

    if not request.url.path.startswith("/api/main"):
        return await call_next(request)

    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return JSONResponse(
            {"status": "error", "message": "Missing or invalid token"},
            status_code=401,
        )

    token = auth_header.removeprefix("Bearer ").strip()
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            request.app.state.app_state.config.jwt_secret,
            algorithms=["HS256"],
            options={"verify_exp": False},
        )
    except Exception:
        return JSONResponse({"status": "error", "message": "Invalid token"}, status_code=401)

    if int(claims.get("exp", 0)) < int(time.time()):
        return JSONResponse(
            {"status": "error", "code": "TOKEN_EXPIRED", "message": "Token expired, please log in again"},
            status_code=401,
        )

    try:
        user_id = ObjectId(str(claims["sub"]))
        company_id = str(claims["company_id"])
    except Exception:
        return JSONResponse({"status": "error", "message": "Invalid token subject"}, status_code=401)

    user = await request.app.state.app_state.db.userdetails.find_one(
        {"_id": user_id, "company_id": company_id}
    )
    if not user:
        return JSONResponse({"status": "error", "message": "User not found"}, status_code=401)

    request.state.user = user
    return await call_next(request)
