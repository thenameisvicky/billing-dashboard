from __future__ import annotations

import uuid
from decimal import Decimal

from bson import ObjectId
from fastapi import APIRouter, Request
from fastapi.responses import Response

from app.core.bson import now_utc, parse_datetime
from app.core.response import json_response
from app.core.middleware.utils import create_public_token
from app.modules.invoice.gstr1 import build_gstr1_json, export_filename, parse_period, to_download_bytes
from app.modules.invoice.service import issue_invoice, invoice_public_url, legacy_status_from_lifecycle


router = APIRouter()


def discount_from_payload(subtotal: int, amount: int | None, percentage: int | None) -> int:
    if amount is not None:
        return int(amount)
    return (subtotal * int(percentage or 0)) // 100


def format_amount(amount: int) -> str:
    return f"₹{Decimal(amount) / Decimal(100):.2f}"


def normalize_invoice_items(items: list[dict]) -> tuple[list[dict], int, int]:
    processed: list[dict] = []
    total_amount = 0
    total_tax_amount = 0
    for item in items:
        new_item = dict(item)
        new_item["quantity"] = int(new_item.get("quantity", 0))
        new_item["unit_price"] = int(new_item.get("unit_price", 0))
        line_subtotal = new_item["quantity"] * new_item["unit_price"]
        line_tax_total = 0
        for tax in new_item.get("tax_details", []):
            line_tax_total += (line_subtotal * int(tax.get("tax_percentage", 0))) // 10000
        new_item["line_subtotal"] = line_subtotal
        new_item["line_tax_total"] = line_tax_total
        new_item["line_grand_total"] = line_subtotal + line_tax_total
        processed.append(new_item)
        total_amount += line_subtotal
        total_tax_amount += line_tax_total
    return processed, total_amount, total_tax_amount


def validate_totals(payload: dict, processed_total: int, processed_tax: int) -> tuple[bool, str, int, int]:
    discount = discount_from_payload(
        processed_total,
        payload.get("discount_amount"),
        payload.get("discount_percentage"),
    )
    if discount < 0 or discount > processed_total:
        return False, "Discount amount must be between zero and the subtotal", 0, 0
    discounted_total = processed_total - discount
    grand_total = discounted_total + processed_tax
    ui_total = int(payload.get("total_amount") or 0)
    ui_tax = int(payload.get("total_tax_amount") or 0)
    ui_grand = int(payload.get("grand_total") or 0)
    if discounted_total != ui_total or processed_tax != ui_tax or grand_total != ui_grand:
        return (
            False,
            f"Total mismatch. Expected subtotal={format_amount(discounted_total)} tax={format_amount(processed_tax)} grand={format_amount(grand_total)}, got subtotal={format_amount(ui_total)} tax={format_amount(ui_tax)} grand={format_amount(ui_grand)}",
            0,
            0,
        )
    return True, "", discount, grand_total


async def build_snapshots(state, company_id: str, customer_id: str, items: list[dict]) -> tuple[dict, dict, list[dict], str]:
    company = await state.db.companydetails.find_one({"_id": ObjectId(company_id)}) if ObjectId.is_valid(company_id) else None
    customer = await state.db.customerdetails.find_one(
        {"_id": ObjectId(customer_id), "company_id": company_id, "is_active": True}
    ) if ObjectId.is_valid(customer_id) else None
    item_snapshots: list[dict] = []
    for item in items:
        product = None
        if ObjectId.is_valid(str(item.get("inventory_id"))):
            product = await state.db.newinventorydetails.find_one(
                {"_id": ObjectId(str(item.get("inventory_id"))), "company_id": company_id, "is_active": True}
            )
        item_snapshots.append(
            {
                "inventory_id": str(item.get("inventory_id") or ""),
                "item_name": product.get("name") if product else item.get("item_name", ""),
                "product_code": product.get("code") if product else "",
                "hsn_code": item.get("hsn_code") or (product.get("hsn_code") if product else ""),
                "uqc": product.get("uqc_code") if product else item.get("unit"),
                "unit": item.get("unit") or (product.get("base_unit") if product else ""),
                "quantity": int(item.get("quantity") or 0),
                "unit_price": int(item.get("unit_price") or 0),
                "discount": int(item.get("discount") or 0),
                "taxable_value": int(item.get("line_subtotal") or 0),
                "gst_rate": sum(int(tax.get("tax_percentage") or 0) for tax in item.get("tax_details", [])),
                "cgst": sum(int(tax.get("tax_percentage") or 0) for tax in item.get("tax_details", []) if str(tax.get("tax_name", "")).upper() == "CGST"),
                "sgst": sum(int(tax.get("tax_percentage") or 0) for tax in item.get("tax_details", []) if str(tax.get("tax_name", "")).upper() == "SGST"),
                "igst": sum(int(tax.get("tax_percentage") or 0) for tax in item.get("tax_details", []) if str(tax.get("tax_name", "")).upper() == "IGST"),
                "line_total": int(item.get("line_grand_total") or 0),
            }
        )
    seller_snapshot = {
        "name": company.get("name") if company else "",
        "gstin": company.get("gstin") if company else "",
        "address": company.get("address") if company else "",
        "state": company.get("state") if company else "",
        "phone": company.get("phone") if company else "",
    }
    buyer_snapshot = {
        "customer_id": customer_id,
        "name": customer.get("name") if customer else "",
        "phone": customer.get("whatsapp_phone") or customer.get("phone") if customer else "",
        "email": customer.get("email") if customer else "",
        "gst_registration_type": customer.get("gst_registration_type") or customer.get("customer_type") if customer else "",
        "gstin": customer.get("gstin") if customer else "",
        "billing_address": customer.get("billing_address") or customer.get("address") if customer else "",
        "billing_state_code": customer.get("billing_state_code") or customer.get("billing_state") if customer else "",
    }
    return seller_snapshot, buyer_snapshot, item_snapshots, seller_snapshot["gstin"] or "N/A"


async def create_invoice_document(
    request: Request,
    payload: dict,
    *,
    source: str = "MANUAL",
    inventory_effect: str = "APPLY_ON_ISSUE",
    lifecycle_status: str = "DRAFT",
) -> tuple[dict | None, Response | None]:
    items = payload.get("items") or []
    if not items:
        return None, json_response({"status": "error", "message": "Items array cannot be empty."})
    if int(payload.get("total_amount", 0)) < 0 or int(payload.get("total_tax_amount", 0)) < 0 or int(payload.get("grand_total", 0)) < 0:
        return None, json_response({"status": "error", "message": "Amounts cannot be negative."})

    processed_items, calculated_total, calculated_tax = normalize_invoice_items(items)
    ok, message, discount_amount, calculated_grand = validate_totals(payload, calculated_total, calculated_tax)
    if not ok:
        return None, json_response({"status": "error", "message": message})

    state = request.app.state.app_state
    user = request.state.user
    customer_id = str(payload.get("customer_id", ""))
    if ObjectId.is_valid(customer_id):
        customer = await state.db.customerdetails.find_one({"_id": ObjectId(customer_id), "company_id": user["company_id"], "is_active": True})
        if customer is None:
            return None, json_response({"status": "error", "message": "Customer not found or inactive"})

    now = now_utc()
    invoice_tnx_id = str(uuid.uuid4())
    invoice_number = str(payload.get("invoice_number") or f"INV-{invoice_tnx_id[:8].upper()}")
    seller_snapshot, buyer_snapshot, item_snapshot, supplier_gst = await build_snapshots(state, user["company_id"], customer_id, processed_items)
    invoice = {
        "_id": ObjectId(),
        "user_id": str(user["_id"]),
        "company_id": user["company_id"],
        "customer_id": customer_id,
        "invoice_tnx_id": invoice_tnx_id,
        "invoice_number": invoice_number,
        "created_at": now,
        "last_updated": now,
        "place_of_supply": payload.get("place_of_supply"),
        "items": processed_items,
        "customer_gst": payload.get("customer_gst"),
        "total_amount": calculated_total - discount_amount,
        "total_tax_amount": calculated_tax,
        "discount_amount": discount_amount,
        "discount_percentage": int(payload.get("discount_percentage") or 0),
        "grand_total": calculated_grand,
        "due_amount": calculated_grand,
        "amount_received": 0,
        "status": legacy_status_from_lifecycle(lifecycle_status),
        "lifecycle_status": lifecycle_status,
        "delivery_status": "NOT_SENT",
        "payment_status": "UnPaid",
        "source": source,
        "inventory_effect": inventory_effect,
        "inventory_applied": False,
        "issued_at": now if lifecycle_status == "ISSUED" else None,
        "issue_method": payload.get("issue_method"),
        "currency": "INR",
        "due_date": parse_datetime(payload.get("due_date")),
        "public_token": None,
        "payment_link": "",
        "supplier_gst": supplier_gst,
        "invoice_type": payload.get("invoice_type"),
        "previous_invoice_id": None,
        "version_number": 0,
        "seller_snapshot": seller_snapshot,
        "buyer_snapshot": buyer_snapshot,
        "item_snapshot": item_snapshot,
        "external_invoice_number": payload.get("external_invoice_number"),
        "external_system": payload.get("external_system"),
        "external_location": payload.get("external_location"),
        "import_job_id": payload.get("import_job_id"),
        "source_file_hash": payload.get("source_file_hash"),
        "source_row_number": payload.get("source_row_number"),
        "import_fingerprint": payload.get("import_fingerprint"),
        "is_active": True,
    }
    if lifecycle_status == "ISSUED":
        public_token = create_public_token(user["company_id"], state.config.public_token_secret)
        invoice["public_token"] = public_token
        invoice["payment_link"] = invoice_public_url(state.config.app_base_url, public_token)
    await state.db.invoicedetails.insert_one(invoice)
    await state.db.invoiceeventdetails.insert_one(
        {
            "_id": ObjectId(),
            "entity_id": invoice_tnx_id,
            "entity_type": "Invoice",
            "event_type": "InvoiceCreated" if source == "MANUAL" else "InvoiceImported",
            "metadata": {"source": source, "invoice_number": invoice_number, "grand_total": calculated_grand},
            "created_at": now,
            "company_id": user["company_id"],
        }
    )
    return invoice, None


@router.post("/invoice")
async def create_invoice(request: Request, payload: dict):
    invoice, error = await create_invoice_document(request, payload)
    if error is not None:
        return error
    return json_response({"status": "success", "invoice_tnx_id": invoice["invoice_tnx_id"], "payment_link": invoice["payment_link"]})


@router.post("/invoices")
async def create_invoice_alias(request: Request, payload: dict):
    return await create_invoice(request, payload)


@router.get("/invoice")
async def get_invoices(request: Request):
    user = request.state.user
    cursor = request.app.state.app_state.db.invoicedetails.find(
        {"company_id": user["company_id"], "is_active": {"$ne": False}, "status": {"$nin": ["Cancelled", "Superseded"]}}
    )
    return json_response({"status": "success", "data": await cursor.to_list(length=None)})


@router.get("/invoices")
async def get_invoices_alias(request: Request):
    return await get_invoices(request)


@router.get("/invoice/gstr1-export")
async def export_gstr1(request: Request, period: str | None = None):
    user = request.state.user
    state = request.app.state.app_state
    try:
        filing_period, start, end = parse_period(period)
    except Exception:
        return json_response({"status": "error", "message": "Invalid period. Use YYYY-MM."})

    invoice_filter = {
        "company_id": user["company_id"],
        "is_active": {"$ne": False},
        "status": {"$nin": ["Cancelled", "Superseded"]},
        "created_at": {"$gte": start, "$lt": end},
    }
    invoices = await state.db.invoicedetails.find(invoice_filter).to_list(length=None)
    customer_ids = [ObjectId(invoice["customer_id"]) for invoice in invoices if ObjectId.is_valid(str(invoice.get("customer_id")))]
    customer_docs = await state.db.customerdetails.find(
        {"_id": {"$in": customer_ids}, "company_id": user["company_id"]}
    ).to_list(length=None) if customer_ids else []
    customers = {str(customer["_id"]): customer for customer in customer_docs}

    company = None
    if ObjectId.is_valid(user["company_id"]):
        company = await state.db.companydetails.find_one({"_id": ObjectId(user["company_id"])})

    payload = build_gstr1_json(company, invoices, customers, filing_period)
    await state.db.invoiceeventdetails.insert_one(
        {
            "_id": ObjectId(),
            "entity_id": filing_period,
            "entity_type": "Invoice",
            "event_type": "Gstr1ExportGenerated",
            "metadata": {"period": filing_period, "invoice_count": len(invoices)},
            "created_at": now_utc(),
            "company_id": user["company_id"],
        }
    )
    content = to_download_bytes(payload)
    filename = export_filename(filing_period)
    return Response(
        content,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(content)),
            "X-Export-Invoice-Count": str(len(invoices)),
        },
    )


@router.get("/invoice/{invoice_id}")
async def get_invoice(request: Request, invoice_id: str):
    user = request.state.user
    invoice = await request.app.state.app_state.db.invoicedetails.find_one(
        {"invoice_tnx_id": invoice_id, "company_id": user["company_id"], "is_active": {"$ne": False}, "status": {"$nin": ["Cancelled", "Superseded"]}}
    )
    if invoice is None:
        return json_response({"status": "error", "message": "Invoice not found"})
    return json_response({"status": "success", "data": invoice})


@router.get("/invoices/{invoice_id}")
async def get_invoice_alias(request: Request, invoice_id: str):
    return await get_invoice(request, invoice_id)


@router.get("/invoice/{invoice_id}/payment-events")
async def get_invoice_payment_events(request: Request, invoice_id: str):
    user = request.state.user
    state = request.app.state.app_state
    invoice = await state.db.invoicedetails.find_one(
        {
            "invoice_tnx_id": invoice_id,
            "company_id": user["company_id"],
            "is_active": {"$ne": False},
        },
        {"_id": 1},
    )
    if invoice is None:
        return json_response({"status": "error", "message": "Invoice not found"})
    events = await state.db.paymenteventdetails.find(
        {
            "company_id": user["company_id"],
            "$or": [{"invoice_id": invoice_id}, {"invoice_tnx_id": invoice_id}],
        }
    ).sort("created_at", -1).to_list(length=None)
    return json_response({"status": "success", "data": events})

@router.post("/invoice/{invoice_id}/issue")
async def issue_invoice_route(request: Request, invoice_id: str, payload: dict | None = None):
    user = request.state.user
    ok, message, invoice = await issue_invoice(
        request.app.state.app_state,
        user["company_id"],
        invoice_id,
        user_id=str(user["_id"]),
        issue_method=(payload or {}).get("issue_method") or "POS_MANUAL",
    )
    return json_response({"status": "success" if ok else "error", "message": message, "data": invoice})


@router.post("/invoices/{invoice_id}/issue")
async def issue_invoice_alias(request: Request, invoice_id: str, payload: dict | None = None):
    return await issue_invoice_route(request, invoice_id, payload)


@router.patch("/invoice/{invoice_id}")
async def update_invoice(request: Request, invoice_id: str, payload: dict):
    state = request.app.state.app_state
    user = request.state.user
    existing = await state.db.invoicedetails.find_one(
        {"invoice_tnx_id": invoice_id, "company_id": user["company_id"], "is_active": {"$ne": False}, "status": {"$nin": ["Cancelled", "Superseded"]}}
    )
    if existing is None:
        return json_response({"status": "error", "message": "Invoice not found or already inactive"})
    if existing.get("lifecycle_status") == "ISSUED" or existing.get("status") in {"Issued", "Sent"}:
        return json_response({"status": "error", "message": "Issued invoice snapshots cannot be silently mutated"})
    if int(existing.get("version_number") or 0) >= 5:
        return json_response({"status": "error", "message": "Invoice version limit exceeded. Further updates are blocked."})

    new_invoice = dict(existing)
    new_invoice["_id"] = ObjectId()
    new_invoice["previous_invoice_id"] = str(existing["_id"])
    new_invoice["version_number"] = int(existing.get("version_number") or 0) + 1
    new_invoice["last_updated"] = now_utc()
    for field in ("customer_id", "place_of_supply", "customer_gst", "invoice_type", "status", "is_active"):
        if field in payload and payload[field] is not None:
            new_invoice[field] = str(payload[field]) if field == "customer_id" else payload[field]
    if "due_date" in payload and payload["due_date"] is not None:
        new_invoice["due_date"] = parse_datetime(payload["due_date"])

    if payload.get("items") is not None:
        processed_items, calculated_total, calculated_tax = normalize_invoice_items(payload["items"])
        ok, message, discount_amount, calculated_grand = validate_totals(payload, calculated_total, calculated_tax)
        if not ok:
            return json_response({"status": "error", "message": message.replace("Total mismatch.", "Calculation mismatch.")})
        seller_snapshot, buyer_snapshot, item_snapshot, _ = await build_snapshots(state, user["company_id"], str(new_invoice.get("customer_id")), processed_items)
        new_invoice["items"] = processed_items
        new_invoice["total_amount"] = calculated_total - discount_amount
        new_invoice["total_tax_amount"] = calculated_tax
        new_invoice["discount_amount"] = discount_amount
        new_invoice["discount_percentage"] = int(payload.get("discount_percentage") or 0)
        new_invoice["grand_total"] = calculated_grand
        new_invoice["due_amount"] = calculated_grand
        new_invoice["seller_snapshot"] = seller_snapshot
        new_invoice["buyer_snapshot"] = buyer_snapshot
        new_invoice["item_snapshot"] = item_snapshot

    await state.db.invoicedetails.insert_one(new_invoice)
    await state.db.invoicedetails.update_one({"_id": existing["_id"]}, {"$set": {"status": "Superseded", "last_updated": now_utc()}})
    await state.db.invoiceeventdetails.insert_one(
        {
            "_id": ObjectId(),
            "entity_id": invoice_id,
            "entity_type": "Invoice",
            "event_type": "InvoiceUpdated",
            "metadata": {
                "note": payload.get("note") or "No reason provided",
                "previous_version": str(existing["_id"]),
                "new_version": str(new_invoice["_id"]),
            },
            "created_at": now_utc(),
            "company_id": user["company_id"],
        }
    )
    return json_response({"status": "success", "modified_count": 1, "new_invoice_id": str(new_invoice["_id"])})


@router.patch("/invoices/{invoice_id}")
async def update_invoice_alias(request: Request, invoice_id: str, payload: dict):
    return await update_invoice(request, invoice_id, payload)


@router.patch("/invoice/{invoice_id}/delete")
async def delete_invoice(request: Request, invoice_id: str):
    user = request.state.user
    now = now_utc()
    result = await request.app.state.app_state.db.invoicedetails.update_one(
        {"invoice_tnx_id": invoice_id, "company_id": user["company_id"], "lifecycle_status": {"$ne": "ISSUED"}},
        {"$set": {"is_active": False, "status": "Cancelled", "lifecycle_status": "CANCELLED", "last_updated": now}},
    )
    if result.modified_count > 0:
        await request.app.state.app_state.db.invoiceeventdetails.insert_one(
            {
                "_id": ObjectId(),
                "entity_id": invoice_id,
                "entity_type": "Invoice",
                "event_type": "InvoiceDeleted",
                "metadata": {"note": "Issued invoice cancellation is restricted in MVP because inventory reversal is not implemented."},
                "created_at": now,
                "company_id": user["company_id"],
            }
        )
    return json_response({"status": "success", "modified_count": result.modified_count})
