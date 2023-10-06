"""increase width of size field

Revision ID: 1dccd208406f
Revises: d3c6cba64289
Create Date: 2023-10-02 16:40:00.702358

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "1dccd208406f"
down_revision = "d3c6cba64289"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("artifacts", "size", type_=sa.BigInteger)


def downgrade():
    op.alter_column("artifacts", "size", type_=sa.Integer)
