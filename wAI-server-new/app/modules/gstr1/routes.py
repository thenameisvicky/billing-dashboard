from __future__ import annotations

from bson import ObjectId
from fastapi import APIRouter, Request

from app.core.bson import now_utc
from app.core.response import json_response
from app.modules.invoice.gstr1 import build_gstr1_json, parse_period
from app.modules.invoice_imports.routes import invoice_import_commit, invoice_import_preview


router = APIRouter()


def validate_invoice(invoice: dict, start, end, seen: set[str]) -> list[str]:
    errors = []
    number = invoice.get("invoice_number")
    if not number:
        errors.append("Missing invoice number")
    if number in seen:
        errors.append("Duplicate invoice number")
    seen.add(number)
    created_at = invoice.get("created_at")
    if not created_at:
        errors.append("Missing invoice date")
    elif not (start <= created_at < end):
        errors.append("Invoice outside selected return period")
    if invoice.get("lifecycle_status") != "ISSUED" and invoice.get("status") not in {"Issued", "Sent"}:
        errors.append("Draft or cancelled invoice included")
    if not invoice.get("place_of_supply"):
        errors.append("Missing state/place of supply")
    for item in invoice.get("item_snapshot") or invoice.get("items") or []:
        if not item.get("hsn_code"):
            errors.append("Missing HSN/SAC")
        if int(item.get("taxable_value") or item.get("line_subtotal") or 0) < 0:
            errors.append("Missing taxable value")
    return errors


@router.post("/gstr1/imports/preview")
async def gstr1_import_preview(request: Request, payload: dict):
    payload["source"] = "POS_IMPORT"
    return await invoice_import_preview(request, payload)


@router.post("/gstr1/imports/commit")
async def gstr1_import_commit(request: Request, payload: dict):
    payload["source"] = "POS_IMPORT"
    payload["mode"] = "issued"
    response = await invoice_import_commit(request, payload)
    await request.app.state.app_state.db.invoiceeventdetails.insert_one(
        {
            "_id": ObjectId(),
            "entity_id": str(payload.get("return_period") or ""),
            "entity_type": "Invoice",
            "event_type": "Gstr1ImportCompleted",
            "metadata": {"external_system": payload.get("external_system"), "return_period": payload.get("return_period")},
            "created_at": now_utc(),
            "company_id": request.state.user["company_id"],
        }
    )
    return response


@router.post("/gstr1/validate")
async def gstr1_validate(request: Request, payload: dict):
    user = request.state.user
    try:
        period, start, end = parse_period(payload.get("period"))
    except Exception:
        return json_response({"status": "error", "message": "Invalid period. Use YYYY-MM."})
    invoices = await request.app.state.app_state.db.invoicedetails.find(
        {"company_id": user["company_id"], "is_active": {"$ne": False}, "created_at": {"$gte": start, "$lt": end}}
    ).to_list(length=None)
    seen: set[str] = set()
    results = [{"invoice_id": invoice.get("invoice_tnx_id"), "invoice_number": invoice.get("invoice_number"), "errors": validate_invoice(invoice, start, end, seen)} for invoice in invoices]
    invalid = [result for result in results if result["errors"]]
    return json_response({"status": "success", "period": period, "valid_count": len(results) - len(invalid), "invalid_count": len(invalid), "results": results})


@router.post("/gstr1/export")
async def gstr1_export(request: Request, payload: dict):
    user = request.state.user
    state = request.app.state.app_state
    validation_response = await gstr1_validate(request, payload)
    validation = validation_response.body
    try:
        period, start, end = parse_period(payload.get("period"))
    except Exception:
        return json_response({"status": "error", "message": "Invalid period. Use YYYY-MM."})
    invoices = await state.db.invoicedetails.find(
        {"company_id": user["company_id"], "is_active": {"$ne": False}, "created_at": {"$gte": start, "$lt": end}, "lifecycle_status": "ISSUED"}
    ).to_list(length=None)
    customer_ids = [ObjectId(invoice["customer_id"]) for invoice in invoices if ObjectId.is_valid(str(invoice.get("customer_id")))]
    customers = await state.db.customerdetails.find({"_id": {"$in": customer_ids}, "company_id": user["company_id"]}).to_list(length=None) if customer_ids else []
    customer_map = {str(customer["_id"]): customer for customer in customers}
    company = await state.db.companydetails.find_one({"_id": ObjectId(user["company_id"])}) if ObjectId.is_valid(user["company_id"]) else None
    export = build_gstr1_json(company, invoices, customer_map, period)
    history = {"_id": ObjectId(), "company_id": user["company_id"], "period": period, "invoice_count": len(invoices), "created_at": now_utc()}
    await state.db.gstr1exporthistory.insert_one(history)
    return json_response({"status": "success", "data": export, "validation": validation.decode("utf-8")})


@router.get("/gstr1/export-history")
async def gstr1_export_history(request: Request):
    user = request.state.user
    rows = await request.app.state.app_state.db.gstr1exporthistory.find({"company_id": user["company_id"]}).sort("created_at", -1).to_list(length=50)
    return json_response({"status": "success", "data": rows})
