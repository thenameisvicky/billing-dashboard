from __future__ import annotations

import csv
import hashlib
from io import StringIO

from bson import ObjectId
from fastapi import APIRouter, Request

from app.core.bson import now_utc
from app.core.response import json_response
from app.modules.invoice.routes import create_invoice_document


router = APIRouter()

ALIASES = {
    "invoice_no": "invoice_number",
    "customer": "customer_name",
    "gstin": "customer_gstin",
    "qty": "quantity",
    "rate": "unit_price",
    "hsn": "hsn_code",
}
REQUIRED = {"invoice_number", "invoice_date", "customer_name", "item_description", "hsn_code", "quantity", "unit_price", "taxable_value", "gst_rate", "invoice_total"}


def canonical(row: dict) -> dict:
    return {(ALIASES.get((key or "").strip().lower(), (key or "").strip().lower())): (value or "").strip() for key, value in row.items()}


def fingerprint(company_id: str, row: dict, source: str) -> str:
    stable = "|".join(
        [
            company_id,
            source,
            row.get("invoice_number", ""),
            row.get("invoice_date", ""),
            row.get("customer_gstin") or row.get("customer_name", ""),
            row.get("invoice_total", ""),
        ]
    )
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


async def preview_rows(state, company_id: str, content: str, source: str) -> dict:
    reader = csv.DictReader(StringIO(content))
    rows = [canonical(row) for row in reader]
    seen: set[str] = set()
    previews = []
    valid = invalid = duplicate = 0
    for index, row in enumerate(rows, start=2):
        errors = [f"Missing {field}" for field in sorted(REQUIRED) if not row.get(field)]
        try:
            quantity = int(float(row.get("quantity", "0")))
            unit_price = int(round(float(row.get("unit_price", "0")) * 100))
            taxable = int(round(float(row.get("taxable_value", "0")) * 100))
            total = int(round(float(row.get("invoice_total", "0")) * 100))
        except ValueError:
            quantity = unit_price = taxable = total = 0
            errors.append("Quantity, unit price, taxable value and invoice total must be numeric")
        if quantity <= 0:
            errors.append("Quantity must be greater than zero")
        row_fp = fingerprint(company_id, row, source)
        exists = await state.db.invoicedetails.find_one({"company_id": company_id, "import_fingerprint": row_fp})
        is_duplicate = row_fp in seen or exists is not None
        seen.add(row_fp)
        if is_duplicate:
            duplicate += 1
        elif errors:
            invalid += 1
        else:
            valid += 1
        previews.append(
            {
                "source_row_number": index,
                "row": row,
                "errors": errors,
                "duplicate": is_duplicate,
                "fingerprint": row_fp,
                "calculated_total": total,
                "quantity": quantity,
                "unit_price_minor": unit_price,
                "taxable_value_minor": taxable,
            }
        )
    return {"rows": previews, "total_rows": len(rows), "valid_rows": valid, "invalid_rows": invalid, "duplicate_rows": duplicate}


@router.post("/invoice-imports/preview")
async def invoice_import_preview(request: Request, payload: dict):
    user = request.state.user
    filename = str(payload.get("filename") or "")
    if not filename.lower().endswith(".csv"):
        return json_response({"status": "error", "message": "Only .csv files are accepted"})
    content = str(payload.get("content") or "")
    if len(content.encode("utf-8")) > 2_000_000:
        return json_response({"status": "error", "message": "CSV file is too large for MVP import"})
    preview = await preview_rows(request.app.state.app_state, user["company_id"], content, str(payload.get("source") or "CSV_IMPORT"))
    return json_response({"status": "success", "data": preview})


@router.post("/invoice-imports/commit")
async def invoice_import_commit(request: Request, payload: dict):
    user = request.state.user
    state = request.app.state.app_state
    filename = str(payload.get("filename") or "")
    content = str(payload.get("content") or "")
    source = str(payload.get("source") or "CSV_IMPORT")
    mode = str(payload.get("mode") or "draft").lower()
    file_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    preview = await preview_rows(state, user["company_id"], content, source)
    job = {
        "_id": ObjectId(),
        "company_id": user["company_id"],
        "filename": filename,
        "file_hash": file_hash,
        "source": source,
        "total_rows": preview["total_rows"],
        "valid_rows": preview["valid_rows"],
        "invalid_rows": preview["invalid_rows"],
        "duplicate_rows": preview["duplicate_rows"],
        "imported_rows": 0,
        "status": "RUNNING",
        "created_by": str(user["_id"]),
        "created_at": now_utc(),
        "completed_at": None,
    }
    await state.db.invoiceimportjobs.insert_one(job)
    imported = 0
    for row in preview["rows"]:
        if row["errors"] or row["duplicate"]:
            continue
        data = row["row"]
        payload_for_invoice = {
            "customer_id": str(payload.get("customer_id") or ""),
            "invoice_number": data.get("invoice_number"),
            "place_of_supply": data.get("billing_state") or "",
            "items": [
                {
                    "inventory_id": data.get("inventory_id"),
                    "quantity": row["quantity"],
                    "unit": data.get("uqc") or "NOS",
                    "unit_price": row["unit_price_minor"],
                    "tax_details": [{"tax_name": "GST", "tax_percentage": int(float(data.get("gst_rate", "0")) * 100)}],
                    "hsn_code": data.get("hsn_code"),
                    "item_name": data.get("item_description"),
                }
            ],
            "customer_gst": data.get("customer_gstin") or "N/A",
            "invoice_type": "Tax Invoice",
            "total_amount": row["taxable_value_minor"],
            "total_tax_amount": max(row["calculated_total"] - row["taxable_value_minor"], 0),
            "discount_amount": 0,
            "discount_percentage": 0,
            "grand_total": row["calculated_total"],
            "due_date": data.get("due_date") or None,
            "external_invoice_number": data.get("invoice_number"),
            "import_job_id": str(job["_id"]),
            "source_file_hash": file_hash,
            "source_row_number": row["source_row_number"],
            "import_fingerprint": row["fingerprint"],
        }
        invoice, error = await create_invoice_document(
            request,
            payload_for_invoice,
            source=source,
            inventory_effect="NONE" if mode == "issued" or source == "POS_IMPORT" else "APPLY_ON_ISSUE",
            lifecycle_status="ISSUED" if mode == "issued" or source == "POS_IMPORT" else "DRAFT",
        )
        if error is None and invoice:
            imported += 1
    await state.db.invoiceimportjobs.update_one(
        {"_id": job["_id"], "company_id": user["company_id"]},
        {"$set": {"imported_rows": imported, "status": "COMPLETED", "completed_at": now_utc()}},
    )
    return json_response({"status": "success", "job_id": str(job["_id"]), "summary": {**preview, "imported_rows": imported}})


@router.get("/invoice-imports/{job_id}")
async def get_invoice_import_job(request: Request, job_id: str):
    if not ObjectId.is_valid(job_id):
        return json_response({"status": "error", "message": "Invalid import job id"})
    user = request.state.user
    job = await request.app.state.app_state.db.invoiceimportjobs.find_one({"_id": ObjectId(job_id), "company_id": user["company_id"]})
    return json_response({"status": "success", "data": job})
