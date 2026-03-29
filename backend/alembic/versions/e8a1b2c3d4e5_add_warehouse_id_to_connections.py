"""add warehouse_id to marketplace_connections for Megamarket price/stock

Revision ID: e8a1b2c3d4e5
Revises: bd5f286450b5
Create Date: 2026-03-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e8a1b2c3d4e5"
down_revision: Union[str, Sequence[str], None] = "bd5f286450b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "marketplace_connections",
        sa.Column("warehouse_id", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("marketplace_connections", "warehouse_id")
