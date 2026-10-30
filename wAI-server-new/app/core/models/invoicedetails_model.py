from __future__ import annotations

from datetime import datetime
from enum import Enum

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field

from app.core.models.inventoryitemdetails_model import TaxRateBreakdown


class InvoiceStatus(str, Enum):
    draft = "Draft"
    issued = "Issued"
    sent = "Sent"
    partially_paid = "PartiallyPaid"
    paid = "Paid"
    overdue = "Overdue"
    cancelled = "Cancelled"
    superseded = "Superseded"


class PaymentStatus(str, Enum):
    paid = "Paid"
    partially_paid = "PartiallyPaid"
    unpaid = "UnPaid"
    overpaid = "OverPaid"


class LifecycleStatus(str, Enum):
    draft = "DRAFT"
    issued = "ISSUED"
    cancelled = "CANCELLED"


class DeliveryStatus(str, Enum):
    not_sent = "NOT_SENT"
    pending = "PENDING"
    sent = "SENT"
    failed = "FAILED"


class InvoiceSource(str, Enum):
    manual = "MANUAL"
    csv_import = "CSV_IMPORT"
    pos_import = "POS_IMPORT"
    ai = "AI"


class InventoryEffect(str, Enum):
    apply_on_issue = "APPLY_ON_ISSUE"
    none = "NONE"


class InvoiceItems(BaseModel):
    inventory_id: str | None = None
    quantity: int
    unit: str
    unit_price: int
    batch_number: str | None = None
    tax_details: list[TaxRateBreakdown]
    hsn_code: str
    line_subtotal: int | None = None
    line_tax_total: int | None = None
    line_grand_total: int | None = None


class Invoicedetails(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    id: ObjectId = Field(alias="_id")
    user_id: str
    company_id: str
    customer_id: str
    invoice_tnx_id: str
    invoice_number: str
    created_at: datetime
    last_updated: datetime
    place_of_supply: str
    items: list[InvoiceItems]
    customer_gst: str
    total_amount: int
    total_tax_amount: int
    discount_amount: int | None = None
    discount_percentage: int | None = None
    grand_total: int
    due_amount: int
    status: InvoiceStatus
    payment_status: PaymentStatus
    currency: str
    due_date: datetime | None = None
    payment_link: str
    supplier_gst: str
    invoice_type: str
    previous_invoice_id: str | None = None
    version_number: int | None = None
    is_active: bool
    lifecycle_status: LifecycleStatus | None = None
    delivery_status: DeliveryStatus | None = None
    source: InvoiceSource | None = None
    created_by_ai: bool = False
    inventory_effect: InventoryEffect | None = None
    inventory_applied: bool = False
    issued_at: datetime | None = None
    issue_method: str | None = None
    seller_snapshot: dict | None = None
    buyer_snapshot: dict | None = None
    item_snapshot: list[dict] | None = None
    public_token: str | None = None
    amount_received: int = 0
