from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field


class CustomerEngagementTypes(str, Enum):
    customer_created = "CustomerCreated"
    customer_updated = "CustomerUpdated"
    customer_deleted = "CustomerDeleted"
    customer_paid = "CustomerPaid"
    added_to_invoice = "AddedToInvoice"
    whatsapp_message_sent = "WhatsappMessageSent"


class CustomerEntityType(str, Enum):
    customer = "Customer"
    invoice = "Invoice"
    payment = "Payment"


class Customerengagementdetails(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    id: ObjectId = Field(alias="_id")
    entity_id: str
    entity_type: CustomerEntityType
    event_type: CustomerEngagementTypes
    metadata: Any | None = None
    created_at: datetime
    company_id: str
