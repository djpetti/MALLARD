"""add video format

Revision ID: 5721871e3437
Revises: 1dccd208406f
Create Date: 2023-11-17 11:11:56.829700

"""
import sqlalchemy as sa
from alembic import op

from mallard.gateway.backends.metadata.schemas import VideoFormat

# revision identifiers, used by Alembic.
revision = "5721871e3437"
down_revision = "1dccd208406f"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("videos", "format", type_=sa.Enum(VideoFormat))


def downgrade():
    op.alter_column("videos", "format", type_=sa.Enum(VideoFormat))
