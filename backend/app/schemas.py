"""API の入力と出力の形（Pydantic）。入力のチェックはここと service の両方で行う。"""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$")
PHONE_RE = re.compile(r"^(0\d{1,4}-?\d{1,4}-?\d{3,4}|\+\d{6,15})$")


# 全角の英数字と半角カナだけを直す（「（）」「：」などの全角の記号は日本語の文として自然なのでそのまま）
_WIDE = re.compile(r"[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A\uFF61-\uFF9F]+")


def _clean(v: str) -> str:
    v = _WIDE.sub(lambda m: unicodedata.normalize("NFKC", m.group()), v).strip()
    if any(unicodedata.category(ch) == "Cc" and ch not in "\n\t" for ch in v):
        raise ValueError("使えない文字（制御文字）が入っています")
    return v


def _email(v: str) -> str:
    v = unicodedata.normalize("NFKC", _clean(v)).lower()
    if v and not EMAIL_RE.match(v):
        raise ValueError("メールアドレスの形ではありません（例：taro@example.com）")
    return v


def _phone(v: str) -> str:
    v = unicodedata.normalize("NFKC", _clean(v))
    for dash in ("ー", "−", "‐", "－", "―"):
        v = v.replace(dash, "-")
    v = v.replace(" ", "")
    if v and not PHONE_RE.match(v):
        raise ValueError("電話番号の形ではありません（例：03-1234-5678）")
    return v


def _required(v: str) -> str:
    if not v:
        raise ValueError("入力してください")
    return v


Text = Annotated[str, AfterValidator(_clean)]
Req50 = Annotated[str, Field(max_length=50), AfterValidator(_clean), AfterValidator(_required)]
Req100 = Annotated[str, Field(max_length=100), AfterValidator(_clean), AfterValidator(_required)]
Opt50 = Annotated[str, Field(max_length=50), AfterValidator(_clean)]
Opt100 = Annotated[str, Field(max_length=100), AfterValidator(_clean)]
Opt200 = Annotated[str, Field(max_length=200), AfterValidator(_clean)]
Note = Annotated[str, Field(max_length=2000), AfterValidator(_clean)]
Email = Annotated[str, Field(max_length=254), AfterValidator(_email)]
ReqEmail = Annotated[str, Field(max_length=254), AfterValidator(_email), AfterValidator(_required)]
Phone = Annotated[str, Field(max_length=20), AfterValidator(_phone)]
Amount = Annotated[int, Field(ge=0, le=1_000_000_000_000)]

Role = Literal["admin", "manager", "member"]
ProjectStatus = Literal["lead", "proposal", "negotiation", "won", "lost"]
TaskStatus = Literal["todo", "doing", "done"]
Priority = Literal["high", "medium", "low"]

T = TypeVar("T")


class In(BaseModel):
    model_config = ConfigDict(extra="forbid")  # 知らない項目（role の書き換えなど）は受け付けない


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(Out, Generic[T]):
    items: list[T]
    total: int
    page: int
    per_page: int


class Ref(Out):
    id: int
    name: str


# ---- 認証・ユーザー

class LoginIn(In):
    email: Annotated[str, Field(max_length=254)]
    password: Annotated[str, Field(max_length=128)]


class UserOut(Out):
    id: int
    email: str
    name: str
    role: Role
    active: bool
    last_login_at: datetime | None = None


class MeOut(UserOut):
    can_manage_users: bool
    can_view_audit: bool
    can_view_team: bool = False
    can_delete: bool


class UserCreate(In):
    email: ReqEmail
    name: Req50
    role: Role = "member"
    password: Annotated[str, Field(max_length=128)]


class UserUpdate(In):
    name: Req50
    role: Role
    active: bool


class PasswordChange(In):
    current_password: Annotated[str, Field(max_length=128)]
    new_password: Annotated[str, Field(max_length=128)]


class PasswordReset(In):
    new_password: Annotated[str, Field(max_length=128)]


# ---- 顧客

class CustomerIn(In):
    name: Req100
    kana: Opt100 = ""
    industry: Opt50 = ""
    phone: Phone = ""
    email: Email = ""
    address: Opt200 = ""
    note: Note = ""
    owner_id: int | None = None


class CustomerUpdate(CustomerIn):
    version: int


class CustomerOut(Out):
    id: int
    name: str
    kana: str
    industry: str
    phone: str
    email: str
    address: str
    note: str
    owner: Ref
    version: int
    created_at: datetime
    updated_at: datetime
    project_count: int = 0
    open_amount: int = 0
    can_edit: bool = False
    can_delete: bool = False


# ---- 案件

class ProjectIn(In):
    customer_id: int
    name: Req100
    status: ProjectStatus = "lead"
    amount: Amount = 0
    start_date: date | None = None          # 入れなければ今日（変更では今のまま）
    expected_close_date: date | None = None
    description: Note = ""
    owner_id: int | None = None


class ProjectUpdate(ProjectIn):
    version: int


class ProjectOut(Out):
    id: int
    name: str
    status: ProjectStatus
    amount: int
    start_date: date
    expected_close_date: date | None
    closed_at: datetime | None
    description: str
    customer: Ref
    owner: Ref
    version: int
    created_at: datetime
    updated_at: datetime
    task_total: int = 0
    task_open: int = 0
    can_edit: bool = False
    can_delete: bool = False
    can_reopen: bool = False


# ---- タスク

class TaskIn(In):
    project_id: int
    title: Req100
    status: TaskStatus = "todo"
    priority: Priority = "medium"
    start_date: date | None = None          # 入れなければ今日（変更では今のまま）
    due_date: date | None = None
    assignee_id: int | None = None
    description: Note = ""


class TaskUpdate(TaskIn):
    version: int


class TaskReportIn(In):
    """担当者からの報告。progress・outlook は省くと今のまま。"""
    progress: Annotated[int, Field(ge=0, le=100)] | None = None
    outlook: Literal["on_track", "at_risk"] | None = None
    note: Opt200 = ""
    version: int


class TaskStatusIn(In):
    status: TaskStatus
    version: int


class TaskOut(Out):
    id: int
    title: str
    status: TaskStatus
    priority: Priority
    start_date: date
    due_date: date | None
    description: str
    completed_at: datetime | None
    project: Ref
    customer: Ref
    assignee: Ref | None
    version: int
    created_at: datetime
    updated_at: datetime
    overdue: bool = False
    progress: int = 0
    outlook: Literal["on_track", "at_risk"] | None = None
    report_note: str = ""
    reported_at: datetime | None = None
    can_edit: bool = False
    can_delete: bool = False


# ---- 操作履歴

class AuditOut(Out):
    id: int
    created_at: datetime
    user: Ref | None
    action: str
    entity_type: str
    entity_id: int | None
    summary: str
    changes: dict
    ip: str
