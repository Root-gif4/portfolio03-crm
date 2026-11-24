"""API の共通の前処理：ログイン中の利用者・CSRF 対策・権限。"""

from __future__ import annotations

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .errors import Forbidden
from .models import User
from .security import require_login, user_from_token

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def check_csrf(request: Request) -> None:
    """書き換えの API は独自のヘッダーを必須にする。

    ほかのサイトからのフォーム送信や画像の読み込みでは独自のヘッダーを付けられず、
    付けようとすると CORS の事前確認が必要になる（このアプリはほかのサイトを許可しない）。
    """
    s = get_settings()
    if request.method in UNSAFE_METHODS and request.headers.get(s.csrf_header) != s.csrf_value:
        raise Forbidden("不正なリクエストです（画面から操作してください）。")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    check_csrf(request)
    user = user_from_token(db, request.cookies.get(get_settings().cookie_name))
    user = require_login(user)
    request.state.user = user
    return user


def require_roles(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise Forbidden("この操作をする権限がありません。")
        return user
    return dep


def client_ip(request: Request) -> str:
    return (request.client.host if request.client else "")[:45]
