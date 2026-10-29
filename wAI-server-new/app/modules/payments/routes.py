from __future__ import annotations

import html
import json
import uuid
from datetime import datetime
from io import BytesIO

from bson import ObjectId
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

from app.core.bson import now_utc
from app.core.response import json_response
from app.modules.invoice.service import recalculate_invoice_payment_status
from app.modules.payments.razorpay_adapter import RazorpayAdapter

router = APIRouter()

THREE_DECIMAL_CURRENCIES = {"BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"}
VERIFIED_STATUSES = {"Verified", "Success", "Received"}


def amount(value: int, currency: str = "INR") -> str:
    if currency.upper() == "INR":
        return f"₹{value / 100:.2f}"
    return f"{currency.upper()} {value / 100:.2f}"


def normalize_gateway_amount(amount_minor: int, currency: str) -> int:
    if currency.upper() in THREE_DECIMAL_CURRENCIES:
        return amount_minor - (amount_minor % 10)
    return amount_minor


def get_razorpay_adapter(state) -> RazorpayAdapter:
    return RazorpayAdapter(
        state.config.razorpay_webhook_secret,
        key_id=state.config.razorpay_key_id,
        key_secret=state.config.razorpay_key_secret,
        http_client=state.http_client,
    )


def customer_contact(invoice: dict) -> dict[str, str]:
    buyer = invoice.get("buyer_snapshot") or {}
    return {
        "name": str(buyer.get("name") or "Customer"),
        "email": str(buyer.get("email") or ""),
        "contact": str(buyer.get("phone") or ""),
    }


def payment_event_filter(invoice: dict) -> dict:
    invoice_id = invoice["invoice_tnx_id"]
    return {
        "company_id": invoice["company_id"],
        "$or": [{"invoice_id": invoice_id}, {"invoice_tnx_id": invoice_id}],
    }


def is_issued(invoice: dict) -> bool:
    return invoice.get("lifecycle_status") == "ISSUED" or invoice.get("status") in {"Issued", "Sent"}


async def public_invoice(state, public_token: str, company_id: str | None) -> dict | None:
    return await state.db.invoicedetails.find_one(
        {"public_token": public_token, "company_id": company_id, "is_active": {"$ne": False}}
    )


def payment_status_label(status: str | None) -> str:
    return {
        "OrderCreated": "Awaiting payment",
        "Pending": "Starting payment",
        "Submitted": "Confirming payment",
        "Verified": "Paid",
        "Failed": "Failed",
    }.get(str(status or ""), str(status or "Pending"))


async def finalize_captured_payment(
    state,
    payment_event: dict,
    payment: dict,
    gateway_response: dict,
    *,
    razorpay_signature: str | None = None,
) -> tuple[bool, str]:
    """Persist one captured payment exactly once, then recalculate its invoice."""
    payment_id = str(payment.get("id") or "")
    order_id = str(payment.get("order_id") or "")
    expected_amount = int(payment_event.get("amount_minor") or payment_event.get("amount") or 0)
    actual_amount = int(payment.get("amount") or 0)
    expected_currency = str(payment_event.get("currency") or "INR").upper()
    actual_currency = str(payment.get("currency") or expected_currency).upper()
    if not payment_id or order_id != str(payment_event.get("razorpay_order_id") or ""):
        return False, "Payment does not belong to this invoice"
    if actual_amount != expected_amount or actual_currency != expected_currency:
        await state.db.paymenteventdetails.update_one(
            {"_id": payment_event["_id"]},
            {"$set": {"status": "Failed", "failure_reason": "Razorpay amount or currency did not match the payment attempt", "updated_at": now_utc()}},
        )
        return False, "Payment amount validation failed"

    now = now_utc()
    update = {
        "status": "Verified",
        "payment_amount": actual_amount,
        "amount_minor": actual_amount,
        "currency": actual_currency,
        "razorpay_payment_id": payment_id,
        "verified_at": now,
        "failure_reason": None,
        "gateway_response": gateway_response,
        "updated_at": now,
    }
    if razorpay_signature:
        update["razorpay_signature"] = razorpay_signature
    await state.db.paymenteventdetails.update_one({"_id": payment_event["_id"]}, {"$set": update})

    receipt = {
        "receipt_tnx_id": str(uuid.uuid4()),
        "payment_event_id": str(payment_event["_id"]),
        "invoice_tnx_id": payment_event.get("invoice_tnx_id") or payment_event.get("invoice_id"),
        "company_id": payment_event.get("company_id"),
        "customer_id": payment_event.get("customer_id"),
        "provider": "razorpay",
        "status": "Success",
        "amount": actual_amount,
        "amount_minor": actual_amount,
        "currency": actual_currency,
        "razorpay_order_id": order_id,
        "razorpay_payment_id": payment_id,
        "captured_at": now,
        "created_at": now,
        "updated_at": now,
    }
    await state.db.paymentreciptdetails.update_one(
        {"provider": "razorpay", "razorpay_payment_id": payment_id},
        {"$setOnInsert": receipt},
        upsert=True,
    )
    await recalculate_invoice_payment_status(
        state,
        str(payment_event.get("company_id") or ""),
        str(payment_event.get("invoice_tnx_id") or payment_event.get("invoice_id") or ""),
    )
    return True, "Payment verified"


def receipt_pdf(receipt: dict, invoice: dict, company: dict | None) -> bytes:
    issued = receipt.get("captured_at") or receipt.get("created_at") or now_utc()
    if isinstance(issued, datetime):
        issued_text = issued.strftime("%d %b %Y, %H:%M UTC")
    else:
        issued_text = str(issued)
    lines = [
        str((company or {}).get("name") or "Payment Receipt"),
        "PAYMENT RECEIPT",
        f"Receipt: {receipt.get('receipt_tnx_id')}",
        f"Invoice: {invoice.get('invoice_number') or invoice.get('invoice_tnx_id')}",
        f"Date: {issued_text}",
        f"Amount: {amount(int(receipt.get('amount_minor') or 0), str(receipt.get('currency') or 'INR'))}",
        f"Provider: Razorpay",
        f"Payment ID: {receipt.get('razorpay_payment_id')}",
        f"Order ID: {receipt.get('razorpay_order_id')}",
        "Status: Paid",
    ]
    escaped = [line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") for line in lines]
    content = "BT /F1 12 Tf 54 760 Td 16 TL " + " ".join(f"({line}) Tj T*" for line in escaped) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(content.encode('latin-1', 'replace'))} >>\nstream\n{content}\nendstream",
    ]
    output = BytesIO()
    output.write(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(output.tell())
        output.write(f"{index} 0 obj\n{obj}\nendobj\n".encode("latin-1", "replace"))
    startxref = output.tell()
    output.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        output.write(f"{offset:010d} 00000 n \n".encode())
    output.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{startxref}\n%%EOF".encode())
    return output.getvalue()


@router.get("/pay/{public_token}", response_class=HTMLResponse)
async def public_invoice_page(request: Request, public_token: str):
    state = request.app.state.app_state
    invoice = await public_invoice(state, public_token, request.headers.get("X-Public-Company-Id"))
    if invoice is None or not is_issued(invoice):
        return HTMLResponse("<h1>Invoice not found</h1>", status_code=404)
    company = await state.db.companydetails.find_one({"_id": ObjectId(invoice["company_id"])}) if ObjectId.is_valid(str(invoice.get("company_id"))) else None
    currency = str(invoice.get("currency") or "INR").upper()
    amount_due = int(invoice.get("due_amount") or 0)
    events = await state.db.paymenteventdetails.find(payment_event_filter(invoice)).sort("created_at", -1).to_list(length=20)
    history = "".join(
        f'<article class="payment-card"><div><strong>{html.escape(payment_status_label(event.get("status")))}</strong><span>{html.escape(str(event.get("created_at") or ""))}</span></div><b>{html.escape(amount(int(event.get("amount_minor") or event.get("amount") or 0), currency))}</b></article>'
        for event in events
    ) or '<p class="empty">No payment attempts yet.</p>'
    contact = customer_contact(invoice)
    pay_disabled = amount_due < 100 or invoice.get("payment_status") in {"Paid", "OverPaid"} or not state.config.razorpay_key_id
    page_html = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pay invoice</title>
<style>
*{{box-sizing:border-box}} body{{margin:0;background:#f1f5f9;color:#172033;font-family:Arial,sans-serif}} main{{max-width:620px;margin:auto;padding:20px 14px 36px}} .brand{{font-size:14px;font-weight:700;color:#475569;margin:6px 0 20px}} .sheet{{background:#fff;border:1px solid #dbe3ee;border-radius:8px;padding:20px;box-shadow:0 1px 3px #0f172a12}} h1{{font-size:24px;margin:0 0 6px}} h2{{font-size:16px;margin:24px 0 12px}} .muted,.empty{{color:#64748b;font-size:14px}} .summary{{display:grid;grid-template-columns:1fr auto;gap:12px;padding:16px 0;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0}} .summary b{{font-size:22px}} label{{display:block;font-size:14px;font-weight:700;margin:18px 0 7px}} input{{width:100%;height:48px;border:1px solid #94a3b8;border-radius:6px;padding:0 12px;font-size:18px}} button{{width:100%;min-height:48px;border:0;border-radius:6px;background:#047857;color:#fff;font-size:16px;font-weight:700;margin-top:16px}} button:disabled{{background:#94a3b8}} #payment-status{{min-height:20px;color:#b45309;font-size:14px;margin:12px 0 0}} .history{{display:grid;gap:8px}} .payment-card{{display:flex;justify-content:space-between;gap:10px;border:1px solid #dbe3ee;border-radius:6px;padding:12px;background:#f8fafc}} .payment-card strong,.payment-card span{{display:block}} .payment-card span{{color:#64748b;font-size:12px;margin-top:4px}} .payment-card b{{white-space:nowrap}} .support{{margin:24px 0 0;color:#64748b;font-size:13px}} @media(max-width:420px){{main{{padding:12px 0 24px}}.sheet{{border-radius:0;border-left:0;border-right:0;padding:18px 16px}}}}
</style></head><body><main><p class="brand">{html.escape(str((company or {}).get("name") or "wAI"))}</p><section class="sheet"><h1>Invoice {html.escape(str(invoice.get("invoice_number") or ""))}</h1><p class="muted">Customer: {html.escape(contact["name"])}{(" · Due " + html.escape(str(invoice.get("due_date")))) if invoice.get("due_date") else ""}</p><div class="summary"><span>Amount remaining<br><small class="muted">{html.escape(str(invoice.get("payment_status") or "UnPaid"))}</small></span><b>{html.escape(amount(amount_due, currency))}</b></div>
<label for="payment-amount">Amount to pay ({html.escape(currency)})</label><input id="payment-amount" type="number" inputmode="decimal" min="1" max="{amount_due / 100:.2f}" step="0.01" value="{amount_due / 100:.2f}" {'disabled' if pay_disabled else ''}><button id="rzp-pay-button" {'disabled' if pay_disabled else ''}>Pay securely</button><p id="payment-status"></p>
<h2>Payment history</h2><div class="history">{history}</div><p class="support">Need help? {html.escape(str((company or {}).get("phone") or "Contact the business"))}</p></section></main>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>
const token={json.dumps(public_token)}; const maxAmount={amount_due}; const statusEl=document.getElementById('payment-status'); const input=document.getElementById('payment-amount'); const payButton=document.getElementById('rzp-pay-button');
const paise=()=>Math.round(Number(input.value)*100);
payButton?.addEventListener('click',async(e)=>{{e.preventDefault();const selected=paise();if(!Number.isInteger(selected)||selected<100||selected>maxAmount){{statusEl.textContent='Enter an amount between ₹1.00 and the balance due.';return;}}payButton.disabled=true;statusEl.textContent='Creating secure payment...';try{{const response=await fetch(`/api/main/payments/create-order/${{token}}`,{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{amount:selected}})}});const data=await response.json();if(!response.ok||data.status==='error')throw new Error(data.message||'Unable to create payment');const checkout=new Razorpay({{key:data.razorpay_key,amount:data.amount,currency:data.currency,name:{json.dumps(str((company or {}).get("name") or "wAI"))},description:{json.dumps("Invoice " + str(invoice.get("invoice_number") or ""))},order_id:data.order_id,prefill:{{name:{json.dumps(contact["name"])},email:{json.dumps(contact["email"])},contact:{json.dumps(contact["contact"])}}},theme:{{color:'#047857'}},handler:async(r)=>{{statusEl.textContent='Validating payment...';const verify=await fetch(`/api/main/payments/verify-checkout/${{token}}`,{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(r)}});const result=await verify.json();if(!verify.ok||result.status==='error'){{statusEl.textContent=result.message||'Payment validation failed.';payButton.disabled=false;return;}}window.location.assign(`/api/main/pay/${{token}}/success?payment_id=${{encodeURIComponent(r.razorpay_payment_id)}}&order_id=${{encodeURIComponent(r.razorpay_order_id)}}`);}},modal:{{ondismiss:()=>{{statusEl.textContent='Payment cancelled.';payButton.disabled=false;}}}}}});checkout.on('payment.failed',async(r)=>{{statusEl.textContent=r.error?.description||'Payment failed.';await fetch(`/api/main/payments/checkout-failure/${{token}}`,{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{order_id:data.order_id,reason:r.error?.description||'Razorpay payment failed'}})}});payButton.disabled=false;}});checkout.open();}}catch(error){{statusEl.textContent=error.message||'Payment could not be started.';payButton.disabled=false;}}}});
</script></body></html>"""
    return HTMLResponse(page_html)


@router.post("/payments/create-order/{public_token}")
async def create_razorpay_order(request: Request, public_token: str, payload: dict):
    state = request.app.state.app_state
    invoice = await public_invoice(state, public_token, request.headers.get("X-Public-Company-Id"))
    if invoice is None:
        return JSONResponse({"status": "error", "message": "Invoice not found"}, status_code=404)
    if not is_issued(invoice):
        return JSONResponse({"status": "error", "message": "Invoice is not issued yet"}, status_code=400)
    currency = str(invoice.get("currency") or "INR").upper()
    amount_due = int(invoice.get("due_amount") or invoice.get("grand_total") or 0)
    try:
        amount_minor = int(payload.get("amount", amount_due))
    except (TypeError, ValueError):
        return JSONResponse({"status": "error", "message": "Amount must be sent in the currency's smallest unit"}, status_code=400)
    amount_minor = normalize_gateway_amount(amount_minor, currency)
    if amount_minor < 100:
        return JSONResponse({"status": "error", "message": "Minimum amount is 100 paise"}, status_code=400)
    if amount_minor > amount_due:
        return JSONResponse({"status": "error", "message": "Amount cannot exceed invoice due amount"}, status_code=400)
    now = now_utc()
    event = {"invoice_id": invoice["invoice_tnx_id"], "invoice_tnx_id": invoice["invoice_tnx_id"], "company_id": invoice["company_id"], "customer_id": invoice.get("customer_id"), "internal_tnx_id": str(uuid.uuid4()), "amount": amount_minor, "amount_minor": amount_minor, "currency": currency, "provider": "razorpay", "status": "Pending", "razorpay_order_id": None, "razorpay_payment_id": None, "razorpay_signature": None, "verified_at": None, "failure_reason": None, "gateway_response": None, "created_at": now, "updated_at": now}
    result = await state.db.paymenteventdetails.insert_one(event)
    try:
        order = await get_razorpay_adapter(state).create_order(amount=amount_minor, currency=currency, receipt=str(result.inserted_id))
    except PermissionError as exc:
        status_code, message = 401, str(exc)
    except ValueError as exc:
        status_code, message = 400, str(exc)
    except Exception:
        status_code, message = 500, "Razorpay order creation failed"
    else:
        await state.db.paymenteventdetails.update_one({"_id": result.inserted_id}, {"$set": {"razorpay_order_id": order["id"], "status": "OrderCreated", "gateway_response": order, "updated_at": now_utc()}})
        return JSONResponse({"status": "success", "order_id": order["id"], "amount": int(order.get("amount") or amount_minor), "currency": order.get("currency") or currency, "razorpay_key": state.config.razorpay_key_id, "invoice_tnx_id": invoice["invoice_tnx_id"]})
    await state.db.paymenteventdetails.update_one({"_id": result.inserted_id}, {"$set": {"status": "Failed", "failure_reason": message, "updated_at": now_utc()}})
    return JSONResponse({"status": "error", "message": message}, status_code=status_code)


@router.post("/payments/verify-checkout/{public_token}")
async def verify_checkout(request: Request, public_token: str, payload: dict):
    state = request.app.state.app_state
    invoice = await public_invoice(state, public_token, request.headers.get("X-Public-Company-Id"))
    order_id, payment_id, signature = (str(payload.get(key) or "") for key in ("razorpay_order_id", "razorpay_payment_id", "razorpay_signature"))
    if invoice is None or not order_id or not payment_id or not signature:
        return JSONResponse({"status": "error", "message": "Missing payment confirmation fields"}, status_code=400)
    event = await state.db.paymenteventdetails.find_one({**payment_event_filter(invoice), "razorpay_order_id": order_id, "provider": "razorpay"})
    if event is None:
        return JSONResponse({"status": "error", "message": "Payment attempt not found"}, status_code=404)
    adapter = get_razorpay_adapter(state)
    if not adapter.verify_payment_signature(order_id=order_id, payment_id=payment_id, signature=signature):
        await state.db.paymenteventdetails.update_one({"_id": event["_id"]}, {"$set": {"status": "Failed", "failure_reason": "Razorpay checkout signature mismatch", "updated_at": now_utc()}})
        return JSONResponse({"status": "error", "message": "Payment signature validation failed"}, status_code=400)
    try:
        payment = await adapter.fetch_payment(payment_id)
        if str(payment.get("status") or "").lower() == "authorized":
            payment = await adapter.capture_payment(payment_id, int(event["amount_minor"]))
    except (PermissionError, ValueError) as exc:
        return JSONResponse({"status": "error", "message": str(exc)}, status_code=400)
    except Exception:
        return JSONResponse({"status": "error", "message": "Could not validate payment with Razorpay"}, status_code=502)
    if str(payment.get("status") or "").lower() == "captured":
        ok, message = await finalize_captured_payment(state, event, payment, payment, razorpay_signature=signature)
        return JSONResponse({"status": "success" if ok else "error", "message": message, "payment_status": "Verified" if ok else "Failed"}, status_code=200 if ok else 400)
    await state.db.paymenteventdetails.update_one({"_id": event["_id"]}, {"$set": {"status": "Submitted", "razorpay_payment_id": payment_id, "razorpay_signature": signature, "gateway_response": payment, "updated_at": now_utc()}})
    return JSONResponse({"status": "success", "message": "Payment submitted for confirmation", "payment_status": "Submitted"})


@router.post("/payments/checkout-failure/{public_token}")
async def checkout_failure(request: Request, public_token: str, payload: dict):
    state = request.app.state.app_state
    invoice = await public_invoice(state, public_token, request.headers.get("X-Public-Company-Id"))
    order_id = str(payload.get("order_id") or "")
    if invoice is None or not order_id:
        return JSONResponse({"status": "error", "message": "Payment attempt not found"}, status_code=404)
    await state.db.paymenteventdetails.update_one({**payment_event_filter(invoice), "razorpay_order_id": order_id, "status": {"$nin": list(VERIFIED_STATUSES)}}, {"$set": {"status": "Failed", "failure_reason": str(payload.get("reason") or "Razorpay payment failed"), "updated_at": now_utc()}})
    return JSONResponse({"status": "success"})


@router.get("/pay/{public_token}/success", response_class=HTMLResponse)
async def payment_success_page(request: Request, public_token: str, payment_id: str = "", order_id: str = ""):
    state = request.app.state.app_state
    invoice = await public_invoice(state, public_token, request.headers.get("X-Public-Company-Id"))
    if invoice is None:
        return HTMLResponse("<h1>Invoice not found</h1>", status_code=404)
    event = await state.db.paymenteventdetails.find_one({**payment_event_filter(invoice), "razorpay_order_id": order_id, "razorpay_payment_id": payment_id})
    verified = event is not None and event.get("status") in VERIFIED_STATUSES
    receipt_url = f"/api/main/pay/{public_token}/receipt/{html.escape(payment_id)}.pdf" if verified else ""
    message = "Payment verified and applied to this invoice." if verified else "Payment was received and is being confirmed. This page refreshes automatically."
    action = f'<a class="button" href="{receipt_url}">Download receipt PDF</a>' if verified else '<a class="button secondary" href="/api/main/pay/' + html.escape(public_token) + '">Back to invoice</a>'
    refresh = "" if verified else '<script>setTimeout(()=>location.reload(),3000)</script>'
    return HTMLResponse(f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment status</title><style>body{{margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033}}main{{max-width:520px;margin:0 auto;padding:24px 14px}}section{{background:#fff;border:1px solid #dbe3ee;border-radius:8px;padding:24px}}h1{{margin:0 0 12px;font-size:25px}}p{{line-height:1.5;color:#475569}}.amount{{font-size:28px;font-weight:700;color:#047857}}.button{{display:block;text-align:center;margin-top:22px;padding:14px;border-radius:6px;background:#047857;color:#fff;text-decoration:none;font-weight:700}}.secondary{{background:#475569}}</style></head><body><main><section><h1>{'Payment successful' if verified else 'Confirming payment'}</h1><p class="amount">{html.escape(amount(int(event.get('amount_minor') or 0), str(event.get('currency') or 'INR'))) if event else ''}</p><p>{message}</p>{action}</section></main>{refresh}</body></html>''')


@router.get("/pay/{public_token}/receipt/{payment_id}.pdf")
async def download_receipt(request: Request, public_token: str, payment_id: str):
    state = request.app.state.app_state
    invoice = await public_invoice(state, public_token, request.headers.get("X-Public-Company-Id"))
    if invoice is None:
        return JSONResponse({"status": "error", "message": "Invoice not found"}, status_code=404)
    receipt = await state.db.paymentreciptdetails.find_one({"company_id": invoice["company_id"], "invoice_tnx_id": invoice["invoice_tnx_id"], "razorpay_payment_id": payment_id, "status": "Success"})
    if receipt is None:
        return JSONResponse({"status": "error", "message": "Verified receipt not found"}, status_code=404)
    company = await state.db.companydetails.find_one({"_id": ObjectId(invoice["company_id"])}) if ObjectId.is_valid(str(invoice.get("company_id"))) else None
    pdf = receipt_pdf(receipt, invoice, company)
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="receipt-{receipt["receipt_tnx_id"]}.pdf"'})


@router.post("/public/payments/razorpayEvents")
async def razorpay_webhook(request: Request):
    try:
        payload = json.loads(await request.body())
    except json.JSONDecodeError:
        return JSONResponse({"status": "error", "message": "Invalid webhook payload"}, status_code=400)
    payment = payload.get("payload", {}).get("payment", {}).get("entity", {})
    order_id = str(payment.get("order_id") or "")
    if not order_id:
        return JSONResponse({"status": "error", "message": "Missing order_id"}, status_code=400)
    state = request.app.state.app_state
    event = await state.db.paymenteventdetails.find_one({"razorpay_order_id": order_id, "provider": "razorpay"})
    if event is None:
        return JSONResponse({"status": "success", "matched_count": 0})
    event_name = str(payload.get("event") or "")
    status = str(payment.get("status") or "").lower()
    if event_name == "payment.captured" or (status == "captured" and payment.get("captured") is True):
        ok, message = await finalize_captured_payment(state, event, payment, payload)
        return JSONResponse({"status": "success" if ok else "error", "message": message, "matched_count": 1}, status_code=200 if ok else 400)
    if event_name == "payment.failed" or status == "failed":
        await state.db.paymenteventdetails.update_one({"_id": event["_id"], "status": {"$nin": list(VERIFIED_STATUSES)}}, {"$set": {"status": "Failed", "failure_reason": str(payment.get("error_description") or "Razorpay payment failed"), "razorpay_payment_id": payment.get("id"), "gateway_response": payload, "updated_at": now_utc()}})
    return JSONResponse({"status": "success", "matched_count": 1})


@router.get("/payments/invoices/{invoice_id}")
async def invoice_payments(request: Request, invoice_id: str):
    user = request.state.user
    events = await request.app.state.app_state.db.paymenteventdetails.find({"company_id": user["company_id"], "$or": [{"invoice_id": invoice_id}, {"invoice_tnx_id": invoice_id}]}).sort("created_at", -1).to_list(length=None)
    return json_response({"status": "success", "data": events})
