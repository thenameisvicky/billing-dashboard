from __future__ import annotations

import time

import bcrypt
import jwt
from bson import ObjectId
from fastapi import APIRouter, Request

from app.core.bson import now_utc
from app.core.response import json_response
from app.utils.validation import is_valid_gstin


router = APIRouter()


@router.post("/signup")
async def signup(request: Request, payload: dict):
    state = request.app.state.app_state
    existing = await state.db.userdetails.find_one({"email": payload.get("email")})
    if existing is not None:
        return json_response({"status": "error", "message": "User already exists"})

    registered_gst = bool(payload.get("registered_gst", True))
    if registered_gst and not is_valid_gstin(str(payload.get("gstin", ""))):
        return json_response({"status": "error", "message": "Invalid company GSTIN format"})

    company_id = ObjectId()
    user_id = ObjectId()
    password = str(payload.get("password", "")).encode("utf-8")
    hashed_password = bcrypt.hashpw(password, bcrypt.gensalt(rounds=10)).decode("utf-8")

    company = {
        "_id": company_id,
        "name": payload.get("name"),
        "phone": payload.get("phone"),
        "company_type": payload.get("company_type"),
        "industry": payload.get("industry") or payload.get("company_type"),
        "user_id": str(user_id),
        "gstin": payload.get("gstin") if registered_gst else "",
        "pan": payload.get("pan"),
        "address": payload.get("address") or "",
        "state": payload.get("state") or payload.get("territory"),
        "territory": payload.get("territory") or payload.get("state"),
        "country": payload.get("country"),
        "currency": payload.get("currency") or "INR",
        "language": payload.get("language") or "English",
        "time_zone": payload.get("time_zone") or payload.get("timeZone") or "Asia/Kolkata",
        "fiscal_year": payload.get("fiscal_year") or payload.get("fiscalYear") or "Apr-Mar",
        "registered_gst": registered_gst,
        "last_verified": now_utc(),
        "is_active": True,
    }
    user = {
        "_id": user_id,
        "company_id": str(company_id),
        "username": payload.get("username"),
        "password": hashed_password,
        "email": payload.get("email"),
        "role": "owner",
        "is_active": True,
        "tutorial_completed": False,
    }

    company_result = await state.db.companydetails.insert_one(company)
    if not company_result.acknowledged:
        return json_response({"status": "error", "message": "Company failed"})

    user_result = await state.db.userdetails.insert_one(user)
    if not user_result.acknowledged:
        await state.db.companydetails.delete_one({"_id": company_id})
        return json_response({"status": "error", "message": "User failed"})

    return json_response({"status": "success"})


@router.get("/me")
async def me(request: Request):
    user = request.state.user
    return json_response(
        {
            "status": "success",
            "data": {
                "id": str(user["_id"]),
                "company_id": user.get("company_id"),
                "username": user.get("username"),
                "email": user.get("email"),
                "role": user.get("role"),
                "tutorial_completed": bool(user.get("tutorial_completed", False)),
            },
        }
    )


@router.patch("/me/tutorial")
async def update_tutorial(request: Request, payload: dict):
    state = request.app.state.app_state
    completed = bool(payload.get("completed", True))
    await state.db.userdetails.update_one(
        {"_id": request.state.user["_id"]},
        {"$set": {"tutorial_completed": completed}},
    )
    return json_response({"status": "success", "tutorial_completed": completed})


@router.post("/login")
async def login(request: Request, payload: dict):
    state = request.app.state.app_state
    user = await state.db.userdetails.find_one({"username": payload.get("username")})
    if user is None:
        return json_response({"status": "error", "message": "Invalid credentials"})

    password = str(payload.get("password", "")).encode("utf-8")
    hashed_password = str(user.get("password", "")).encode("utf-8")
    if not bcrypt.checkpw(password, hashed_password):
        return json_response({"status": "error", "message": "Invalid credentials"})

    token = jwt.encode(
        {
            "sub": str(user["_id"]),
            "company_id": user["company_id"],
            "exp": int(time.time()) + 7 * 24 * 60 * 60,
        },
        state.config.jwt_secret,
        algorithm="HS256",
    )
    return json_response({"status": "success", "token": token})
