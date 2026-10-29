from __future__ import annotations

import asyncio
import json

import aio_pika

from app.core.state import AppState


SYSTEM_PROMPT = """
                You are an AI assistant that writes short outreach messages.
                Rules:
                - Maximum 4 lines.
                - Be clear, friendly, and natural.
                - Avoid fluff or filler.
                - Use common abbreviations where appropriate (AI, CRM, IT, API).
                - Prefer concise wording over long explanations.
                - Personalize using provided context.
                - Do not repeat the prompt.
                - Do not add greetings like "Hope you're doing well".
                Structure:
                Line 1: Context / personalization
                Line 2: Problem or insight
                Line 3: Suggestion or value
                Line 4: Light CTA
                Output only the message text, If context is insufficient generate generic text do not invent facts
            """


async def consume_jobs(state: AppState) -> None:
    if state.amqp is None:
        return
    channel = await state.amqp.channel()
    queue = await channel.declare_queue("LLM_INFERENCE", durable=False)
    async with queue.iterator() as queue_iter:
        async for message in queue_iter:
            asyncio.create_task(_handle_message(state, message))


async def _handle_message(state: AppState, message: aio_pika.IncomingMessage) -> None:
    async with message.process(ignore_processed=True):
        payload = json.loads(message.body.decode("utf-8"))
        client_id = payload["client_id"]
        final_prompt = f"{SYSTEM_PROMPT}\n\nUser Context:\n{payload['prompt']}\n"
        queue = state.clients.get(client_id)
        if queue is None:
            return

        try:
            async with state.http_client.stream(
                "POST",
                f"{state.config.ollama_url}/api/generate",
                json={
                    "model": "phi3:mini",
                    "prompt": final_prompt,
                    "stream": True,
                    "temperature": 0.3,
                    "top_p": 0.9,
                    "top_k": 40,
                    "repeat_penalty": 1.1,
                    "max_tokens": 200,
                    "stop": ["\n\n"],
                },
            ) as response:
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                        await queue.put(chunk.get("response", ""))
                        if chunk.get("done"):
                            break
                    except json.JSONDecodeError:
                        await queue.put(line)
        except Exception:
            return
