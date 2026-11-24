"""add start_date to projects and tasks

Revision ID: a3c5e7f9b201
Revises: d14f10b9ff7b
Create Date: 2026-11-23 18:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a3c5e7f9b201'
down_revision: Union[str, Sequence[str], None] = 'd14f10b9ff7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('start_date', sa.Date(), nullable=True))
    op.add_column('tasks', sa.Column('start_date', sa.Date(), nullable=True))
    # existing rows: the day they were created (Japan time), but never after the end date
    op.execute("""
        UPDATE projects SET start_date = LEAST((created_at AT TIME ZONE 'Asia/Tokyo')::date,
                                               COALESCE(expected_close_date, 'infinity'::date))
    """)
    op.execute("""
        UPDATE tasks SET start_date = LEAST((created_at AT TIME ZONE 'Asia/Tokyo')::date,
                                            COALESCE(due_date, 'infinity'::date))
    """)
    op.alter_column('projects', 'start_date', nullable=False)
    op.alter_column('tasks', 'start_date', nullable=False)
    op.create_check_constraint('ck_projects_period', 'projects',
                               'expected_close_date IS NULL OR expected_close_date >= start_date')
    op.create_check_constraint('ck_tasks_period', 'tasks', 'due_date IS NULL OR due_date >= start_date')


def downgrade() -> None:
    op.drop_constraint('ck_tasks_period', 'tasks', type_='check')
    op.drop_constraint('ck_projects_period', 'projects', type_='check')
    op.drop_column('tasks', 'start_date')
    op.drop_column('projects', 'start_date')
