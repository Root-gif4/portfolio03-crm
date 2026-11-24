"""ユーザー管理（管理者だけ）と、選択肢用のユーザー一覧（全員）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit, security
from ..common import snapshot
from ..db import get_db
from ..deps import client_ip, current_user, require_roles
from ..errors import AppError, Conflict, NotFound
from ..models import ROLE_LABELS, User
from ..schemas import PasswordReset, Ref, UserCreate, UserOut, UserUpdate

router = APIRouter(prefix="/api/users", tags=["ユーザー"])
admin_only = require_roles("admin")


@router.get("/options", response_model=list[Ref])
def options(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """担当者の選択肢（使用中のユーザー）。"""
    return [Ref(id=u.id, name=u.name) for u in db.scalars(select(User).where(User.active.is_(True)).order_by(User.id))]


@router.get("", response_model=list[UserOut])
def list_users(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    return list(db.scalars(select(User).order_by(User.id)))


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    if db.scalar(select(User.id).where(func.lower(User.email) == body.email)):
        raise Conflict("このメールアドレスはもう登録されています。")
    user = User(email=body.email, name=body.name, role=body.role, password_hash=security.hash_password(body.password))
    db.add(user)
    db.flush()
    audit.record(db, admin.id, "create", "user", user.id, f"ユーザー「{user.name}」（{ROLE_LABELS[user.role]}）を追加",
                 {"email": [None, user.email], "role": [None, user.role]}, client_ip(request))
    db.commit()
    return user


def _other_admins(db: Session, user_id: int) -> int:
    return db.scalar(select(func.count()).select_from(User)
                     .where(User.role == "admin", User.active.is_(True), User.id != user_id)) or 0


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, request: Request, admin: User = Depends(admin_only),
                db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise NotFound("ユーザーが見つかりません。")
    losing_admin = user.role == "admin" and (body.role != "admin" or not body.active)
    if losing_admin and _other_admins(db, user.id) == 0:
        raise AppError("使用中の管理者が 1 人もいなくなるため、変更できません。")
    before = snapshot(user, ("name", "role", "active"))
    user.name, user.role, user.active = body.name, body.role, body.active
    changes = audit.diff(before, snapshot(user, ("name", "role", "active")))
    if "role" in changes or "active" in changes:
        security.delete_user_sessions(db, user.id)  # 権限が変わったら、ログインし直してもらう
    if changes:
        audit.record(db, admin.id, "update", "user", user.id, f"ユーザー「{user.name}」を変更", changes, client_ip(request))
    db.commit()
    return user


@router.post("/{user_id}/password", status_code=204)
def reset_password(user_id: int, body: PasswordReset, request: Request, admin: User = Depends(admin_only),
                   db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise NotFound("ユーザーが見つかりません。")
    user.password_hash = security.hash_password(body.new_password)
    user.failed_logins, user.locked_until = 0, None
    security.delete_user_sessions(db, user.id)
    audit.record(db, admin.id, "password_reset", "user", user.id, f"ユーザー「{user.name}」のパスワードを再設定",
                 ip=client_ip(request))
    db.commit()
