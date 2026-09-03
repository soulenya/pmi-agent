"""Deleting a project and everything that was only ever part of it.

Foreign keys cannot express this on their own. Some of a project's furniture is
owned by it outright (tasks, its workroom, its conversation) and must go with
it; some merely points at it (a budget is a Drive sheet that outlives any
project) and must be let go of instead. Postgres would otherwise leave the first
group orphaned, since `tasks.project_id` carries no ON DELETE at all.
"""

from __future__ import annotations

from sqlalchemy import delete as sa_delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.budget import Budget
from models.db.conversation import AgentRun, Conversation
from models.db.research import ResearchReport
from models.db.task import Project, Task
from models.db.workroom import Workroom


async def delete_project(db: AsyncSession, project: Project) -> None:
    """Remove the project and its own work. Does not commit.

    Cascades already handle members, links, the canvas and custody records.
    """
    # The sheet is not ours to destroy; say so here rather than leave it to a
    # migration's ON DELETE, which the ORM would not see.
    await db.execute(
        update(Budget).where(Budget.project_id == project.id).values(project_id=None)
    )
    task_ids = (
        await db.execute(select(Task.id).where(Task.project_id == project.id))
    ).scalars().all()
    if task_ids:
        # A subtask kept elsewhere must not be left pointing at a task that is going.
        await db.execute(
            update(Task)
            .where(Task.parent_task_id.in_(task_ids))
            .values(parent_task_id=None)
        )
        await db.execute(sa_delete(Task).where(Task.id.in_(task_ids)))

    rooms = (
        await db.execute(select(Workroom).where(Workroom.project_id == project.id))
    ).scalars().all()
    conv_ids = [r.conversation_id for r in rooms if r.conversation_id]
    for room in rooms:
        await db.delete(room)

    if conv_ids:
        # These reference a conversation without a cascade, so they would block it.
        for model, column in (
            (Task, Task.source_conversation_id),
            (AgentRun, AgentRun.conversation_id),
            (ResearchReport, ResearchReport.conversation_id),
        ):
            await db.execute(
                update(model).where(column.in_(conv_ids)).values({column: None})
            )
        await db.execute(sa_delete(Conversation).where(Conversation.id.in_(conv_ids)))

    await db.delete(project)
