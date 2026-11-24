"""案件（商談）。ステータス：見込み → 提案中 → 交渉中 → 受注／失注。"""

from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import case, func, or_, select, update
from sqlalchemy.orm import Session

from .. import audit
from ..common import check_version, get_alive, like_pattern, paginate, resolve_period, snapshot
from ..db import get_db
from ..security import now  # 日時は Python 側で入れる（保存後すぐに画面へ返すため）
from ..deps import client_ip, current_user
from ..errors import NotFound
from ..models import CLOSED_STATUSES, PROJECT_STATUS_LABELS, PROJECT_STATUSES, Customer, Project, Task, User
from ..permissions import can_delete, can_edit_project, ensure, is_manager
from ..schemas import Page, ProjectIn, ProjectOut, ProjectUpdate, Ref

router = APIRouter(prefix="/api/projects", tags=["案件"])
FIELDS = ("customer_id", "name", "status", "amount", "start_date", "expected_close_date", "description", "owner_id")

_task_stats = (select(Task.project_id.label("pid"), func.count(Task.id).label("total"),
                      func.coalesce(func.sum(case((Task.status != "done", 1), else_=0)), 0).label("open"))
               .where(Task.deleted_at.is_(None)).group_by(Task.project_id).subquery())

SORTS = {"updated_at": Project.updated_at.desc(), "amount": Project.amount.desc(),
         "expected_close_date": Project.expected_close_date.asc().nulls_last(), "name": Project.name,
         "start_date": Project.start_date.desc()}


def to_out(user: User, p: Project, total: int = 0, open_: int = 0) -> ProjectOut:
    return ProjectOut(id=p.id, name=p.name, status=p.status, amount=p.amount, start_date=p.start_date,
                      expected_close_date=p.expected_close_date, closed_at=p.closed_at, description=p.description,
                      customer=Ref(id=p.customer.id, name=p.customer.name), owner=Ref(id=p.owner.id, name=p.owner.name),
                      version=p.version, created_at=p.created_at, updated_at=p.updated_at, task_total=total or 0,
                      task_open=open_ or 0, can_edit=can_edit_project(user, p), can_delete=can_delete(user),
                      can_reopen=is_manager(user))


def _owner(db: Session, user: User, owner_id: int | None) -> int:
    if owner_id is None or owner_id == user.id:
        return user.id
    ensure(is_manager(user), "メンバーは、担当者を自分にした案件だけを作成・変更できます。")
    owner = db.get(User, owner_id)
    if owner is None or not owner.active:
        raise NotFound("担当者が見つからないか、使用停止中です。")
    return owner.id


def _apply_status(user: User, p: Project, new_status: str) -> None:
    """ステータスの決まり：受注・失注にすると閉じた日時を記録。閉じた案件を戻せるのはマネージャー以上。"""
    old = p.status
    if old == new_status:
        return
    if old in CLOSED_STATUSES and new_status not in CLOSED_STATUSES:
        ensure(is_manager(user), f"「{PROJECT_STATUS_LABELS[old]}」の案件を進行中に戻せるのはマネージャー以上です。")
    p.status = new_status
    if new_status in CLOSED_STATUSES:
        p.closed_at = now()
    else:
        p.closed_at = None


@router.get("", response_model=Page[ProjectOut])
def list_projects(q: str = Query("", max_length=100), status: list[Literal[PROJECT_STATUSES]] = Query(default=[]),  # type: ignore[valid-type]
                  owner_id: int | None = None, customer_id: int | None = None,
                  amount_min: int | None = Query(None, ge=0), amount_max: int | None = Query(None, ge=0),
                  close_from: date | None = None, close_to: date | None = None, mine: bool = False, open_only: bool = False,
                  sort: Literal["updated_at", "amount", "expected_close_date", "name", "start_date"] = "updated_at",
                  page: int = 1, per_page: int = 20, user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = (select(Project, _task_stats.c.total, _task_stats.c.open)
             .join(Customer, Project.customer_id == Customer.id)
             .outerjoin(_task_stats, _task_stats.c.pid == Project.id)
             .where(Project.deleted_at.is_(None)))
    if q.strip():
        like = like_pattern(q.strip())
        query = query.where(or_(Project.name.ilike(like, escape="\\"), Customer.name.ilike(like, escape="\\")))
    if status:
        query = query.where(Project.status.in_(status))
    if open_only:
        query = query.where(Project.status.not_in(CLOSED_STATUSES))
    if mine:
        query = query.where(Project.owner_id == user.id)
    elif owner_id:
        query = query.where(Project.owner_id == owner_id)
    if customer_id:
        query = query.where(Project.customer_id == customer_id)
    if amount_min is not None:
        query = query.where(Project.amount >= amount_min)
    if amount_max is not None:
        query = query.where(Project.amount <= amount_max)
    if close_from:
        query = query.where(Project.expected_close_date >= close_from)
    if close_to:
        query = query.where(Project.expected_close_date <= close_to)
    query = query.order_by(SORTS[sort], Project.id.desc())
    rows, total = paginate(db, query, page, per_page)
    return Page(items=[to_out(user, p, t, o) for p, t, o in rows], total=total, page=page, per_page=min(per_page, 100))


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = get_alive(db, Project, project_id, "案件")
    row = db.execute(select(_task_stats.c.total, _task_stats.c.open).where(_task_stats.c.pid == p.id)).first()
    return to_out(user, p, *(row or (0, 0)))


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, request: Request, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    get_alive(db, Customer, body.customer_id, "顧客")
    data = body.model_dump(exclude={"status"})
    data["owner_id"] = _owner(db, user, body.owner_id)
    data["start_date"] = resolve_period(body.start_date, body.expected_close_date, None, "expected_close_date", "受注予定日")
    p = Project(**data, status="lead")
    db.add(p)
    db.flush()
    _apply_status(user, p, body.status)
    db.flush()
    audit.record(db, user.id, "create", "project", p.id, f"案件「{p.name}」を追加",
                 audit.diff({}, snapshot(p, FIELDS)), client_ip(request))
    db.commit()
    db.refresh(p)
    return to_out(user, p)


@router.put("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, body: ProjectUpdate, request: Request, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    p = get_alive(db, Project, project_id, "案件")
    ensure(can_edit_project(user, p), "この案件を変更する権限がありません（担当者かマネージャー以上が変更できます）。")
    check_version(p, body.version)
    if body.customer_id != p.customer_id:
        get_alive(db, Customer, body.customer_id, "顧客")
    before = snapshot(p, FIELDS)
    data = body.model_dump(exclude={"version", "status"})
    data["owner_id"] = p.owner_id if body.owner_id is None else _owner(db, user, body.owner_id)
    data["start_date"] = resolve_period(body.start_date, body.expected_close_date, p.start_date,
                                        "expected_close_date", "受注予定日")
    for k, v in data.items():
        setattr(p, k, v)
    _apply_status(user, p, body.status)
    db.flush()
    changes = audit.diff(before, snapshot(p, FIELDS))
    summary = f"案件「{p.name}」を変更"
    if "status" in changes:
        summary += f"（{PROJECT_STATUS_LABELS[before['status']]} → {PROJECT_STATUS_LABELS[p.status]}）"
    audit.record(db, user.id, "update", "project", p.id, summary, changes, client_ip(request))
    db.commit()
    return get_project(p.id, user, db)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, request: Request, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    ensure(can_delete(user), "削除はマネージャー以上ができます。")
    p = get_alive(db, Project, project_id, "案件")
    n = db.execute(update(Task).where(Task.project_id == p.id, Task.deleted_at.is_(None))
                   .values(deleted_at=now())).rowcount
    p.deleted_at = now()
    audit.record(db, user.id, "delete", "project", p.id, f"案件「{p.name}」を削除（タスク {n} 件も削除）",
                 ip=client_ip(request))
    db.commit()
