# Billing Dashboard

Monorepo for the billing dashboard: React client (`wAI-client`) and FastAPI server (`wAI-server-new`).

```
billing-dashboard/
├── wAI-client/        # React + Rspack UI (dev: :3009)
└── wAI-server-new/    # FastAPI backend (dev: :8082)
```

## Prerequisites

- Node.js 18+
- Python 3.11+
- [uv](https://docs.astral.sh/uv/)
- MongoDB
- AMQP broker (e.g. RabbitMQ)
- Ollama (optional, for AI features)

## 1. Backend (`wAI-server-new`)

```bash
cd wAI-server-new
uv sync
```

Create a `.env` in `wAI-server-new/` (or pass flags to the CLI):

```env
AMQP_URI=amqp://guest:guest@localhost:5672/
MONGO_URI=mongodb://localhost:27017
MONGO_DATABASE=wai
OLLAMA_URL=http://localhost:11434
JWT_SECRET=change-me
PUBIC_TOKEN_SECRET=change-me
APP_BASE_URL=http://localhost:8082
RAZORPAY_WEBHOOK_SECRET=change-me

# Optional
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
WHATSAPP_PROVIDER_URL=
WHATSAPP_PROVIDER_TOKEN=
REPORT_TIMEZONE=Asia/Kolkata
```

Start the API (listens on **8082**):

```bash
uv run wai-server-new
```

Or with explicit flags:

```bash
uv run wai-server-new \
  --amqp-uri "$AMQP_URI" \
  --mongo-uri "$MONGO_URI" \
  --mongo-database "$MONGO_DATABASE" \
  --ollama-url "$OLLAMA_URL" \
  --jwt-secret "$JWT_SECRET" \
  --public-token-secret "$PUBIC_TOKEN_SECRET" \
  --app-base-url "$APP_BASE_URL" \
  --razorpay-webhook-secret "$RAZORPAY_WEBHOOK_SECRET"
```

## 2. Frontend (`wAI-client`)

In a second terminal:

```bash
cd wAI-client
npm install
npm run dev
```

UI runs at **http://localhost:3009**. Dev server proxies `/api` → `http://localhost:8082`.

## Quick start (both)

```bash
# Terminal 1 — API
cd wAI-server-new && uv sync && uv run wai-server-new

# Terminal 2 — UI
cd wAI-client && npm install && npm run dev
```

Open http://localhost:3009

## Production build (client)

```bash
cd wAI-client
npm run build
# output in wAI-client/dist
```
