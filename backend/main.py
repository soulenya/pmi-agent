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
from database import engine, get_db
from routers import audit, auth, documents, health, search, users
from routers.conversations import approvals_router, notifications_router, router as conversations_router
from routers.tasks import projects_router, router as tasks_router
from routers.regulatory import capa_router, router as regulatory_router
from routers.briefings import router as briefings_router
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
    app.include_router(conversations_router)
    app.include_router(approvals_router)
    app.include_router(notifications_router)
    app.include_router(tasks_router)
    app.include_router(projects_router)
    app.include_router(regulatory_router)
    app.include_router(capa_router)
    app.include_router(briefings_router)

    # ── WebSocket: real-time chat stream ─────────────────────────────────────
    @app.websocket("/ws/chat/{conversation_id}")
    async def ws_chat(websocket: WebSocket, conversation_id: str) -> None:
        """
        WebSocket endpoint for streaming AI responses.

        Authentication: pass JWT access token as query param `?token=<jwt>`
        (standard browsers cannot set Authorization headers on WebSocket upgrades).

        Client → server: {"type": "human", "content": "<user message>"}
        Server → client: WSToken | WSDone | WSError (JSON strings)
        """
        from models.schemas.conversations import WSError, WSIncoming
        from services.agent.executor import AgentExecutor
        from services.auth.service import AuthService

        # ── Authenticate via query param token ────────────────────────────────
        token = websocket.query_params.get("token", "")
        if not token:
            await websocket.close(code=4401, reason="Missing token")
            return

        async for db in get_db():
            auth_svc = AuthService(db)
            user = await auth_svc.get_user_from_access_token(token)
            if user is None:
                await websocket.close(code=4401, reason="Invalid token")
                return

            await websocket.accept()
            logger.info("WebSocket connected: user=%s conversation=%s", user.id, conversation_id)

            # Verify conversation belongs to user
            from repositories.conversation_repo import ConversationRepository
            import uuid as uuid_mod
            try:
                conv_uuid = uuid_mod.UUID(conversation_id)
            except ValueError:
                await websocket.send_text(WSError(detail="Invalid conversation ID.").model_dump_json())
                await websocket.close()
                return

            conv_repo = ConversationRepository(db)
            conv = await conv_repo.get(conv_uuid, user.id)
            if conv is None:
                await websocket.send_text(WSError(detail="Conversation not found.").model_dump_json())
                await websocket.close()
                return

            try:
                while True:
                    raw = await websocket.receive_text()
                    try:
                        incoming = WSIncoming.model_validate_json(raw)
                    except Exception:
                        await websocket.send_text(
                            WSError(detail="Invalid message format.").model_dump_json()
                        )
                        continue

                    if incoming.type == "ping":
                        await websocket.send_text('{"type":"pong"}')
                        continue

                    if incoming.type != "human" or not incoming.content.strip():
                        continue

                    executor = AgentExecutor(
                        db=db,
                        user_id=user.id,
                        conversation_id=conv_uuid,
                    )
                    async for frame in executor._run(incoming.content.strip()):
                        await websocket.send_text(frame)

            except WebSocketDisconnect:
                logger.info("WebSocket disconnected: user=%s conversation=%s", user.id, conversation_id)
            except Exception as exc:
                logger.exception("WebSocket error: %s", exc)
                try:
                    await websocket.send_text(WSError(detail="Internal server error.").model_dump_json())
                    await websocket.close()
                except Exception:
                    pass
            break  # exit the get_db() generator after one iteration

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
