from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any


STATE_CODES = {
    "Jammu & Kashmir": "01",
    "Himachal Pradesh": "02",
    "Punjab": "03",
    "Chandigarh": "04",
    "Uttarakhand": "05",
    "Haryana": "06",
    "Delhi": "07",
    "Rajasthan": "08",
    "Uttar Pradesh": "09",
    "Bihar": "10",
    "Sikkim": "11",
    "Arunachal Pradesh": "12",
    "Nagaland": "13",
    "Manipur": "14",
    "Mizoram": "15",
    "Tripura": "16",
    "Meghalaya": "17",
    "Assam": "18",
    "West Bengal": "19",
    "Jharkhand": "20",
    "Odisha": "21",
    "Chhattisgarh": "22",
    "Madhya Pradesh": "23",
    "Gujarat": "24",
    "Dadra & Nagar Haveli and Daman & Diu": "26",
    "Maharashtra": "27",
    "Karnataka": "29",
    "Goa": "30",
    "Lakshadweep": "31",
    "Kerala": "32",
    "Tamil Nadu": "33",
    "Puducherry": "34",
    "Andaman & Nicobar Islands": "35",
    "Telangana": "36",
    "Andhra Pradesh": "37",
    "Ladakh": "38",
}


def parse_period(period: str | None) -> tuple[str, datetime, datetime]:
    if period:
        year_text, month_text = period.split("-", 1)
        year = int(year_text)
        month = int(month_text)
    else:
        now = datetime.now(timezone.utc)
        year = now.year
        month = now.month

    if month < 1 or month > 12:
        raise ValueError("Invalid month")

    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return f"{month:02d}{year}", start, end


def export_filename(period: str) -> str:
    return f"gstr1-{period[2:]}-{period[:2]}.json"


def paise_to_rupees(value: Any) -> float:
    amount = Decimal(int(value or 0)) / Decimal(100)
    return float(amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def tax_rate(tax: dict[str, Any]) -> float:
    return float((Decimal(int(tax.get("tax_percentage") or 0)) / Decimal(100)).quantize(Decimal("0.01")))


def invoice_date(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%d-%m-%Y")
    return datetime.now(timezone.utc).strftime("%d-%m-%Y")


def gst_state_code(gstin: str | None) -> str | None:
    if gstin and len(gstin) >= 2 and gstin[:2].isdigit():
        return gstin[:2]
    return None


def place_of_supply(invoice: dict[str, Any], customer: dict[str, Any] | None) -> str:
    customer_gstin = invoice.get("customer_gst")
    code = gst_state_code(customer_gstin)
    if code:
        return code

    billing_state = customer.get("billing_state") if customer else None
    if billing_state in STATE_CODES:
        return STATE_CODES[billing_state]

    return "97"


def is_inter_state(invoice: dict[str, Any], supplier_gstin: str | None, customer: dict[str, Any] | None) -> bool:
    supply = str(invoice.get("place_of_supply") or "").lower()
    if "inter" in supply:
        return True
    if "intra" in supply:
        return False

    supplier_state = gst_state_code(supplier_gstin)
    pos = place_of_supply(invoice, customer)
    return bool(supplier_state and pos and supplier_state != pos)


def line_tax_amounts(invoice: dict[str, Any], line: dict[str, Any], customer: dict[str, Any] | None) -> dict[str, float]:
    tax_total = int(line.get("line_tax_total") or 0)
    if is_inter_state(invoice, invoice.get("supplier_gst"), customer):
        return {"iamt": paise_to_rupees(tax_total), "camt": 0.0, "samt": 0.0, "csamt": 0.0}

    half = tax_total // 2
    remainder = tax_total - half
    return {"iamt": 0.0, "camt": paise_to_rupees(half), "samt": paise_to_rupees(remainder), "csamt": 0.0}


def build_b2b_invoice(invoice: dict[str, Any], customer: dict[str, Any] | None) -> dict[str, Any]:
    items = []
    for index, line in enumerate(invoice.get("items") or [], start=1):
        first_tax = (line.get("tax_details") or [{}])[0]
        item_detail = {
            "rt": tax_rate(first_tax),
            "txval": paise_to_rupees(line.get("line_subtotal")),
            **line_tax_amounts(invoice, line, customer),
        }
        items.append({"num": index, "itm_det": item_detail})

    return {
        "inum": invoice.get("invoice_number") or invoice.get("invoice_tnx_id"),
        "idt": invoice_date(invoice.get("created_at")),
        "val": paise_to_rupees(invoice.get("grand_total")),
        "pos": place_of_supply(invoice, customer),
        "rchrg": "N",
        "inv_typ": "R",
        "itms": items,
    }


def build_b2cs_summary(invoices: list[tuple[dict[str, Any], dict[str, Any] | None]]) -> list[dict[str, Any]]:
    summaries: dict[tuple[str, float], dict[str, Any]] = {}
    for invoice, customer in invoices:
        pos = place_of_supply(invoice, customer)
        inter_state = is_inter_state(invoice, invoice.get("supplier_gst"), customer)
        for line in invoice.get("items") or []:
            first_tax = (line.get("tax_details") or [{}])[0]
            rate = tax_rate(first_tax)
            key = (pos, rate)
            current = summaries.setdefault(
                key,
                {"sply_ty": "INTER" if inter_state else "INTRA", "pos": pos, "typ": "OE", "rt": rate, "txval": 0.0, "iamt": 0.0, "camt": 0.0, "samt": 0.0, "csamt": 0.0},
            )
            amounts = line_tax_amounts(invoice, line, customer)
            current["txval"] = round(current["txval"] + paise_to_rupees(line.get("line_subtotal")), 2)
            for field in ("iamt", "camt", "samt", "csamt"):
                current[field] = round(current[field] + amounts[field], 2)
    return list(summaries.values())


def build_gstr1_json(company: dict[str, Any] | None, invoices: list[dict[str, Any]], customers: dict[str, dict[str, Any]], period: str) -> dict[str, Any]:
    b2b: dict[str, list[dict[str, Any]]] = {}
    b2cs_invoices: list[tuple[dict[str, Any], dict[str, Any] | None]] = []

    for invoice in invoices:
        customer = customers.get(str(invoice.get("customer_id")))
        customer_gst = str(invoice.get("customer_gst") or "").strip().upper()
        if customer_gst and customer_gst != "N/A":
            b2b.setdefault(customer_gst, []).append(build_b2b_invoice(invoice, customer))
        else:
            b2cs_invoices.append((invoice, customer))

    payload = {
        "gstin": (company or {}).get("gstin", "N/A"),
        "fp": period,
        "version": "GST3.1.6",
        "hash": "hash",
        "b2b": [{"ctin": ctin, "inv": entries} for ctin, entries in sorted(b2b.items())],
        "b2cs": build_b2cs_summary(b2cs_invoices),
        "doc_issue": {
            "doc_det": [
                {
                    "doc_num": 1,
                    "docs": [
                        {
                            "num": 1,
                            "from": min((invoice.get("invoice_number") or "" for invoice in invoices), default=""),
                            "to": max((invoice.get("invoice_number") or "" for invoice in invoices), default=""),
                            "totnum": len(invoices),
                            "cancel": 0,
                            "net_issue": len(invoices),
                        }
                    ],
                }
            ]
        },
    }
    return payload


def to_download_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
