from typing import Any

from fastapi.responses import JSONResponse

from app.core.bson import serialize_bson


def json_response(payload: dict[str, Any]) -> JSONResponse:
    return JSONResponse(serialize_bson(payload))
