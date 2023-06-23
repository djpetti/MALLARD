"""add video metadata table

Revision ID: b259452eb21d
Revises: ba3d7ed00624
Create Date: 2023-06-22 13:13:32.523652

"""
import sqlalchemy as sa
from alembic import op

from mallard.gateway.backends.metadata.schemas import PlatformType, VideoFormat

# revision identifiers, used by Alembic.
revision = "b259452eb21d"
down_revision = "ba3d7ed00624"
branch_labels = None
depends_on = None


def upgrade():
    # Create the videos table.
    op.create_table(
        "videos",
        sa.Column("bucket", sa.String(50), primary_key=True),
        sa.Column("key", sa.String(50), primary_key=True),
        sa.Column("size", sa.Integer),
        sa.Column("name", sa.String(100)),
        sa.Column("format", sa.Enum(VideoFormat)),
        sa.Column("platform_type", sa.Enum(PlatformType), nullable=False),
        sa.Column("notes", sa.Text, default=""),
        sa.Column("session_name", sa.String(50)),
        sa.Column("sequence_number", sa.Integer),
        sa.Column("capture_date", sa.Date),
        sa.Column("camera", sa.String(50)),
        sa.Column("location_lat", sa.Float),
        sa.Column("location_lon", sa.Float),
        sa.Column("location_description", sa.Text),
        sa.Column("altitude_meters", sa.Float),
        sa.Column("gsd_cm_px", sa.Float),
        sa.Column("frame_rate", sa.Float),
        sa.Column("num_frames", sa.Integer),
    )


def downgrade():
    op.drop_table("videos")
