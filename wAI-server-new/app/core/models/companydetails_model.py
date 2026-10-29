from __future__ import annotations

from datetime import datetime

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field


class Companydetails(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    id: ObjectId = Field(alias="_id")
    name: str
    phone: str
    company_type: str
    industry: str | None = None
    user_id: str
    registered_gst: bool = True
    gstin: str
    pan: str
    address: str
    state: str
    territory: str | None = None
    country: str
    currency: str | None = None
    language: str | None = None
    time_zone: str | None = None
    fiscal_year: str | None = None
    last_verified: datetime
    is_active: bool
