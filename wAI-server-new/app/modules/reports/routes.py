from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request

from app.core.response import json_response


router = APIRouter()


def parse_day(value: str | None, fallback: datetime) -> datetime:
    if not value:
        return fallback
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


@router.get("/reports/weekly")
async def weekly_report(request: Request, start: str | None = None, end: str | None = None):
    user = request.state.user
    state = request.app.state.app_state
    now = datetime.now(timezone.utc)
    period_end = parse_day(end, now)
    period_start = parse_day(start, period_end - timedelta(days=7))
    invoices = await state.db.invoicedetails.find(
        {"company_id": user["company_id"], "is_active": {"$ne": False}, "created_at": {"$gte": period_start, "$lt": period_end}}
    ).to_list(length=None)
    payments = await state.db.paymenteventdetails.find(
        {"company_id": user["company_id"], "created_at": {"$gte": period_start, "$lt": period_end}}
    ).to_list(length=None)
    issued = [invoice for invoice in invoices if invoice.get("lifecycle_status") == "ISSUED" or invoice.get("status") in {"Issued", "Sent"}]
    breakdown = [
        {
            "invoice_number": invoice.get("invoice_number"),
            "customer": (invoice.get("buyer_snapshot") or {}).get("name") or invoice.get("customer_id"),
            "issued_amount": invoice.get("grand_total", 0),
            "amount_received": invoice.get("amount_received", 0),
            "outstanding": invoice.get("due_amount", 0),
            "payment_status": invoice.get("payment_status"),
        }
        for invoice in invoices
    ]
    summary = {
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "invoices_created": len(invoices),
        "invoices_issued": len(issued),
        "total_invoiced_amount": sum(int(invoice.get("grand_total") or 0) for invoice in issued),
        "payments_received": len(payments),
        "verified_payment_amount": sum(int(payment.get("amount_minor", payment.get("amount", 0)) or 0) for payment in payments if payment.get("status") in {"Verified", "Success"}),
        "outstanding_amount": sum(int(invoice.get("due_amount") or 0) for invoice in invoices),
        "fully_paid_invoices": sum(1 for invoice in invoices if invoice.get("payment_status") == "Paid"),
        "partially_paid_invoices": sum(1 for invoice in invoices if invoice.get("payment_status") == "PartiallyPaid"),
        "unpaid_invoices": sum(1 for invoice in invoices if invoice.get("payment_status") == "UnPaid"),
        "overdue_invoices": sum(1 for invoice in invoices if invoice.get("due_date") and invoice.get("due_amount", 0) > 0 and invoice.get("due_date") < now),
        "failed_whatsapp_deliveries": sum(1 for invoice in invoices if invoice.get("delivery_status") == "FAILED"),
        "breakdown": breakdown,
    }
    html = "<h1>Weekly invoice/payment report</h1>" + "".join(f"<p>{key}: {value}</p>" for key, value in summary.items() if key != "breakdown")
    return json_response({"status": "success", "data": summary, "html": html})


@router.post("/internal/reports/weekly/send")
async def send_weekly_report(request: Request, payload: dict):
    report = await weekly_report(request, payload.get("start"), payload.get("end"))
    return report
