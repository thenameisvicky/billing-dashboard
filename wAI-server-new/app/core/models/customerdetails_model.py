from __future__ import annotations

from datetime import datetime

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field


class Customerdetails(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    id: ObjectId = Field(alias="_id")
    company_id: str
    user_id: str
    name: str
    phone: str
    gstin: str | None = None
    email: str | None = None
    address: str | None = None
    notes: str | None = None
    customer_type: str
    billing_state: str
    campaign_id: str | None = None
    created_at: datetime
    updated_at: datetime
    is_active: bool
