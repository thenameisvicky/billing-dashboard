from __future__ import annotations

from dataclasses import dataclass


@dataclass
class WhatsAppResult:
    accepted: bool
    provider_message_id: str | None = None
    failure_code: str | None = None
    failure_message: str | None = None


class WhatsAppAdapter:
    def __init__(self, state):
        self.state = state

    async def send_invoice_message(
        self,
        *,
        phone: str,
        customer_name: str,
        invoice_number: str,
        invoice_url: str,
        amount_due: int,
        due_date: str | None,
    ) -> WhatsAppResult:
        config = self.state.config
        if not config.whatsapp_provider_url or not config.whatsapp_provider_token:
            return WhatsAppResult(False, failure_code="CONFIG_MISSING", failure_message="WhatsApp provider URL/token is not configured")

        response = await self.state.http_client.post(
            config.whatsapp_provider_url,
            headers={"Authorization": f"Bearer {config.whatsapp_provider_token}"},
            json={
                "phone": phone,
                "customer_name": customer_name,
                "invoice_number": invoice_number,
                "invoice_url": invoice_url,
                "amount_due": amount_due,
                "due_date": due_date,
            },
        )
        data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
        accepted = response.is_success and str(data.get("status", "")).lower() not in {"error", "failed", "failure"}
        return WhatsAppResult(
            accepted=accepted,
            provider_message_id=str(data.get("message_id") or data.get("id") or "") or None,
            failure_code=None if accepted else str(data.get("code") or response.status_code),
            failure_message=None if accepted else str(data.get("message") or data.get("error") or response.text),
        )
