"""権限の決まり（1 か所にまとめ、画面にも同じ判定結果を返す）。

| 操作 | 管理者 | マネージャー | メンバー |
| --- | --- | --- | --- |
| 顧客・案件・タスクを見る | ○ | ○ | ○ |
| 顧客・案件を作る | ○ | ○ | ○（担当者は自分） |
| 顧客・案件を変える | ○ | ○ | 自分が担当のものだけ |
| タスクを作る・変える | ○ | ○ | 自分が担当の案件のタスク、自分が担当者のタスク |
| 削除する | ○ | ○ | × |
| 受注・失注の案件を進行中に戻す | ○ | ○ | × |
| ユーザー管理 | ○ | × | × |
| 操作履歴を見る | ○ | ○ | × |
"""

from __future__ import annotations

from .errors import Forbidden
from .models import Customer, Project, Task, User

MANAGERS = ("admin", "manager")


def is_manager(user: User) -> bool:
    return user.role in MANAGERS


def can_edit_customer(user: User, c: Customer) -> bool:
    return is_manager(user) or c.owner_id == user.id


def can_edit_project(user: User, p: Project) -> bool:
    return is_manager(user) or p.owner_id == user.id


def can_edit_task(user: User, t: Task) -> bool:
    return is_manager(user) or t.assignee_id == user.id or t.project.owner_id == user.id


def can_delete(user: User) -> bool:
    return is_manager(user)


def ensure(allowed: bool, message: str = "この操作をする権限がありません。") -> None:
    if not allowed:
        raise Forbidden(message)
