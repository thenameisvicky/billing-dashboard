from __future__ import annotations

import secrets
from typing import Any

import jwt


def create_public_token(company_id: str, secret: str) -> str:
    """Create an opaque, signed token for a public company resource."""
    return jwt.encode(
        {
            "company_id": company_id,
            "jti": secrets.token_urlsafe(24),
            "token_type": "public",
        },
        secret,
        algorithm="HS256",
    )


def decode_public_token(token: str, secret: str) -> dict[str, Any]:
    claims: dict[str, Any] = jwt.decode(token, secret, algorithms=["HS256"])
    if claims.get("token_type") != "public" or not isinstance(claims.get("company_id"), str):
        raise jwt.InvalidTokenError("Invalid public token claims")
    return claims
