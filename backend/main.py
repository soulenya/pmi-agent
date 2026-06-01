"""
PMI Agent — FastAPI application factory.
Binds to 127.0.0.1 only. CORS restricted to Tauri + localhost origins.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from config import settings
from database import engine
from routers import audit, auth, documents, health, search, users
from sqlalchemy import text

logger = logging.getLogger(__name__)

# ── Rate limiter ─────────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Verify DB connectivity at startup
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))
    yield
    await engine.dispose()


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title="PMI Agent API",
        version="0.1.0",
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        lifespan=lifespan,
    )

    # Rate limiting
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # CORS — Tauri desktop shell + local dev server only
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "tauri://localhost",
            "https://tauri.localhost",
            "http://localhost:5173",
            "http://localhost:1420",
        ],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # Routers
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(audit.router)
    app.include_router(users.router)
    app.include_router(documents.router)
    app.include_router(search.router)

    # ── WebSocket: real-time chat stream ─────────────────────────────────────
    @app.websocket("/ws/chat/{conversation_id}")
    async def ws_chat(websocket: WebSocket, conversation_id: str) -> None:
        """
        WebSocket endpoint for streaming AI responses.
        Phase C (LangGraph agents) will fill in the business logic.
        For now: echo back messages as a placeholder.
        """
        await websocket.accept()
        try:
            while True:
                data = await websocket.receive_text()
                # Placeholder — real streaming added in Phase C
                await websocket.send_json(
                    {"type": "token", "content": data, "conversation_id": conversation_id}
                )
        except WebSocketDisconnect:
            logger.info("WebSocket disconnected: conversation=%s", conversation_id)

    return app


app = create_app()


# ── Entry point (uvicorn direct) ─────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",  # localhost only — never 0.0.0.0
        port=settings.port,
        reload=settings.debug,
    )
