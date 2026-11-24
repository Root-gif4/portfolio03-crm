"""顧客。"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from .. import audit
from ..common import check_version, get_alive, like_pattern, paginate, snapshot
from ..db import get_db
from ..security import now  # 日時は Python 側で入れる（保存後すぐに画面へ返すため）
from ..deps import client_ip, current_user
from ..errors import Conflict, NotFound
from ..models import CLOSED_STATUSES, Customer, Project, User
from ..permissions import can_delete, can_edit_customer, ensure, is_manager
from ..schemas import CustomerIn, CustomerOut, CustomerUpdate, Page, Ref

router = APIRouter(prefix="/api/customers", tags=["顧客"])
FIELDS = ("name", "kana", "industry", "phone", "email", "address", "note", "owner_id")

_stats = (select(Project.customer_id.label("cid"),
                 func.count(Project.id).label("cnt"),
                 func.coalesce(func.sum(case((Project.status.not_in(CLOSED_STATUSES), Project.amount), else_=0)), 0)
                 .label("open_amount"))
          .where(Project.deleted_at.is_(None)).group_by(Project.customer_id).subquery())

SORTS = {"name": Customer.kana, "updated_at": Customer.updated_at.desc(), "created_at": Customer.created_at.desc(),
         "open_amount": _stats.c.open_amount.desc().nulls_last()}


def to_out(user: User, c: Customer, cnt: int = 0, open_amount: int = 0) -> CustomerOut:
    return CustomerOut(id=c.id, name=c.name, kana=c.kana, industry=c.industry, phone=c.phone, email=c.email,
                       address=c.address, note=c.note, owner=Ref(id=c.owner.id, name=c.owner.name), version=c.version,
                       created_at=c.created_at, updated_at=c.updated_at, project_count=cnt or 0,
                       open_amount=int(open_amount or 0), can_edit=can_edit_customer(user, c), can_delete=can_delete(user))


def _owner(db: Session, user: User, owner_id: int | None) -> int:
    """担当者。メンバーは自分だけ。"""
    if owner_id is None or owner_id == user.id:
        return user.id
    ensure(is_manager(user), "メンバーは、担当者を自分にした顧客だけを作成・変更できます。")
    owner = db.get(User, owner_id)
    if owner is None or not owner.active:
        raise NotFound("担当者が見つからないか、使用停止中です。")
    return owner.id


@router.get("", response_model=Page[CustomerOut])
def list_customers(q: str = Query("", max_length=100), industry: str = Query("", max_length=50),
                   owner_id: int | None = None, sort: Literal["name", "updated_at", "created_at", "open_amount"] = "name",
                   page: int = 1, per_page: int = 20,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = (select(Customer, _stats.c.cnt, _stats.c.open_amount)
             .outerjoin(_stats, _stats.c.cid == Customer.id)
             .where(Customer.deleted_at.is_(None)))
    if q.strip():
        like = like_pattern(q.strip())
        query = query.where(or_(*(col.ilike(like, escape="\\") for col in
                                  (Customer.name, Customer.kana, Customer.phone, Customer.email, Customer.address))))
    if industry:
        query = query.where(Customer.industry == industry)
    if owner_id:
        query = query.where(Customer.owner_id == owner_id)
    query = query.order_by(SORTS[sort], Customer.id)
    rows, total = paginate(db, query, page, per_page)
    return Page(items=[to_out(user, c, cnt, amt) for c, cnt, amt in rows], total=total, page=page,
                per_page=min(per_page, 100))


@router.get("/industries", response_model=list[str])
def industries(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [r for r in db.scalars(select(Customer.industry).where(Customer.deleted_at.is_(None), Customer.industry != "")
                                  .distinct().order_by(Customer.industry))]


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(customer_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = get_alive(db, Customer, customer_id, "顧客")
    row = db.execute(select(_stats.c.cnt, _stats.c.open_amount).where(_stats.c.cid == c.id)).first()
    return to_out(user, c, *(row or (0, 0)))


@router.post("", response_model=CustomerOut, status_code=201)
def create_customer(body: CustomerIn, request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    data = body.model_dump()
    data["owner_id"] = _owner(db, user, body.owner_id)
    c = Customer(**data)
    db.add(c)
    db.flush()
    audit.record(db, user.id, "create", "customer", c.id, f"顧客「{c.name}」を追加",
                 audit.diff({}, snapshot(c, FIELDS)), client_ip(request))
    db.commit()
    db.refresh(c)
    return to_out(user, c)


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(customer_id: int, body: CustomerUpdate, request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    c = get_alive(db, Customer, customer_id, "顧客")
    ensure(can_edit_customer(user, c), "この顧客を変更する権限がありません（担当者かマネージャー以上が変更できます）。")
    check_version(c, body.version)
    before = snapshot(c, FIELDS)
    data = body.model_dump(exclude={"version"})
    data["owner_id"] = c.owner_id if body.owner_id is None else _owner(db, user, body.owner_id)
    for k, v in data.items():
        setattr(c, k, v)
    changes = audit.diff(before, snapshot(c, FIELDS))
    audit.record(db, user.id, "update", "customer", c.id, f"顧客「{c.name}」を変更", changes, client_ip(request))
    db.commit()
    db.refresh(c)
    return get_customer(c.id, user, db)


@router.delete("/{customer_id}", status_code=204)
def delete_customer(customer_id: int, request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    ensure(can_delete(user), "削除はマネージャー以上ができます。")
    c = get_alive(db, Customer, customer_id, "顧客")
    n = db.scalar(select(func.count()).select_from(Project)
                  .where(Project.customer_id == c.id, Project.deleted_at.is_(None))) or 0
    if n:
        raise Conflict(f"この顧客には案件が {n} 件あるため削除できません。先に案件を削除してください。")
    c.deleted_at = now()
    audit.record(db, user.id, "delete", "customer", c.id, f"顧客「{c.name}」を削除", ip=client_ip(request))
    db.commit()
