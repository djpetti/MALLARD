"""Initial metadata schema

Revision ID: 472b0fabf47b
Revises:
Create Date: 2021-05-25 18:42:54.959063

"""
import sqlalchemy as sa
from alembic import op

from mallard.gateway.backends.metadata.schemas import ImageFormat, PlatformType

# revision identifiers, used by Alembic.
revision = "472b0fabf47b"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Create the images table.
    op.create_table(
        "images",
        sa.Column("bucket", sa.String(50), primary_key=True),
        sa.Column("key", sa.String(50), primary_key=True),
        sa.Column("name", sa.String(100)),
        sa.Column("format", sa.Enum(ImageFormat)),
        sa.Column("platform_type", sa.Enum(PlatformType), nullable=False),
        sa.Column("notes", sa.Text, default=""),
        sa.Column("session_number", sa.Integer, nullable=False),
        sa.Column("sequence_number", sa.Integer),
        sa.Column("capture_date", sa.Date),
        sa.Column("camera", sa.String(50)),
        sa.Column("location_lat", sa.Float),
        sa.Column("location_lon", sa.Float),
        sa.Column("location_description", sa.Text),
        sa.Column("altitude_meters", sa.Float),
        sa.Column("gsd_cm_px", sa.Float),
    )


def downgrade():
    op.drop_table("images")
