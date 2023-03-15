"""add size column

Revision ID: ba3d7ed00624
Revises: 3d4e353d2afe
Create Date: 2023-03-14 16:32:12.249774

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "ba3d7ed00624"
down_revision = "3d4e353d2afe"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("images", sa.Column("size", sa.Integer))


def downgrade():
    op.drop_column("images", "size")
