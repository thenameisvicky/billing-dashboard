from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field


class EventTypes(str, Enum):
    invoice_created = "InvoiceCreated"
    invoice_updated = "InvoiceUpdated"
    invoice_deleted = "InvoiceDeleted"
    invoice_sent = "InvoiceSent"
    invoice_issued = "InvoiceIssued"
    invoice_imported = "InvoiceImported"
    whatsapp_delivery_failed = "WhatsappDeliveryFailed"
    payment_received = "PaymentReceived"
    payment_verified = "PaymentVerified"
    payment_failed = "PaymentFailed"
    gstr1_import_completed = "Gstr1ImportCompleted"
    gstr1_export_generated = "Gstr1ExportGenerated"


class EntityType(str, Enum):
    invoice = "Invoice"
    payment = "Payment"


class Invoiceeventdetails(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    id: ObjectId = Field(alias="_id")
    entity_id: str
    entity_type: EntityType
    event_type: EventTypes
    metadata: Any | None = None
    created_at: datetime
    company_id: str
