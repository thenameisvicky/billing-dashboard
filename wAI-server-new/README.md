# wAI Server New

Python/FastAPI backend that mirrors the existing Rust backend route surface.

Run with uv:

```bash
uv run wai-server-new --amqp-uri <amqp> --mongo-uri <mongo> --mongo-database <db> --ollama-url <ollama> --jwt-secret <secret> --app-base-url <base-url>
```

The server listens on port `3000`.
