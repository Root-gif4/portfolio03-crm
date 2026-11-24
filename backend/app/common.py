"""API で共通に使う小さな関数。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from .errors import AppError, Conflict, NotFound

JST = timezone(timedelta(hours=9), "JST")
MAX_PER_PAGE = 100


def today_jst() -> date:
    return datetime.now(JST).date()


def like_pattern(keyword: str) -> str:
    """部分一致の検索。% と _ は文字として探す。"""
    escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def paginate(db: Session, query: Select, page: int, per_page: int) -> tuple[list[Any], int]:
    page = max(1, page)
    per_page = min(max(1, per_page), MAX_PER_PAGE)
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0
    rows = db.execute(query.limit(per_page).offset((page - 1) * per_page)).all()
    return rows, int(total)


def get_alive(db: Session, model, obj_id: int, label: str):
    obj = db.get(model, obj_id)
    if obj is None or getattr(obj, "deleted_at", None) is not None:
        raise NotFound(f"{label}が見つかりません（削除されたか、番号が違います）。")
    return obj


def check_version(obj, version: int) -> None:
    """楽観的ロック：画面で開いたあとに、ほかの人が先に更新していたら保存しない。"""
    if obj.version != version:
        raise Conflict("ほかの人が先に更新しました。画面を開き直して、最新の内容を確かめてから保存してください。")
    obj.version += 1


def snapshot(obj, fields: tuple[str, ...]) -> dict[str, Any]:
    return {f: getattr(obj, f) for f in fields}


def resolve_period(start: date | None, end: date | None, current: date | None, end_field: str, end_label: str) -> date:
    """開始日を決めて、終わりの日（期限・受注予定日）が開始日より前でないか確かめる。

    start が空なら、変更のときは今の値、追加のときは今日（終わりの日が今日より前ならその日）。
    """
    if start is None:
        start = current if current is not None else (min(today_jst(), end) if end else today_jst())
    if end is not None and end < start:
        raise AppError(f"{end_label}は開始日（{start.isoformat()}）と同じか、あとの日にしてください。", 422, end_field)
    return start
