"""予定表（ガントチャート）：案件とタスクを、開始日から期限までの帯で見るためのデータ。"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from ..common import today_jst
from ..db import get_db
from ..deps import current_user
from ..errors import AppError
from ..models import CLOSED_STATUSES, Customer, Project, Task, User

router = APIRouter(prefix="/api/schedule", tags=["予定表"])
MAX_DAYS = 370
MAX_PROJECTS = 200


@router.get("")
def schedule(start: date | None = None, end: date | None = None, owner_id: int | None = None, mine: bool = False,
             include_closed: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    today = today_jst()
    start = start or today.replace(day=1)
    end = end or (start + timedelta(days=62))
    if end < start:
        raise AppError("終わりの日は始まりの日より後にしてください。", 422, "end")
    if (end - start).days > MAX_DAYS:
        raise AppError(f"一度に見られるのは {MAX_DAYS} 日までです。", 422, "end")

    alive_t = Task.deleted_at.is_(None)
    # 期間が表示の範囲と重なる案件（受注予定日がなければ開始日の 1 日だけ）
    p_end = func.coalesce(Project.expected_close_date, Project.start_date)
    query = (select(Project).join(Customer, Project.customer_id == Customer.id)
             .where(Project.deleted_at.is_(None), Project.start_date <= end, p_end >= start))
    if not include_closed:
        query = query.where(Project.status.not_in(CLOSED_STATUSES))
    if mine:
        mine_task = exists().where(Task.project_id == Project.id, alive_t, Task.assignee_id == user.id)
        query = query.where(or_(Project.owner_id == user.id, mine_task))
    elif owner_id:
        query = query.where(Project.owner_id == owner_id)
    projects = list(db.scalars(query.order_by(Project.start_date, Project.id).limit(MAX_PROJECTS + 1)))
    truncated = len(projects) > MAX_PROJECTS
    projects = projects[:MAX_PROJECTS]

    tasks_by_project: dict[int, list[Task]] = {p.id: [] for p in projects}
    if projects:
        for t in db.scalars(select(Task).where(alive_t, Task.project_id.in_(tasks_by_project))
                            .order_by(Task.start_date, Task.due_date.asc().nulls_last(), Task.id)):
            tasks_by_project[t.project_id].append(t)

    def task_row(t: Task) -> dict:
        return {"id": t.id, "title": t.title, "status": t.status, "priority": t.priority,
                "start_date": t.start_date.isoformat(), "due_date": t.due_date.isoformat() if t.due_date else None,
                "assignee": {"id": t.assignee.id, "name": t.assignee.name} if t.assignee else None,
                "overdue": t.status != "done" and t.due_date is not None and t.due_date < today}

    return {
        "start": start.isoformat(), "end": end.isoformat(), "today": today.isoformat(), "truncated": truncated,
        "projects": [{
            "id": p.id, "name": p.name, "status": p.status, "amount": p.amount,
            "customer": {"id": p.customer.id, "name": p.customer.name},
            "owner": {"id": p.owner.id, "name": p.owner.name},
            "start_date": p.start_date.isoformat(),
            "expected_close_date": p.expected_close_date.isoformat() if p.expected_close_date else None,
            "tasks": [task_row(t) for t in tasks_by_project[p.id]],
        } for p in projects],
    }
