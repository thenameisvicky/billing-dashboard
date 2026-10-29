from __future__ import annotations

from bson import ObjectId
from fastapi import APIRouter, Request
import re

from app.core.bson import clean_none, now_utc
from app.core.response import json_response
from app.utils.validation import is_missing_billing_state, is_valid_gstin


router = APIRouter()


def normalize_indian_phone(value: str | None) -> str:
    digits = re.sub(r"\D+", "", value or "")
    if len(digits) == 10:
        return f"91{digits}"
    return digits


@router.post("/customers")
async def create_customer(request: Request, payload: dict):
    user = request.state.user
    if is_missing_billing_state(str(payload.get("billing_state", ""))):
        return json_response({"status": "error", "message": "Billing state is required"})
    gstin = payload.get("gstin")
    if gstin and str(gstin).strip() and not is_valid_gstin(str(gstin)):
        return json_response({"status": "error", "message": "Invalid customer GSTIN format"})

    now = now_utc()
    customer = {
        "_id": ObjectId(),
        "company_id": user["company_id"],
        "user_id": str(user["_id"]),
        "name": payload.get("name"),
        "phone": normalize_indian_phone(payload.get("phone")),
        "whatsapp_phone": normalize_indian_phone(payload.get("whatsapp_phone") or payload.get("phone")),
        "gstin": payload.get("gstin"),
        "email": payload.get("email"),
        "address": payload.get("address"),
        "billing_address": payload.get("billing_address") or payload.get("address"),
        "notes": payload.get("notes"),
        "customer_type": payload.get("customer_type"),
        "gst_registration_type": payload.get("gst_registration_type") or payload.get("customer_type"),
        "billing_state": payload.get("billing_state"),
        "billing_state_code": payload.get("billing_state_code") or payload.get("billing_state"),
        "campaign_id": None,
        "created_at": now,
        "updated_at": now,
        "is_active": True,
    }
    result = await request.app.state.app_state.db.customerdetails.insert_one(customer)
    await request.app.state.app_state.db.customerengagementdetails.insert_one(
        {
            "_id": ObjectId(),
            "entity_id": str(customer["_id"]),
            "entity_type": "Customer",
            "event_type": "CustomerCreated",
            "metadata": None,
            "created_at": now,
            "company_id": user["company_id"],
        }
    )
    return json_response({"status": "success", "id": result.inserted_id})


@router.get("/customers")
async def get_customers(request: Request):
    user = request.state.user
    cursor = request.app.state.app_state.db.customerdetails.find(
        {"company_id": user["company_id"], "is_active": True}
    )
    return json_response({"status": "success", "data": await cursor.to_list(length=None)})


@router.get("/customers/{customer_id}")
async def get_customer(request: Request, customer_id: str):
    try:
        object_id = ObjectId(customer_id)
    except Exception:
        return json_response({"status": "error", "message": "Invalid customer Id"})
    user = request.state.user
    customer = await request.app.state.app_state.db.customerdetails.find_one(
        {"_id": object_id, "company_id": user["company_id"], "is_active": True}
    )
    if customer is None:
        return json_response({"status": "error", "message": "Customer not found"})
    return json_response({"status": "success", "data": customer})


@router.patch("/customers/{customer_id}")
async def update_customer(request: Request, customer_id: str, payload: dict):
    try:
        object_id = ObjectId(customer_id)
    except Exception:
        return json_response({"status": "error", "message": "Invalid customer Id"})

    if "billing_state" in payload and is_missing_billing_state(str(payload["billing_state"])):
        return json_response({"status": "error", "message": "Billing state is required"})
    gstin = payload.get("gstin")
    if gstin and str(gstin).strip() and not is_valid_gstin(str(gstin)):
        return json_response({"status": "error", "message": "Invalid customer GSTIN format"})

    cleaned = clean_none(payload)
    if "phone" in cleaned:
        cleaned["phone"] = normalize_indian_phone(cleaned["phone"])
    if "whatsapp_phone" in cleaned or "phone" in cleaned:
        cleaned["whatsapp_phone"] = normalize_indian_phone(cleaned.get("whatsapp_phone") or cleaned.get("phone"))
    if not cleaned:
        return json_response({"status": "success", "modified_count": 0})
    cleaned["updated_at"] = now_utc()
    user = request.state.user
    result = await request.app.state.app_state.db.customerdetails.update_one(
        {"_id": object_id, "company_id": user["company_id"], "is_active": True},
        {"$set": cleaned},
    )
    if result.modified_count > 0:
        await request.app.state.app_state.db.customerengagementdetails.insert_one(
            {
                "_id": ObjectId(),
                "entity_id": customer_id,
                "entity_type": "Customer",
                "event_type": "CustomerUpdated",
                "metadata": None,
                "created_at": now_utc(),
                "company_id": user["company_id"],
            }
        )
    return json_response({"status": "success", "modified_count": result.modified_count})
