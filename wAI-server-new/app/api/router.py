from __future__ import annotations

from fastapi import APIRouter

from app.core.websocket.handler import router as websocket_router
from app.modules.agent.routes import router as agent_router
from app.modules.analytics.routes import router as analytics_router
from app.modules.automations.routes import router as automations_router
from app.modules.auth.routes import router as auth_router
from app.modules.campaign.routes import router as campaign_router
from app.modules.customer.routes import router as customer_router
from app.modules.feed.routes import router as feed_router
from app.modules.gstr1.routes import router as gstr1_router
from app.modules.inventory.routes import router as inventory_router
from app.modules.invoice_imports.routes import router as invoice_imports_router
from app.modules.invoice.routes import router as invoice_router
from app.modules.payments.routes import router as payments_router
from app.modules.reports.routes import router as reports_router


def create_api_router() -> APIRouter:
    router = APIRouter()
    router.include_router(auth_router)
    router.include_router(agent_router)
    router.include_router(customer_router)
    router.include_router(inventory_router)
    router.include_router(invoice_router)
    router.include_router(invoice_imports_router)
    router.include_router(automations_router)
    router.include_router(payments_router)
    router.include_router(reports_router)
    router.include_router(gstr1_router)
    router.include_router(feed_router)
    router.include_router(campaign_router)
    router.include_router(analytics_router)
    router.include_router(websocket_router)
    return router
