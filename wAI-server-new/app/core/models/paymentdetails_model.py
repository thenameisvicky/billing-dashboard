from __future__ import annotations

from datetime import datetime
from enum import Enum

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field


class PaymentStatus(str, Enum):
    pending = "Pending"
    success = "Success"
    failed = "Failed"
    refunded = "Refunded"


class Paymentdetails(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    id: ObjectId = Field(alias="_id")
    invoice_id: str
    company_id: str
    internal_tnx_id: str
    amount: int
    mode: str
    currency: str
    provider: str
    external_txn_id: str
    installment_no: int
    status: PaymentStatus
    updated_at: datetime
    created_at: datetime
