"""テーブルの定義（SQLAlchemy 2.x）。詳しくは docs/03_DB設計書.md。"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String, Text,
                        func, text)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

ROLES = ("admin", "manager", "member")
ROLE_LABELS = {"admin": "管理者", "manager": "マネージャー", "member": "メンバー"}

PROJECT_STATUSES = ("lead", "proposal", "negotiation", "won", "lost")
PROJECT_STATUS_LABELS = {"lead": "見込み", "proposal": "提案中", "negotiation": "交渉中", "won": "受注", "lost": "失注"}
CLOSED_STATUSES = ("won", "lost")

TASK_STATUSES = ("todo", "doing", "done")
TASK_STATUS_LABELS = {"todo": "未着手", "doing": "対応中", "done": "完了"}
PRIORITIES = ("high", "medium", "low")
PRIORITY_LABELS = {"high": "高", "medium": "中", "low": "低"}
OUTLOOKS = ("on_track", "at_risk")
OUTLOOK_LABELS = {"on_track": "予定どおり", "at_risk": "遅れそう"}


def _default_start(end_col: str):
    """開始日を入れなかったときは今日（終わりの日が今日より前なら、その日）。"""
    def f(ctx):
        from .common import today_jst
        today = today_jst()
        end = ctx.get_current_parameters().get(end_col)
        return min(today, end) if end else today
    return f


def _in(col: str, values: tuple[str, ...]) -> str:
    return f"{col} IN (" + ",".join(f"'{v}'" for v in values) + ")"


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(),
                                                 onupdate=func.now())


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False, default="member")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(_in("role", ROLES), name="ck_users_role"),
        CheckConstraint("failed_logins >= 0", name="ck_users_failed_logins"),
        Index("uq_users_email_lower", func.lower(text("email")), unique=True),
    )


class UserSession(Base):
    """ログイン中のセッション。Cookie にはランダムな文字列を、DB にはその SHA-256 だけを保存する。"""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped[User] = relationship()


class Customer(TimestampMixin, Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    kana: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    industry: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(254), nullable=False, default="")
    address: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    owner: Mapped[User] = relationship()

    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="ck_customers_name"),
        Index("ix_customers_active_name", "name", postgresql_where=text("deleted_at IS NULL")),
    )


class Project(TimestampMixin, Base):
    """案件（商談）。"""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(15), nullable=False, default="lead")
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)        # 見込み金額（円）
    start_date: Mapped[date] = mapped_column(Date, nullable=False, default=_default_start("expected_close_date"))
    expected_close_date: Mapped[date | None] = mapped_column(Date)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))      # 受注・失注にした日時
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    customer: Mapped[Customer] = relationship()
    owner: Mapped[User] = relationship()

    __table_args__ = (
        CheckConstraint(_in("status", PROJECT_STATUSES), name="ck_projects_status"),
        CheckConstraint("amount >= 0 AND amount <= 1000000000000", name="ck_projects_amount"),
        CheckConstraint("length(btrim(name)) > 0", name="ck_projects_name"),
        # 受注・失注なら閉じた日時がある、それ以外ならない
        CheckConstraint("(status IN ('won','lost')) = (closed_at IS NOT NULL)", name="ck_projects_closed_at"),
        # 受注予定日は開始日より前にしない
        CheckConstraint("expected_close_date IS NULL OR expected_close_date >= start_date", name="ck_projects_period"),
        Index("ix_projects_status", "status", postgresql_where=text("deleted_at IS NULL")),
    )


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="todo")
    priority: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    start_date: Mapped[date] = mapped_column(Date, nullable=False, default=_default_start("due_date"))
    due_date: Mapped[date | None] = mapped_column(Date)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 担当者からの報告：進み具合（%）・見通し（予定どおり／遅れそう）・ひとこと・報告した日時
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    outlook: Mapped[str | None] = mapped_column(String(10))
    report_note: Mapped[str] = mapped_column(String(200), nullable=False, default="", server_default="")
    reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped[Project] = relationship()
    assignee: Mapped[User | None] = relationship(foreign_keys=[assignee_id])

    __table_args__ = (
        CheckConstraint(_in("status", TASK_STATUSES), name="ck_tasks_status"),
        CheckConstraint(_in("priority", PRIORITIES), name="ck_tasks_priority"),
        CheckConstraint("length(btrim(title)) > 0", name="ck_tasks_title"),
        CheckConstraint("(status = 'done') = (completed_at IS NOT NULL)", name="ck_tasks_completed_at"),
        CheckConstraint("due_date IS NULL OR due_date >= start_date", name="ck_tasks_period"),
        CheckConstraint("progress BETWEEN 0 AND 100", name="ck_tasks_progress"),
        CheckConstraint("outlook IS NULL OR outlook IN ('on_track','at_risk')", name="ck_tasks_outlook"),
        Index("ix_tasks_due", "due_date", postgresql_where=text("deleted_at IS NULL AND status <> 'done'")),
    )


class AuditLog(Base):
    """操作履歴。追加だけで、書き換え・削除はしない。"""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_id: Mapped[int | None] = mapped_column(Integer)
    summary: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    changes: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    ip: Mapped[str] = mapped_column(String(45), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(),
                                                 index=True)

    user: Mapped[User | None] = relationship()

    __table_args__ = (Index("ix_audit_entity", "entity_type", "entity_id"),)
