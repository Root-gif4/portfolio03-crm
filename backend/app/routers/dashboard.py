"""ダッシュボード：数字・案件のステータス別・月別の受注・自分のタスク・最近の動き。"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..common import JST, today_jst
from ..db import get_db
from ..deps import current_user
from ..models import CLOSED_STATUSES, PROJECT_STATUSES, AuditLog, Customer, Project, Task, User
from ..permissions import is_manager
from .tasks import to_out as task_out

router = APIRouter(prefix="/api/dashboard", tags=["ダッシュボード"])


def _month_starts(today: date, n: int) -> list[date]:
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append(date(y, m, 1))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return list(reversed(out))


@router.get("")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    today = today_jst()
    alive_p = Project.deleted_at.is_(None)

    # 案件のステータス別（件数・金額）
    rows = db.execute(select(Project.status, func.count(), func.coalesce(func.sum(Project.amount), 0))
                      .where(alive_p).group_by(Project.status)).all()
    by_status = {s: {"status": s, "count": 0, "amount": 0} for s in PROJECT_STATUSES}
    for s, cnt, amt in rows:
        by_status[s] = {"status": s, "count": int(cnt), "amount": int(amt)}

    # 月別の受注金額（直近 6 か月、受注にした日＝日本時間で数える）
    months = _month_starts(today, 6)
    month_expr = func.to_char(func.timezone("Asia/Tokyo", Project.closed_at), "YYYY-MM")
    won = dict(db.execute(select(month_expr, func.coalesce(func.sum(Project.amount), 0))
                          .where(alive_p, Project.status == "won", Project.closed_at.is_not(None),
                                 func.timezone("Asia/Tokyo", Project.closed_at) >= months[0])
                          .group_by(month_expr)).all())
    monthly_won = [{"month": m.strftime("%Y-%m"), "amount": int(won.get(m.strftime("%Y-%m"), 0))} for m in months]

    # 自分のタスク（期限切れ・7 日以内）
    my_open = (select(Task).join(Project, Task.project_id == Project.id)
               .where(Task.deleted_at.is_(None), alive_p, Task.assignee_id == user.id, Task.status != "done"))
    overdue = list(db.scalars(my_open.where(Task.due_date < today).order_by(Task.due_date).limit(10)))
    soon = list(db.scalars(my_open.where(Task.due_date >= today, Task.due_date <= today + timedelta(days=7))
                           .order_by(Task.due_date).limit(10)))

    open_projects = sum(v["count"] for k, v in by_status.items() if k not in CLOSED_STATUSES)
    pipeline = sum(v["amount"] for k, v in by_status.items() if k not in CLOSED_STATUSES)
    closed = by_status["won"]["count"] + by_status["lost"]["count"]
    # 期限切れの件数：マネージャー以上はチーム全体、メンバーは自分が担当のものだけ
    overdue_q = (select(func.count()).select_from(Task).join(Project, Task.project_id == Project.id)
                 .where(Task.deleted_at.is_(None), alive_p, Task.status != "done", Task.due_date < today))
    if not is_manager(user):
        overdue_q = overdue_q.where(Task.assignee_id == user.id)
    all_overdue = db.scalar(overdue_q) or 0

    # 近く締める予定の案件（30 日以内、進行中）
    closing = db.execute(select(Project.id, Project.name, Project.amount, Project.expected_close_date, Project.status,
                                Customer.name)
                         .join(Customer, Project.customer_id == Customer.id)
                         .where(alive_p, Project.status.not_in(CLOSED_STATUSES),
                                Project.expected_close_date.is_not(None),
                                Project.expected_close_date <= today + timedelta(days=30))
                         .order_by(Project.expected_close_date).limit(8)).all()

    # 最近の動き（マネージャー以上は操作履歴、メンバーは自分の操作）
    recent_q = select(AuditLog).where(AuditLog.action.in_(("create", "update", "delete")))
    if not is_manager(user):
        recent_q = recent_q.where(AuditLog.user_id == user.id)
    recent = db.scalars(recent_q.order_by(AuditLog.id.desc()).limit(8))

    return {
        "today": today.isoformat(),
        "kpi": {
            "customers": db.scalar(select(func.count()).select_from(Customer).where(Customer.deleted_at.is_(None))) or 0,
            "open_projects": open_projects,
            "pipeline_amount": pipeline,
            "won_this_month": monthly_won[-1]["amount"],
            "win_rate": round(by_status["won"]["count"] / closed * 100) if closed else None,
            "overdue_tasks": int(all_overdue),
            "overdue_scope": "all" if is_manager(user) else "mine",
        },
        "by_status": list(by_status.values()),
        "monthly_won": monthly_won,
        "my_overdue": [task_out(user, t).model_dump(mode="json") for t in overdue],
        "my_due_soon": [task_out(user, t).model_dump(mode="json") for t in soon],
        "closing_soon": [{"id": i, "name": n, "amount": int(a), "expected_close_date": d.isoformat(), "status": s,
                          "customer": c} for i, n, a, d, s, c in closing],
        "recent": [{"id": r.id, "created_at": r.created_at.astimezone(JST).isoformat(), "user": r.user.name if r.user else "",
                    "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id, "summary": r.summary}
                   for r in recent],
    }
