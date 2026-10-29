from __future__ import annotations

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field


class Userdetails(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, populate_by_name=True)

    id: ObjectId = Field(alias="_id")
    company_id: str
    username: str
    password: str
    email: str
    role: str
    is_active: bool
    tutorial_completed: bool = False
