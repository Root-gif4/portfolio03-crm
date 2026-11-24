"""パスワード（Argon2）とセッション。"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .errors import AppError, Unauthorized
from .models import User, UserSession

_hasher = PasswordHasher()
# ユーザーが見つからないときも同じくらい時間をかける（いるかいないかを応答時間で知られないように）
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing")

MIN_PASSWORD = 10
MAX_PASSWORD = 128


def now() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    check_password_rules(password)
    return _hasher.hash(password)


def check_password_rules(password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise AppError(f"パスワードは {MIN_PASSWORD} 文字以上にしてください。", field="password")
    if len(password) > MAX_PASSWORD:
        raise AppError(f"パスワードは {MAX_PASSWORD} 文字以内にしてください。", field="password")
    if password.isdigit() or password.isalpha():
        raise AppError("パスワードには英字と数字（または記号）を混ぜてください。", field="password")


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


LOGIN_FAILED = "メールアドレスまたはパスワードが違います。"


def authenticate(db: Session, email: str, password: str) -> User:
    """ログイン。続けて失敗するとしばらくロックする。失敗の理由（メールが違う・パスワードが違う）は区別しない。"""
    s = get_settings()
    user = db.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))
    if user is None or not user.active:
        verify_password(password, None)
        raise Unauthorized(LOGIN_FAILED)
    if user.locked_until and user.locked_until > now():
        verify_password(password, None)
        minutes = max(1, int((user.locked_until - now()).total_seconds() // 60) + 1)
        raise Unauthorized(f"続けて失敗したため、ログインを一時的に止めています。約 {minutes} 分後にもう一度お試しください。")
    if not verify_password(password, user.password_hash):
        user.failed_logins += 1
        if user.failed_logins >= s.max_failed_logins:
            user.locked_until = now() + timedelta(minutes=s.lock_minutes)
            user.failed_logins = 0
        raise Unauthorized(LOGIN_FAILED)
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now()
    if _hasher.check_needs_rehash(user.password_hash):
        user.password_hash = _hasher.hash(password)
    return user


def create_session(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    db.add(UserSession(token_hash=_token_hash(token), user_id=user.id,
                       expires_at=now() + timedelta(hours=get_settings().session_hours)))
    # 古いセッションの片付け
    db.execute(delete(UserSession).where(UserSession.expires_at < now()))
    return token


def user_from_token(db: Session, token: str | None) -> User | None:
    if not token or len(token) > 200:
        return None
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == _token_hash(token)))
    if sess is None or sess.expires_at <= now():
        return None
    user = db.get(User, sess.user_id)
    if user is None or not user.active:
        return None
    return user


def delete_session(db: Session, token: str | None) -> None:
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == _token_hash(token)))


def delete_user_sessions(db: Session, user_id: int) -> None:
    """パスワード変更・無効化・権限変更のときは、その人のログインをすべて切る。"""
    db.execute(delete(UserSession).where(UserSession.user_id == user_id))


def require_login(user: User | None) -> User:
    if user is None:
        raise Unauthorized("ログインしてください。")
    return user
