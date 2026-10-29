from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.response import json_response


router = APIRouter()


@router.get("/feed")
async def get_timeline(request: Request, customerid: str | None = None, customerId: str | None = None):
    state = request.app.state.app_state
    user = request.state.user
    customer_id = (customerid or customerId or "").strip() or None
    invoice_ids: set[str] = set()
    if customer_id:
        cursor = state.db.invoicedetails.find(
            {"company_id": user["company_id"], "customer_id": customer_id, "is_active": {"$ne": False}}
        )
        invoices = await cursor.to_list(length=None)
        for invoice in invoices:
            invoice_ids.update(
                str(value)
                for value in (invoice.get("invoice_tnx_id"), invoice.get("_id"), invoice.get("invoice_number"))
                if value is not None
            )

    filter_doc = {"company_id": user["company_id"]}
    invoice_events = await state.db.invoiceeventdetails.find(filter_doc).to_list(length=None)
    customer_events = await state.db.customerengagementdetails.find(filter_doc).to_list(length=None)
    general_events = await state.db.eventdetails.find(filter_doc).to_list(length=None)

    all_events: list[dict] = []
    for event in invoice_events:
        if customer_id and event.get("entity_id") not in invoice_ids:
            continue
        all_events.append(_event_json(event))

    for event in customer_events:
        if customer_id:
            metadata = event.get("metadata") or {}
            metadata_customer_id = metadata.get("customer_id") or metadata.get("customerId") or metadata.get("customer")
            if event.get("entity_id") != customer_id and metadata_customer_id != customer_id:
                continue
        all_events.append(_event_json(event))

    if customer_id is None:
        all_events.extend(_event_json(event) for event in general_events)

    all_events.sort(key=lambda event: int(event.get("created_at") or 0), reverse=True)
    return json_response({"status": "success", "data": all_events})


def _event_json(event: dict) -> dict:
    created_at = event.get("created_at")
    millis = int(created_at.timestamp() * 1000) if hasattr(created_at, "timestamp") else 0
    return {
        "id": str(event.get("_id")),
        "entity_id": event.get("entity_id"),
        "entity_type": str(event.get("entity_type")),
        "event_type": str(event.get("event_type")),
        "metadata": event.get("metadata"),
        "created_at": millis,
        "company_id": event.get("company_id"),
    }
