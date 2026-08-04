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
) -> None:
    """Run one agent turn to completion in its own session, pushing frames.

    Always pushes a ``None`` sentinel when finished (success or failure) so the
    forwarder knows the turn is over.
    """
    stop = asyncio.Event()
    _stop_events[conversation_id] = stop
    try:
        async with AsyncSessionLocal() as db:
            try:
                if use_langgraph:
                    from services.agent.v2.supervisor import LangGraphSupervisor

                    agent = await LangGraphSupervisor.create(
                        db=db, user_id=user_id, conversation_id=conversation_id
                    )
                    agent.stop_event = stop
                    gen = agent.run(content, voice=voice)
                else:
                    from services.agent.executor import AgentExecutor

                    executor = await AgentExecutor.create(
                        db=db, user_id=user_id, conversation_id=conversation_id
                    )
                    executor.stop_event = stop
                    gen = executor._run(content, voice=voice)

                async for frame in gen:
                    await queue.put(frame)

                # v2 supervisor doesn't title conversations itself — give it the
                # same short-topic auto-title the v1 executor applies (idempotent).
                if use_langgraph:
                    try:
                        from services.agent.executor import _auto_title_conversation

                        await _auto_title_conversation(db, conversation_id, user_id, content)
                    except Exception:  # noqa: BLE001 — titling never fails the turn
                        logger.exception("Auto-title after v2 run failed")
            except Exception:
                logger.exception("Detached agent run failed")
                try:
                    await db.rollback()
                except Exception:
                    pass
                from models.schemas.conversations import WSError

                await queue.put(WSError(detail="Internal server error.").model_dump_json())
    finally:
        _stop_events.pop(conversation_id, None)
        await queue.put(None)


def spawn_agent_run(
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    content: str,
    queue: "asyncio.Queue[str | None]",
    use_langgraph: bool,
    voice: bool = False,
) -> asyncio.Task:
    """Start a detached agent run and return its task (also tracked internally)."""
    task = asyncio.create_task(
        _run_agent_to_queue(user_id, conversation_id, content, queue, use_langgraph, voice)
    )
    _active_runs.add(task)
    task.add_done_callback(_active_runs.discard)
    return task
