"""タスク。ステータス：未着手 → 対応中 → 完了。"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from .. import audit
from ..common import check_version, get_alive, like_pattern, paginate, resolve_period, snapshot, today_jst
from ..db import get_db
from ..security import now  # 日時は Python 側で入れる（保存後すぐに画面へ返すため）
from ..deps import client_ip, current_user
from ..errors import AppError, NotFound
from ..models import OUTLOOK_LABELS, TASK_STATUS_LABELS, TASK_STATUSES, Customer, Project, Task, User
from ..permissions import can_delete, can_edit_project, can_edit_task, ensure, is_manager
from ..schemas import Page, Ref, TaskIn, TaskOut, TaskReportIn, TaskStatusIn, TaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["タスク"])
FIELDS = ("project_id", "title", "status", "priority", "start_date", "due_date", "assignee_id", "description")
PRIORITY_ORDER = case((Task.priority == "high", 0), (Task.priority == "medium", 1), else_=2)
SORTS = {"due_date": (Task.due_date.asc().nulls_last(), PRIORITY_ORDER), "priority": (PRIORITY_ORDER, Task.due_date.asc().nulls_last()),
         "updated_at": (Task.updated_at.desc(),)}


def to_out(user: User, t: Task) -> TaskOut:
    p = t.project
    return TaskOut(id=t.id, title=t.title, status=t.status, priority=t.priority, start_date=t.start_date, due_date=t.due_date,
                   description=t.description, completed_at=t.completed_at, project=Ref(id=p.id, name=p.name),
                   customer=Ref(id=p.customer.id, name=p.customer.name),
                   assignee=Ref(id=t.assignee.id, name=t.assignee.name) if t.assignee else None,
                   version=t.version, created_at=t.created_at, updated_at=t.updated_at,
                   overdue=t.status != "done" and t.due_date is not None and t.due_date < today_jst(),
                   progress=t.progress, outlook=t.outlook, report_note=t.report_note, reported_at=t.reported_at,
                   can_edit=can_edit_task(user, t), can_delete=can_delete(user))


def _assignee(db: Session, assignee_id: int | None) -> int | None:
    if assignee_id is None:
        return None
    u = db.get(User, assignee_id)
    if u is None or not u.active:
        raise NotFound("担当者が見つからないか、使用停止中です。")
    return u.id


STALE_DAYS = 7  # この日数、報告も変更もない未完了のタスクを「止まっている」とみなす


def stale_condition():
    """止まっているタスク：未完了で、最後の報告（なければ最後の変更）から STALE_DAYS 日以上たつ。"""
    return (Task.status != "done") & (func.coalesce(Task.reported_at, Task.updated_at) < now() - timedelta(days=STALE_DAYS))


def _set_status(t: Task, status: str) -> None:
    """状態に合わせて完了日時と進み具合をそろえる（完了＝100%、未着手＝0%）。"""
    if t.status == status:
        return
    old = t.status
    t.status = status
    t.completed_at = now() if status == "done" else None
    if status == "done":
        t.progress, t.outlook = 100, None
    elif status == "todo":
        t.progress = 0
    elif old == "done" and t.progress == 100:
        t.progress = 90


@router.get("", response_model=Page[TaskOut])
def list_tasks(q: str = Query("", max_length=100), status: list[Literal[TASK_STATUSES]] = Query(default=[]),  # type: ignore[valid-type]
               assignee_id: int | None = None, project_id: int | None = None, mine: bool = False,
               overdue: bool = False, at_risk: bool = False, stale: bool = False, due_from: date | None = None, due_to: date | None = None,
               sort: Literal["due_date", "priority", "updated_at"] = "due_date", page: int = 1, per_page: int = 20,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = (select(Task).join(Project, Task.project_id == Project.id).join(Customer, Project.customer_id == Customer.id)
             .where(Task.deleted_at.is_(None), Project.deleted_at.is_(None)))
    if q.strip():
        like = like_pattern(q.strip())
        query = query.where(or_(Task.title.ilike(like, escape="\\"), Project.name.ilike(like, escape="\\"),
                                Customer.name.ilike(like, escape="\\")))
    if status:
        query = query.where(Task.status.in_(status))
    if mine:
        query = query.where(Task.assignee_id == user.id)
    elif assignee_id:
        query = query.where(Task.assignee_id == assignee_id)
    if project_id:
        query = query.where(Task.project_id == project_id)
    if overdue:
        query = query.where(Task.status != "done", Task.due_date < today_jst())
    if at_risk:
        query = query.where(Task.status != "done", Task.outlook == "at_risk")
    if stale:
        query = query.where(stale_condition())
    if due_from:
        query = query.where(Task.due_date >= due_from)
    if due_to:
        query = query.where(Task.due_date <= due_to)
    query = query.order_by(*SORTS[sort], Task.id.desc())
    rows, total = paginate(db, query, page, per_page)
    return Page(items=[to_out(user, t) for (t,) in rows], total=total, page=page, per_page=min(per_page, 100))


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = get_alive(db, Task, task_id, "タスク")
    if t.project.deleted_at is not None:
        raise NotFound("タスクが見つかりません（案件が削除されています）。")
    return to_out(user, t)


@router.post("", response_model=TaskOut, status_code=201)
def create_task(body: TaskIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = get_alive(db, Project, body.project_id, "案件")
    # メンバーは、自分が担当の案件か、自分を担当者にするタスクだけ作れる
    ensure(is_manager(user) or can_edit_project(user, p) or body.assignee_id == user.id,
           "この案件にタスクを追加する権限がありません（案件の担当者か、自分を担当者にしたタスクだけ追加できます）。")
    data = body.model_dump(exclude={"status"})
    data["assignee_id"] = _assignee(db, body.assignee_id)
    data["start_date"] = resolve_period(body.start_date, body.due_date, None, "due_date", "期限")
    t = Task(**data, status="todo", created_by_id=user.id)
    db.add(t)
    db.flush()
    _set_status(t, body.status)
    db.flush()
    audit.record(db, user.id, "create", "task", t.id, f"タスク「{t.title}」を追加（案件「{p.name}」）",
                 audit.diff({}, snapshot(t, FIELDS)), client_ip(request))
    db.commit()
    db.refresh(t)
    return to_out(user, t)


@router.put("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, body: TaskUpdate, request: Request, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    t = get_alive(db, Task, task_id, "タスク")
    ensure(can_edit_task(user, t), "このタスクを変更する権限がありません（担当者・案件の担当者・マネージャー以上が変更できます）。")
    check_version(t, body.version)
    if body.project_id != t.project_id:
        p = get_alive(db, Project, body.project_id, "案件")
        ensure(is_manager(user) or can_edit_project(user, p), "移す先の案件にタスクを追加する権限がありません。")
    before = snapshot(t, FIELDS)
    data = body.model_dump(exclude={"version", "status"})
    data["assignee_id"] = _assignee(db, body.assignee_id)
    data["start_date"] = resolve_period(body.start_date, body.due_date, t.start_date, "due_date", "期限")
    for k, v in data.items():
        setattr(t, k, v)
    _set_status(t, body.status)
    db.flush()
    changes = audit.diff(before, snapshot(t, FIELDS))
    audit.record(db, user.id, "update", "task", t.id, f"タスク「{t.title}」を変更", changes, client_ip(request))
    db.commit()
    db.refresh(t)
    return to_out(user, t)


@router.patch("/{task_id}/status", response_model=TaskOut)
def change_status(task_id: int, body: TaskStatusIn, request: Request, user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    """一覧からステータスだけを変える（ボード・チェック用）。"""
    t = get_alive(db, Task, task_id, "タスク")
    ensure(can_edit_task(user, t), "このタスクを変更する権限がありません。")
    check_version(t, body.version)
    old = t.status
    _set_status(t, body.status)
    db.flush()
    if old != body.status:
        audit.record(db, user.id, "update", "task", t.id,
                     f"タスク「{t.title}」を{TASK_STATUS_LABELS[body.status]}に（{TASK_STATUS_LABELS[old]} から）",
                     {"status": [old, body.status]}, client_ip(request))
    db.commit()
    db.refresh(t)
    return to_out(user, t)


REPORT_FIELDS = ("status", "progress", "outlook", "report_note")


@router.patch("/{task_id}/report", response_model=TaskOut)
def report(task_id: int, body: TaskReportIn, request: Request, user: User = Depends(current_user),
           db: Session = Depends(get_db)):
    """担当者からの報告（進み具合・見通し・ひとこと）。マネージャーは「チームの状況」で見る。"""
    t = get_alive(db, Task, task_id, "タスク")
    ensure(can_edit_task(user, t), "このタスクを報告・変更する権限がありません。")
    if t.status == "done":
        raise AppError("完了したタスクには報告できません（「元に戻す」で未完了にしてから報告してください）。", 409)
    check_version(t, body.version)
    before = snapshot(t, REPORT_FIELDS)
    if body.progress is not None:
        t.progress = body.progress
        if t.status == "todo" and body.progress > 0:
            t.status = "doing"  # 進み始めたら対応中にする
    if body.outlook is not None:
        t.outlook = body.outlook
    t.report_note = body.note
    t.reported_at = now()
    db.flush()
    parts = [f"{t.progress}%"] + ([OUTLOOK_LABELS[t.outlook]] if t.outlook else [])
    summary = f"タスク「{t.title}」の進み具合を報告（{'・'.join(parts)}）" + (f"：{t.report_note}" if t.report_note else "")
    audit.record(db, user.id, "update", "task", t.id, summary[:200], audit.diff(before, snapshot(t, REPORT_FIELDS)),
                 client_ip(request))
    db.commit()
    db.refresh(t)
    return to_out(user, t)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ensure(can_delete(user), "削除はマネージャー以上ができます。")
    t = get_alive(db, Task, task_id, "タスク")
    t.deleted_at = now()
    audit.record(db, user.id, "delete", "task", t.id, f"タスク「{t.title}」を削除", ip=client_ip(request))
    db.commit()
