from __future__ import annotations

from datetime import datetime

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field


class TaxRateBreakdown(BaseModel):
    tax_name: str
    tax_percentage: int


class Inventoryitemdetails(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    id: ObjectId = Field(alias="_id")
    company_id: str
    description: str = ""
    name: str
    code: str
    hsn_code: str
    uqc_code: str
    item_type: str = "GOODS"
    base_unit: str
    sub_unit: str = ""
    manufac_units: int = 0
    conversion_factor: int = 1
    unit_price: int = 0
    currency: str
    taxability: str = "TAXABLE"
    gst_rate_bps: int = 0
    cess_rate_bps: int = 0
    cost_price_minor: int
    selling_price_minor: int
    mrp_minor: int
    track_inventory: bool = False
    allow_negative_stock: bool = False
    reorder_level_base: int = 0
    reorder_quantity_base: int = 0
    alert_threshold: int | None = None
    tax: list[TaxRateBreakdown] = Field(default_factory=list)
    entered_at: datetime
    updated_at: datetime
    is_active: bool
    created_by: str = ""
    updated_by: str = ""
    total_sub_units: int | None = None
    qc_status: str | None = None
    batch_number: str | None = None
    mfg_date: datetime | None = None
    exp_date: datetime | None = None
    warehouse_location: str | None = None


class WarehouseAddress(BaseModel):
    line1: str = ""
    line2: str = ""
    city: str = ""
    district: str = ""
    state_code: str = ""
    state_name: str = ""
    postal_code: str = ""
    country_code: str = "IN"


class Warehousedetails(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    id: ObjectId = Field(alias="_id")
    company_id: str
    name: str
    address: WarehouseAddress
    phone: str | None = None
    is_default: bool
    is_active: bool
    created_at: datetime
    created_by: str
    updated_at: datetime
    updated_by: str


class Inventorybalancedetails(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    id: ObjectId = Field(alias="_id")
    company_id: str
    warehouse_id: str
    inventory_item_id: str
    batch_number: str
    manufactured_at: datetime | None = None
    expires_at: datetime | None = None
    qc_status: str
    quantity_on_hand_base: int
    quantity_reserved_base: int
    quantity_available_base: int
    batch_cost_price_minor: int
    updated_at: datetime


class Inventorymovementdetails(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    id: ObjectId = Field(alias="_id")
    company_id: str
    warehouse_id: str
    inventory_item_id: str
    batch_number: str
    movement_type: str
    quantity_delta_base: int
    quantity_before_base: int
    quantity_after_base: int
    reference_type: str
    reference_id: str
    reason_code: str
    reason: str
    idempotency_key: str
    created_by: str
    created_at: datetime
