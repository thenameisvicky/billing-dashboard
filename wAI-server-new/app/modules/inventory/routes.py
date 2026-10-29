from __future__ import annotations

from bson import ObjectId
from fastapi import APIRouter, Request

from app.core.bson import clean_none, now_utc, parse_datetime
from app.core.response import json_response


router = APIRouter()


INTEGER_FIELDS = {"manufac_units", "total_sub_units", "conversion_factor", "unit_price", "cost_price", "selling_price", "mrp", "alert_threshold"}


def normalize_inventory_payload(payload: dict, *, create: bool) -> dict:
    normalized = clean_none(payload)
    for field in INTEGER_FIELDS:
        if field in normalized:
            normalized[field] = int(round(float(normalized[field])))
    for field in ("mfg_date", "exp_date"):
        if field in normalized:
            normalized[field] = parse_datetime(normalized[field])
    if create:
        normalized["currency"] = "INR"
    return normalized


@router.post("/inventory/items")
async def create_inventory_item(request: Request, payload: dict):
    user = request.state.user
    db = request.app.state.app_state.db
    exists = await db.newinventorydetails.find_one(
        {
            "company_id": user["company_id"],
            "code": payload.get("code"),
            "hsn_code": payload.get("hsn_code"),
            "uqc_code": payload.get("uqc_code"),
            "is_active": True,
        }
    )
    if exists is not None:
        return json_response({"status": "error", "message": "Item code already exists"})

    now = now_utc()
    item = normalize_inventory_payload(payload, create=True)
    item.update({"_id": ObjectId(), "company_id": user["company_id"], "entered_at": now, "updated_at": now, "is_active": True})
    result = await db.newinventorydetails.insert_one(item)
    await db.eventdetails.insert_one(
        {
            "_id": ObjectId(),
            "entity_id": str(item["_id"]),
            "entity_type": "InventoryItem",
            "event_type": "InventoryItemCreated",
            "metadata": None,
            "created_at": now,
            "company_id": user["company_id"],
        }
    )
    return json_response({"status": "success", "id": result.inserted_id})


@router.get("/inventory/items")
async def get_inventory_items(request: Request):
    user = request.state.user
    cursor = request.app.state.app_state.db.newinventorydetails.find(
        {"company_id": user["company_id"], "is_active": True}
    )
    return json_response({"status": "success", "data": await cursor.to_list(length=None)})


@router.get("/inventory/items/{item_id}")
async def get_inventory_item(request: Request, item_id: str):
    try:
        object_id = ObjectId(item_id)
    except Exception:
        return json_response({"status": "error", "message": "Invalid inventory item Id"})
    user = request.state.user
    item = await request.app.state.app_state.db.newinventorydetails.find_one(
        {"_id": object_id, "company_id": user["company_id"], "is_active": True}
    )
    if item is None:
        return json_response({"status": "error", "message": "Inventory item not found"})
    return json_response({"status": "success", "data": item})


@router.patch("/inventory/items/{item_id}")
async def update_inventory_item(request: Request, item_id: str, payload: dict):
    try:
        object_id = ObjectId(item_id)
    except Exception:
        return json_response({"status": "error", "message": "Invalid inventory item Id"})

    cleaned = normalize_inventory_payload(payload, create=False)
    if not cleaned:
        return json_response({"status": "success", "modified_count": 0})
    cleaned["updated_at"] = now_utc()
    user = request.state.user
    result = await request.app.state.app_state.db.newinventorydetails.update_one(
        {"_id": object_id, "company_id": user["company_id"], "is_active": True},
        {"$set": cleaned},
    )
    if result.modified_count > 0:
        await request.app.state.app_state.db.eventdetails.insert_one(
            {
                "_id": ObjectId(),
                "entity_id": item_id,
                "entity_type": "InventoryItem",
                "event_type": "InventoryItemUpdated",
                "metadata": None,
                "created_at": now_utc(),
                "company_id": user["company_id"],
            }
        )
    return json_response({"status": "success", "modified_count": result.modified_count})
