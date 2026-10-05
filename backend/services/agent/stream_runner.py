"""Detached agent-run streaming.

Runs the agent (v1 executor or v2 supervisor) in a BACKGROUND task with its own
database session, pushing JSON frames into an ``asyncio.Queue`` that the chat
WebSocket forwards to the client.

Why: previously the agent generator was consumed directly inside the WebSocket
send loop. If the user navigated away (closing the socket), the generator was
cancelled mid-run and the final ``db.commit()`` never happened — the assistant's
answer was lost. By detaching the run into an independent task with its own
session, the work always completes and the answer is persisted, even if no
client is listening. When the user returns, the chat history (reloaded from the
DB) shows the completed answer.
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from database import AsyncSessionLocal

logger = logging.getLogger(__name__)

# Keep strong references so background runs are not garbage-collected mid-flight.
_active_runs: set[asyncio.Task] = set()

# conversation_id -> the event its run watches. Cancellation is COOPERATIVE:
# task.cancel() would abandon the transaction mid-flight and lose the partial
# answer, so the agent checks this between steps and stops cleanly instead.
_stop_events: dict[uuid.UUID, asyncio.Event] = {}


class _Run:
    """One in-flight turn: every frame so far, and every socket listening.

    A socket that opens mid-turn (the person came back to the conversation)
    gets the buffered frames first, then live ones, so the screen catches up
    to exactly where the run is instead of sitting blank until it finishes.
    """

    __slots__ = ("frames", "subscribers")

    def __init__(self, first: "asyncio.Queue[str | None]") -> None:
        self.frames: list[str] = []
        self.subscribers: set[asyncio.Queue[str | None]] = {first}

    async def publish(self, frame: str | None) -> None:
        if frame is not None:
            self.frames.append(frame)
        for q in list(self.subscribers):
            await q.put(frame)


_live: dict[uuid.UUID, _Run] = {}

RESUMED_FRAME = '{"type":"resumed"}'


def attach(conversation_id: uuid.UUID) -> "asyncio.Queue[str | None] | None":
    """Subscribe to the turn running for this conversation, replaying what has
    streamed so far. None when nothing is running."""
    run = _live.get(conversation_id)
    if run is None:
        return None
    q: asyncio.Queue[str | None] = asyncio.Queue()
    q.put_nowait(RESUMED_FRAME)
    for frame in run.frames:
        q.put_nowait(frame)
    run.subscribers.add(q)
    return q


def detach(conversation_id: uuid.UUID, q: "asyncio.Queue[str | None]") -> None:
    run = _live.get(conversation_id)
    if run is not None:
        run.subscribers.discard(q)


def request_stop(conversation_id: uuid.UUID) -> bool:
    """Ask the run for this conversation to stop. False if nothing is running."""
    event = _stop_events.get(conversation_id)
    if event is None:
        return False
    event.set()
    return True


def is_running(conversation_id: uuid.UUID) -> bool:
    return conversation_id in _stop_events


async def _run_agent_to_queue(
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    content: str,
    queue: "asyncio.Queue[str | None]",
    use_langgraph: bool,
    voice: bool = False,
    phone: bool = False,
) -> None:
    """Run one agent turn to completion in its own session, pushing frames.

    Always pushes a ``None`` sentinel when finished (success or failure) so the
    forwarder knows the turn is over.
    """
    stop = asyncio.Event()
    _stop_events[conversation_id] = stop
    run = _Run(queue)
    _live[conversation_id] = run
    try:
        async with AsyncSessionLocal() as db:
            try:
                if use_langgraph:
                    from services.agent.v2.supervisor import LangGraphSupervisor

                    agent = await LangGraphSupervisor.create(
                        db=db, user_id=user_id, conversation_id=conversation_id
                    )
                    agent.stop_event = stop
                    gen = agent.run(content, voice=voice, phone=phone)
                else:
                    from services.agent.executor import AgentExecutor

                    executor = await AgentExecutor.create(
                        db=db, user_id=user_id, conversation_id=conversation_id
                    )
                    executor.stop_event = stop
                    gen = executor._run(content, voice=voice, phone=phone)

                async for frame in gen:
                    await run.publish(frame)

                # v2 supervisor doesn't title conversations itself — give it the
                # same short-topic auto-title the v1 executor applies (idempotent).
                if use_langgraph:
                    try:
                        from services.agent.executor import _auto_title_conversation

                        await _auto_title_conversation(db, conversation_id, user_id, content)
                    except Exception:  # noqa: BLE001 — titling never fails the turn
                        logger.exception("Auto-title after v2 run failed")

                # Offer the turn to the hub from here, not from the socket: the
                # socket may be gone by now and the answer must still travel.
                from config import settings

                if not settings.hub_mode:
                    try:
                        await db.commit()
                        from services.hub import conv_sync

                        await conv_sync.after_turn(db, user_id, conversation_id)
                        await db.commit()
                    except Exception:  # noqa: BLE001 — never costs the answer
                        logger.exception("Hub sync after turn failed")
                        await db.rollback()
            except Exception:
                logger.exception("Detached agent run failed")
                try:
                    await db.rollback()
                except Exception:
                    pass
                from models.schemas.conversations import WSError

                await run.publish(WSError(detail="Internal server error.").model_dump_json())
    finally:
        _stop_events.pop(conversation_id, None)
        _live.pop(conversation_id, None)
        await run.publish(None)


def spawn_agent_run(
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    content: str,
    queue: "asyncio.Queue[str | None]",
    use_langgraph: bool,
    voice: bool = False,
    phone: bool = False,
) -> asyncio.Task:
    """Start a detached agent run and return its task (also tracked internally)."""
    task = asyncio.create_task(
        _run_agent_to_queue(user_id, conversation_id, content, queue, use_langgraph, voice, phone)
    )
    _active_runs.add(task)
    task.add_done_callback(_active_runs.discard)
    return task
