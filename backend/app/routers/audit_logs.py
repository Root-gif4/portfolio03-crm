"""操作履歴（マネージャー以上が見られる）。"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..common import JST, like_pattern, paginate
from ..db import get_db
from ..deps import require_roles
from ..models import AuditLog, User
from ..schemas import AuditOut, Page, Ref

router = APIRouter(prefix="/api/audit-logs", tags=["操作履歴"])


@router.get("", response_model=Page[AuditOut])
def list_logs(user_id: int | None = None,
              action: Literal["", "create", "update", "delete", "login", "logout", "login_failed",
                              "password_change", "password_reset"] = "",
              entity_type: Literal["", "customer", "project", "task", "user"] = "", entity_id: int | None = None,
              q: str = Query("", max_length=100), date_from: date | None = None, date_to: date | None = None,
              page: int = 1, per_page: int = 50,
              viewer: User = Depends(require_roles("admin", "manager")), db: Session = Depends(get_db)):
    query = select(AuditLog)
    if user_id:
        query = query.where(AuditLog.user_id == user_id)
    if action:
        query = query.where(AuditLog.action == action)
    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    if entity_id:
        query = query.where(AuditLog.entity_id == entity_id)
    if q.strip():
        query = query.where(AuditLog.summary.ilike(like_pattern(q.strip()), escape="\\"))
    if date_from:
        query = query.where(AuditLog.created_at >= datetime.combine(date_from, time.min, JST))
    if date_to:
        query = query.where(AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), time.min, JST))
    rows, total = paginate(db, query.order_by(AuditLog.id.desc()), page, per_page)
    items = [AuditOut(id=a.id, created_at=a.created_at, user=Ref(id=a.user.id, name=a.user.name) if a.user else None,
                      action=a.action, entity_type=a.entity_type, entity_id=a.entity_id, summary=a.summary,
                      changes=a.changes, ip=a.ip) for (a,) in rows]
    return Page(items=items, total=total, page=page, per_page=min(per_page, 100))
