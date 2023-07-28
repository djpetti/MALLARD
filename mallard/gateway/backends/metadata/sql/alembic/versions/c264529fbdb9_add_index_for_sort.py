"""add index for sort

Revision ID: c264529fbdb9
Revises: cf2f6c360a60
Create Date: 2023-07-28 11:36:08.399932

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c264529fbdb9"
down_revision = "cf2f6c360a60"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_name_session_capture_date",
        "artifacts",
        columns=["name", "session_name", "capture_date"],
    )


def downgrade():
    op.drop_index("ix_name_session_capture_date", "artifacts")
