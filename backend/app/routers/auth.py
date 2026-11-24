"""ログイン・ログアウト・自分の情報・パスワード変更。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from .. import audit, security
from ..config import get_settings
from ..db import get_db
from ..deps import check_csrf, client_ip, current_user
from ..errors import AppError, Unauthorized
from ..models import User
from ..permissions import can_delete, is_manager
from ..schemas import LoginIn, MeOut, PasswordChange

router = APIRouter(prefix="/api/auth", tags=["認証"])


def me_out(user: User) -> MeOut:
    return MeOut(id=user.id, email=user.email, name=user.name, role=user.role, active=user.active,
                 last_login_at=user.last_login_at, can_manage_users=user.role == "admin",
                 can_view_audit=is_manager(user), can_view_team=is_manager(user), can_delete=can_delete(user))


def _set_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(s.cookie_name, token, max_age=s.session_hours * 3600, httponly=True,
                        samesite="lax", secure=s.cookie_secure, path="/")


@router.post("/login", response_model=MeOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    check_csrf(request)
    try:
        user = security.authenticate(db, body.email, body.password)
    except Unauthorized:
        # 失敗回数とロックは保存してから、失敗を返す
        audit.record(db, None, "login_failed", "user", None, f"ログイン失敗：{body.email[:100]}", ip=client_ip(request))
        db.commit()
        raise
    # ログインのたびにセッションを新しくする（セッション固定攻撃の対策）
    security.delete_session(db, request.cookies.get(get_settings().cookie_name))
    token = security.create_session(db, user)
    audit.record(db, user.id, "login", "user", user.id, f"{user.name} がログイン", ip=client_ip(request))
    db.commit()
    _set_cookie(response, token)
    return me_out(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    check_csrf(request)
    s = get_settings()
    user = security.user_from_token(db, request.cookies.get(s.cookie_name))
    security.delete_session(db, request.cookies.get(s.cookie_name))
    if user:
        audit.record(db, user.id, "logout", "user", user.id, f"{user.name} がログアウト", ip=client_ip(request))
    db.commit()
    response.delete_cookie(s.cookie_name, path="/")
    response.status_code = 204
    return response


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user)):
    return me_out(user)


@router.post("/password", status_code=204)
def change_password(body: PasswordChange, request: Request, response: Response,
                    user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not security.verify_password(body.current_password, user.password_hash):
        raise AppError("今のパスワードが違います。", field="current_password")
    if body.current_password == body.new_password:
        raise AppError("新しいパスワードは、今と違うものにしてください。", field="new_password")
    user.password_hash = security.hash_password(body.new_password)
    # ほかの端末のログインも切り、この端末は新しいセッションにする
    security.delete_user_sessions(db, user.id)
    token = security.create_session(db, user)
    audit.record(db, user.id, "password_change", "user", user.id, f"{user.name} がパスワードを変更", ip=client_ip(request))
    db.commit()
    _set_cookie(response, token)
    response.status_code = 204
    return response
