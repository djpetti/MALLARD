"""Index nullable cursor sort fields.

Revision ID: 8c2f6a9d104e
Revises: 5721871e3437
"""

import sqlalchemy as sa
from alembic import op

# Revision identifiers, used by Alembic.
revision = "8c2f6a9d104e"
down_revision = "5721871e3437"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add virtual NULL ranks and the default cursor ordering index."""
    for field in ("capture_date", "session_name", "name"):
        # MariaDB does not support NOT NULL on generated columns.
        op.add_column(
            "artifacts",
            sa.Column(
                f"{field}_is_null",
                sa.Integer(),
                sa.Computed(f"{field} IS NULL", persisted=False),
            ),
        )
    # Index creation may rebuild or lock a populated table, depending on the DB.
    op.create_index(
        "ix_artifacts_cursor_sort",
        "artifacts",
        [
            "capture_date_is_null",
            sa.text("capture_date DESC"),
            "session_name_is_null",
            "session_name",
            "name_is_null",
            "name",
            "bucket",
            "key",
        ],
    )


def downgrade() -> None:
    """Remove cursor schema additions without changing existing indexes."""
    # Drop the dependent index before removing its generated columns.
    op.drop_index("ix_artifacts_cursor_sort", table_name="artifacts")
    for field in ("name", "session_name", "capture_date"):
        op.drop_column("artifacts", f"{field}_is_null")
