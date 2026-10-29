from __future__ import annotations

import re

from bson import ObjectId
from fastapi import APIRouter, Request

from app.core.bson import now_utc
from app.core.response import json_response
from app.modules.automations.whatsapp_adapter import WhatsAppAdapter
from app.modules.invoice.service import issue_invoice, legacy_status_from_lifecycle


router = APIRouter()


def normalize_phone(phone: str | None) -> str | None:
    digits = re.sub(r"\D+", "", phone or "")
    if len(digits) == 10:
        return f"91{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return digits
    return None


async def send_one_invoice(request: Request, invoice_id: str) -> dict:
    state = request.app.state.app_state
    user = request.state.user
    company_id = user["company_id"]
    invoice = await state.db.invoicedetails.find_one(
        {"invoice_tnx_id": invoice_id, "company_id": company_id, "is_active": {"$ne": False}}
    )
    if invoice is None:
        return {"invoice_id": invoice_id, "status": "skipped", "reason": "Invoice not found"}

    customer = await state.db.customerdetails.find_one(
        {"_id": ObjectId(invoice["customer_id"]), "company_id": company_id}
    ) if ObjectId.is_valid(str(invoice.get("customer_id"))) else None
    phone = normalize_phone((customer or {}).get("whatsapp_phone") or (customer or {}).get("phone") or invoice.get("buyer_snapshot", {}).get("phone"))
    if not phone:
        return {"invoice_id": invoice_id, "status": "skipped", "reason": "Missing or invalid WhatsApp phone"}

    issued_now = False
    if invoice.get("lifecycle_status") != "ISSUED" and invoice.get("status") not in {"Issued", "Sent"}:
        ok, message, invoice = await issue_invoice(state, company_id, invoice_id, user_id=str(user["_id"]), issue_method="POS_WHATSAPP")
        if not ok:
            return {"invoice_id": invoice_id, "status": "failed", "reason": message}
        issued_now = True

    now = now_utc()
    await state.db.invoicedetails.update_one(
        {"invoice_tnx_id": invoice_id, "company_id": company_id},
        {"$set": {"delivery_status": "PENDING", "last_updated": now}},
    )
    adapter = WhatsAppAdapter(state)
    result = await adapter.send_invoice_message(
        phone=phone,
        customer_name=(customer or invoice.get("buyer_snapshot") or {}).get("name", "Customer"),
        invoice_number=invoice.get("invoice_number") or invoice_id,
        invoice_url=invoice.get("payment_link") or "",
        amount_due=int(invoice.get("due_amount") or invoice.get("grand_total") or 0),
        due_date=str(invoice.get("due_date")) if invoice.get("due_date") else None,
    )
    delivery_status = "SENT" if result.accepted else "FAILED"
    await state.db.invoicedetails.update_one(
        {"invoice_tnx_id": invoice_id, "company_id": company_id},
        {
            "$set": {
                "delivery_status": delivery_status,
                "status": legacy_status_from_lifecycle("ISSUED", delivery_status),
                "last_updated": now_utc(),
                "whatsapp_provider_message_id": result.provider_message_id,
                "whatsapp_failure_code": result.failure_code,
                "whatsapp_failure_message": result.failure_message,
            }
        },
    )
    await state.db.whatsappdeliverydetails.insert_one(
        {
            "_id": ObjectId(),
            "company_id": company_id,
            "invoice_id": invoice_id,
            "customer_id": invoice.get("customer_id"),
            "phone": phone,
            "provider_message_id": result.provider_message_id,
            "request_time": now,
            "response_time": now_utc(),
            "delivery_status": delivery_status,
            "failure_code": result.failure_code,
            "failure_message": result.failure_message,
            "attempt_number": 1,
        }
    )
    await state.db.invoiceeventdetails.insert_one(
        {
            "_id": ObjectId(),
            "entity_id": invoice_id,
            "entity_type": "Invoice",
            "event_type": "InvoiceSent" if result.accepted else "WhatsappDeliveryFailed",
            "metadata": {"provider_message_id": result.provider_message_id, "failure_message": result.failure_message},
            "created_at": now_utc(),
            "company_id": company_id,
        }
    )
    return {"invoice_id": invoice_id, "status": "sent" if result.accepted else "failed", "issued": issued_now, "reason": result.failure_message}


@router.post("/invoice/{invoice_id}/send-whatsapp")
async def send_invoice_whatsapp(request: Request, invoice_id: str):
    result = await send_one_invoice(request, invoice_id)
    return json_response({"status": "success" if result["status"] == "sent" else "error", "data": result})


@router.post("/invoices/{invoice_id}/send-whatsapp")
async def send_invoice_whatsapp_alias(request: Request, invoice_id: str):
    return await send_invoice_whatsapp(request, invoice_id)


@router.post("/invoices/bulk-send-whatsapp")
async def bulk_send_whatsapp(request: Request, payload: dict):
    invoice_ids = [str(value) for value in payload.get("invoice_ids", [])]
    results = [await send_one_invoice(request, invoice_id) for invoice_id in invoice_ids]
    summary = {
        "selected": len(invoice_ids),
        "issued": sum(1 for result in results if result.get("issued")),
        "sent": sum(1 for result in results if result.get("status") == "sent"),
        "failed": sum(1 for result in results if result.get("status") == "failed"),
        "skipped": sum(1 for result in results if result.get("status") == "skipped"),
    }
    return json_response({"status": "success", "summary": summary, "results": results})
