from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field


class EventTypes(str, Enum):
    inventory_item_created = "InventoryItemCreated"
    inventory_item_updated = "InventoryItemUpdated"
    inventory_item_deleted = "InventoryItemDeleted"
    inventory_item_reduced = "InventoryItemReduced"
    opening_stock_added = "OpeningStockAdded"
    stock_received = "StockReceived"
    manual_inventory_adjustment = "ManualInventoryAdjustment"
    invoice_stock_reduced = "InvoiceStockReduced"
    invoice_stock_restored = "InvoiceStockRestored"


class EntityType(str, Enum):
    inventory_item = "InventoryItem"


class Eventdetails(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    id: ObjectId = Field(alias="_id")
    entity_id: str
    entity_type: EntityType
    event_type: EventTypes
    metadata: Any | None = None
    created_at: datetime
    company_id: str
