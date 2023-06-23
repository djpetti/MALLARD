"""add metadata indices

Revision ID: 20aabc8a7849
Revises: ba3d7ed00624
Create Date: 2023-06-23 12:34:29.289200

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20aabc8a7849"
down_revision = "ba3d7ed00624"
branch_labels = None
depends_on = None


def _index_name(col_name: str) -> str:
    """
    Small helper function to create an index name from a column name.

    Args:
        col_name: The column name.

    Returns:
        The index name.

    """
    return f"ix_images_{col_name}"


def upgrade():
    op.create_index(_index_name("name"), "images", columns=["name"])
    op.create_index(
        _index_name("platform_type"), "images", columns=["platform_type"]
    )
    op.create_index(
        _index_name("session_name"), "images", columns=["session_name"]
    )
    op.create_index(
        _index_name("capture_date"), "images", columns=["capture_date"]
    )
    op.create_index(_index_name("camera"), "images", columns=["camera"])


def downgrade():
    op.drop_index(_index_name("name"), "images")
    op.drop_index(_index_name("platform_type"), "images")
    op.drop_index(_index_name("session_name"), "images")
    op.drop_index(_index_name("capture_date"), "images")
    op.drop_index(_index_name("camera"), "images")
