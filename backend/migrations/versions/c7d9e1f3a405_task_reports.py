"""add progress reports to tasks

Revision ID: c7d9e1f3a405
Revises: a3c5e7f9b201
Create Date: 2026-11-23 20:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c7d9e1f3a405'
down_revision: Union[str, Sequence[str], None] = 'a3c5e7f9b201'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('progress', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('tasks', sa.Column('outlook', sa.String(length=10), nullable=True))
    op.add_column('tasks', sa.Column('report_note', sa.String(length=200), nullable=False, server_default=''))
    op.add_column('tasks', sa.Column('reported_at', sa.DateTime(timezone=True), nullable=True))
    # finished tasks are 100%
    op.execute("UPDATE tasks SET progress = 100 WHERE status = 'done'")
    op.create_check_constraint('ck_tasks_progress', 'tasks', 'progress BETWEEN 0 AND 100')
    op.create_check_constraint('ck_tasks_outlook', 'tasks', "outlook IS NULL OR outlook IN ('on_track','at_risk')")


def downgrade() -> None:
    op.drop_constraint('ck_tasks_outlook', 'tasks', type_='check')
    op.drop_constraint('ck_tasks_progress', 'tasks', type_='check')
    op.drop_column('tasks', 'reported_at')
    op.drop_column('tasks', 'report_note')
    op.drop_column('tasks', 'outlook')
    op.drop_column('tasks', 'progress')
