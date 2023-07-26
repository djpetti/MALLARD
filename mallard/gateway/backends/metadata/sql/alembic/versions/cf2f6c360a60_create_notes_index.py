"""create notes index

Revision ID: cf2f6c360a60
Revises: b259452eb21d
Create Date: 2023-07-26 15:52:16.856999

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "cf2f6c360a60"
down_revision = "b259452eb21d"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("ix_artifacts_notes", "artifacts", columns=["notes"])


def downgrade():
    op.drop_index("ix_artifacts_notes", "artifacts")
