from __future__ import annotations

from bson import ObjectId

from app.core.bson import now_utc
from app.core.middleware.utils import create_public_token


def invoice_public_url(app_base_url: str, public_token: str) -> str:
    return f"{app_base_url.rstrip('/')}/api/main/pay/{public_token}"


def legacy_status_from_lifecycle(lifecycle_status: str, delivery_status: str | None = None) -> str:
    if lifecycle_status == "ISSUED" and delivery_status == "SENT":
        return "Sent"
    if lifecycle_status == "ISSUED":
        return "Issued"
    if lifecycle_status == "CANCELLED":
        return "Cancelled"
    return "Draft"


async def issue_invoice(state, company_id: str, invoice_id: str, *, user_id: str, issue_method: str) -> tuple[bool, str, dict | None]:
    invoice = await state.db.invoicedetails.find_one(
        {
            "invoice_tnx_id": invoice_id,
            "company_id": company_id,
            "is_active": {"$ne": False},
            "lifecycle_status": {"$ne": "CANCELLED"},
        }
    )
    if invoice is None:
        return False, "Invoice not found", None

    if invoice.get("lifecycle_status") == "ISSUED" or invoice.get("status") in {"Issued", "Sent"}:
        return True, "Invoice already issued", invoice

    if invoice.get("inventory_applied") is True:
        await state.db.invoicedetails.update_one(
            {"_id": invoice["_id"], "company_id": company_id},
            {
                "$set": {
                    "lifecycle_status": "ISSUED",
                    "status": legacy_status_from_lifecycle("ISSUED", invoice.get("delivery_status")),
                    "last_updated": now_utc(),
                }
            },
        )
        invoice["lifecycle_status"] = "ISSUED"
        return True, "Inventory was already applied", invoice

    now = now_utc()
    inventory_effect = invoice.get("inventory_effect") or "APPLY_ON_ISSUE"
    decremented: list[tuple[ObjectId, int]] = []
    public_token = invoice.get("public_token") or create_public_token(
        company_id,
        state.config.public_token_secret,
    )
    payment_link = invoice.get("payment_link") or invoice_public_url(state.config.app_base_url, public_token)

    if inventory_effect == "APPLY_ON_ISSUE":
        for item in invoice.get("items", []):
            inventory_id = item.get("inventory_id")
            quantity = int(item.get("quantity") or 0)
            if quantity <= 0:
                return False, "Invoice item quantity must be greater than zero", None
            if not ObjectId.is_valid(str(inventory_id)):
                return False, "Invoice item is missing a valid product reference", None
            product = await state.db.newinventorydetails.find_one(
                {"_id": ObjectId(str(inventory_id)), "company_id": company_id, "is_active": True}
            )
            if product is None:
                return False, "Invoice item product not found", None
            if int(product.get("total_sub_units") or 0) < quantity:
                return False, f"Insufficient quantity for {product.get('name') or product.get('code')}", None

        for item in invoice.get("items", []):
            object_id = ObjectId(str(item.get("inventory_id")))
            quantity = int(item.get("quantity") or 0)
            result = await state.db.newinventorydetails.update_one(
                {
                    "_id": object_id,
                    "company_id": company_id,
                    "is_active": True,
                    "total_sub_units": {"$gte": quantity},
                },
                {"$inc": {"total_sub_units": -quantity}, "$set": {"updated_at": now}},
            )
            if result.modified_count != 1:
                for rollback_id, rollback_qty in decremented:
                    await state.db.newinventorydetails.update_one(
                        {"_id": rollback_id, "company_id": company_id},
                        {"$inc": {"total_sub_units": rollback_qty}, "$set": {"updated_at": now}},
                    )
                return False, "Inventory changed while issuing invoice. Try again.", None
            decremented.append((object_id, quantity))

    issue_filter = {"_id": invoice["_id"], "company_id": company_id, "lifecycle_status": {"$ne": "ISSUED"}}
    if inventory_effect == "APPLY_ON_ISSUE":
        issue_filter["inventory_applied"] = {"$ne": True}

    result = await state.db.invoicedetails.update_one(
        issue_filter,
        {
            "$set": {
                "lifecycle_status": "ISSUED",
                "status": legacy_status_from_lifecycle("ISSUED", invoice.get("delivery_status")),
                "issued_at": now,
                "issue_method": issue_method,
                "inventory_applied": inventory_effect == "APPLY_ON_ISSUE",
                "public_token": public_token,
                "payment_link": payment_link,
                "last_updated": now,
            }
        },
    )
    if result.modified_count != 1:
        for rollback_id, rollback_qty in decremented:
            await state.db.newinventorydetails.update_one(
                {"_id": rollback_id, "company_id": company_id},
                {"$inc": {"total_sub_units": rollback_qty}, "$set": {"updated_at": now}},
            )
        fresh = await state.db.invoicedetails.find_one({"_id": invoice["_id"], "company_id": company_id})
        if fresh and fresh.get("lifecycle_status") == "ISSUED":
            return True, "Invoice already issued", fresh
        return False, "Invoice could not be issued", None

    await state.db.invoiceeventdetails.insert_one(
        {
            "_id": ObjectId(),
            "entity_id": invoice_id,
            "entity_type": "Invoice",
            "event_type": "InvoiceIssued",
            "metadata": {"issue_method": issue_method, "inventory_effect": inventory_effect, "user_id": user_id},
            "created_at": now,
            "company_id": company_id,
        }
    )
    issued = await state.db.invoicedetails.find_one({"_id": invoice["_id"], "company_id": company_id})
    return True, "Invoice issued", issued


async def recalculate_invoice_payment_status(state, company_id: str, invoice_id: str) -> dict | None:
    invoice = await state.db.invoicedetails.find_one({"invoice_tnx_id": invoice_id, "company_id": company_id})
    if invoice is None:
        return None
    payments = await state.db.paymenteventdetails.find(
        {
            "company_id": company_id,
            "$or": [{"invoice_id": invoice_id}, {"invoice_tnx_id": invoice_id}],
            "status": {"$in": ["Received", "Verified", "Success"]},
        }
    ).to_list(length=None)
    received = sum(int(payment.get("amount_minor", payment.get("amount", 0)) or 0) for payment in payments)
    total = int(invoice.get("grand_total") or 0)
    if received <= 0:
        payment_status = "UnPaid"
    elif received < total:
        payment_status = "PartiallyPaid"
    elif received == total:
        payment_status = "Paid"
    else:
        payment_status = "OverPaid"
    due = max(total - received, 0)
    await state.db.invoicedetails.update_one(
        {"_id": invoice["_id"], "company_id": company_id},
        {"$set": {"amount_received": received, "due_amount": due, "payment_status": payment_status, "last_updated": now_utc()}},
    )
    invoice.update({"amount_received": received, "due_amount": due, "payment_status": payment_status})
    return invoice
