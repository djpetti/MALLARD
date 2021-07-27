"""Switch from session numbers to names.

Revision ID: 3d4e353d2afe
Revises: 472b0fabf47b
Create Date: 2021-07-27 15:05:00.403927

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "3d4e353d2afe"
down_revision = "472b0fabf47b"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("images", sa.Column("session_name", sa.String(50)))
    op.drop_column("images", "session_number")


def downgrade():
    op.add_column(
        "images", sa.Column("session_number", sa.Integer, nullable=False)
    )
    op.drop_column("images", "session_name")
