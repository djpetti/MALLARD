"""add fulltext indices

Revision ID: d3c6cba64289
Revises: c264529fbdb9
Create Date: 2023-07-28 14:06:51.108813

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "d3c6cba64289"
down_revision = "c264529fbdb9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_notes_fulltext",
        "artifacts",
        columns=["notes"],
        mysql_prefix="FULLTEXT",
        mariadb_prefix="FULLTEXT",
    )
    op.create_index(
        "ix_session_name_fulltext",
        "artifacts",
        columns=["session_name"],
        mysql_prefix="FULLTEXT",
        mariadb_prefix="FULLTEXT",
    )


def downgrade():
    op.drop_index("ix_notes_fulltext", "artifacts")
    op.drop_index("ix_notes_session_name", "artifacts")
