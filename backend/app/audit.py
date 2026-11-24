"""操作履歴の記録。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from .models import AuditLog

SECRET_FIELDS = {"password", "password_hash"}


def _plain(v: Any) -> Any:
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, list[Any]]:
    """変わった項目だけ {項目: [前, 後]}。パスワードは記録しない。"""
    out = {}
    for key, new in after.items():
        if key in SECRET_FIELDS:
            continue
        old = before.get(key)
        if old != new:
            out[key] = [_plain(old), _plain(new)]
    return out


def record(db: Session, user_id: int | None, action: str, entity_type: str, entity_id: int | None,
           summary: str, changes: dict | None = None, ip: str = "") -> None:
    db.add(AuditLog(user_id=user_id, action=action, entity_type=entity_type, entity_id=entity_id,
                    summary=summary[:200], changes={k: v for k, v in (changes or {}).items() if k not in SECRET_FIELDS},
                    ip=ip))
