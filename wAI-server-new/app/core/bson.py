from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_object_id(value: Any) -> ObjectId:
    if isinstance(value, ObjectId):
        return value
    if isinstance(value, dict):
        value = value.get("$oid") or value.get("oid") or value.get("_id")
    return ObjectId(str(value))


def parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, dict):
        raw = value.get("$date")
        if isinstance(raw, dict) and "$numberLong" in raw:
            return datetime.fromtimestamp(int(raw["$numberLong"]) / 1000, tz=timezone.utc)
        if isinstance(raw, (int, float)):
            return datetime.fromtimestamp(raw / 1000, tz=timezone.utc)
        if isinstance(raw, str):
            value = raw
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    return None


def serialize_bson(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return {"$oid": str(value)}
    if isinstance(value, datetime):
        millis = int(value.timestamp() * 1000)
        return {"$date": {"$numberLong": str(millis)}}
    if isinstance(value, list):
        return [serialize_bson(item) for item in value]
    if isinstance(value, dict):
        return {key: serialize_bson(item) for key, item in value.items()}
    return value


def clean_none(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}
