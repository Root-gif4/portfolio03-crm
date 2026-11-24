"""チームの状況（マネージャー以上）：メンバーごとのタスクの数と、気にかけたいタスク。"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..common import today_jst
from ..db import get_db
from ..deps import current_user
from ..models import ROLE_LABELS, Project, Task, User
from ..permissions import ensure, is_manager
from .tasks import STALE_DAYS, stale_condition, to_out

router = APIRouter(prefix="/api/team", tags=["チームの状況"])


@router.get("/status")
def team_status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    ensure(is_manager(user), "チームの状況はマネージャー以上が見られます。")
    today = today_jst()
    open_t = (Task.deleted_at.is_(None), Project.deleted_at.is_(None), Task.status != "done")
    overdue = Task.due_date < today
    week = (Task.due_date >= today) & (Task.due_date <= today + timedelta(days=7))
    at_risk = Task.outlook == "at_risk"
    stale = stale_condition()

    rows = db.execute(
        select(Task.assignee_id, func.count(), func.count().filter(Task.status == "doing"), func.count().filter(overdue),
               func.count().filter(week), func.count().filter(at_risk), func.count().filter(stale),
               func.coalesce(func.avg(Task.progress), 0), func.max(Task.reported_at))
        .join(Project, Task.project_id == Project.id).where(*open_t).group_by(Task.assignee_id)).all()
    stats = {r[0]: r for r in rows}

    def member(uid, name, role):
        r = stats.get(uid)
        n = lambda i: int(r[i]) if r else 0  # noqa: E731
        return {"id": uid, "name": name, "role": role, "role_label": ROLE_LABELS.get(role, ""),
                "open": n(1), "doing": n(2), "overdue": n(3), "due_week": n(4), "at_risk": n(5), "stale": n(6),
                "avg_progress": round(float(r[7])) if r else 0,
                "last_report_at": r[8].isoformat() if r and r[8] else None}

    users = db.scalars(select(User).where(User.active.is_(True)).order_by(User.id)).all()
    members = [member(u.id, u.name, u.role) for u in users]
    if None in stats:  # 担当者が決まっていないタスク
        members.append(member(None, "（担当者なし）", ""))

    def tasks(cond, order):
        q = (select(Task).join(Project, Task.project_id == Project.id).where(*open_t, cond)
             .order_by(*order, Task.id).limit(20))
        return [to_out(user, t).model_dump(mode="json") for t in db.scalars(q)]

    return {
        "today": today.isoformat(),
        "stale_days": STALE_DAYS,
        "members": members,
        "at_risk": tasks(at_risk, (Task.due_date.asc().nulls_last(),)),
        "overdue": tasks(overdue, (Task.due_date,)),
        "stale": tasks(stale, (func.coalesce(Task.reported_at, Task.updated_at),)),
    }
