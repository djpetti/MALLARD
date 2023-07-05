"""add metadata tables

Revision ID: b259452eb21d
Revises: ba3d7ed00624
Create Date: 2023-06-22 13:13:32.523652

"""
import sqlalchemy as sa
from alembic import op

from mallard.gateway.backends.metadata.schemas import (
    ImageFormat,
    PlatformType,
    VideoFormat,
)

# revision identifiers, used by Alembic.
revision = "b259452eb21d"
down_revision = "ba3d7ed00624"
branch_labels = None
depends_on = None


artifacts_table = sa.Table(
    "artifacts",
    sa.MetaData(),
    sa.Column("bucket", sa.String(50), primary_key=True),
    sa.Column("key", sa.String(50), primary_key=True),
    sa.Column("name", sa.String(100)),
    sa.Column("size", sa.Integer),
    sa.Column("format", sa.Enum(ImageFormat)),
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
)


def migrate_data(*, rasters: sa.Table, images: sa.Table) -> None:
    """
    Performs the data migration.

    Args:
        rasters: The rasters table.
        images: The images table.

    """
    connection = op.get_bind()

    # Migrate all the columns from the original artifacts table.
    results = connection.execute(
        sa.select(
            artifacts_table.c.bucket,
            artifacts_table.c.key,
            artifacts_table.c.camera,
            artifacts_table.c.altitude_meters,
            artifacts_table.c.gsd_cm_px,
            artifacts_table.c.format,
        )
    )

    # Put the data into the new tables.
    for bucket, key, camera, altitude, gsd, _format in results:
        common_cols = dict(bucket=bucket, key=key)
        op.bulk_insert(
            rasters,
            [
                dict(
                    camera=camera,
                    altitude_meters=altitude,
                    gsd_cm_px=gsd,
                    **common_cols
                )
            ],
        )
        op.bulk_insert(images, [dict(format=_format, **common_cols)])


def migrate_data_reverse(*, rasters: sa.Table, images: sa.Table) -> None:
    """
    Performs the data migration in reverse.

    Args:
        rasters: The rasters table.
        images: The images table.

    """
    connection = op.get_bind()

    # Migrate all the columns from the rasters table.
    raster_results = connection.execute(
        sa.select(
            rasters.c.bucket,
            rasters.c.key,
            rasters.c.camera,
            rasters.c.altitude_meters,
            rasters.c.gsd_cm_px,
        )
    )
    for bucket, key, camera, altitude, gsd in raster_results:
        op.bulk_insert(
            artifacts_table,
            [
                dict(
                    bucket=bucket,
                    key=key,
                    camera=camera,
                    altitude_meters=altitude,
                    gsd_cm_px=gsd,
                )
            ],
        )

    # Migrate all the columns from the images table.
    image_results = connection.execute(
        sa.select([images.c.key, images.c.format])
    )
    for key, format_ in image_results:
        connection.execute(
            artifacts_table.update()
            .where(artifacts_table.c.key == key)
            .values(format=format_)
        )


def upgrade():
    # Rename the images table to "artifacts".
    op.rename_table("images", "artifacts")

    # Create the rasters table.
    rasters_table = op.create_table(
        "rasters",
        sa.Column(
            "bucket",
            sa.String(50),
            primary_key=True,
        ),
        sa.Column(
            "key",
            sa.String(50),
            primary_key=True,
        ),
        sa.Column("camera", sa.String(50)),
        sa.Column("altitude_meters", sa.Float),
        sa.Column("gsd_cm_px", sa.Float),
        sa.ForeignKeyConstraint(
            ["bucket", "key"], ["artifacts.bucket", "artifacts.key"]
        ),
    )

    # Create the images table.
    images_table = op.create_table(
        "images",
        sa.Column(
            "bucket",
            sa.String(50),
            primary_key=True,
        ),
        sa.Column(
            "key",
            sa.String(50),
            primary_key=True,
        ),
        sa.Column("format", sa.Enum(ImageFormat)),
        sa.ForeignKeyConstraint(
            ["bucket", "key"], ["rasters.bucket", "rasters.key"]
        ),
    )

    # Create the videos table.
    op.create_table(
        "videos",
        sa.Column(
            "bucket",
            sa.String(50),
            primary_key=True,
        ),
        sa.Column(
            "key",
            sa.String(50),
            primary_key=True,
        ),
        sa.Column("format", sa.Enum(VideoFormat)),
        sa.Column("frame_rate", sa.Float),
        sa.Column("num_frames", sa.Integer),
        sa.ForeignKeyConstraint(
            ["bucket", "key"], ["rasters.bucket", "rasters.key"]
        ),
    )

    # Migrate the data.
    migrate_data(rasters=rasters_table, images=images_table)

    # Remove the duplicate columns.
    op.drop_column("artifacts", "camera")
    op.drop_column("artifacts", "altitude_meters")
    op.drop_column("artifacts", "gsd_cm_px")
    op.drop_column("artifacts", "format")


def downgrade():
    # Add columns back to the artifacts table.
    op.add_column("artifacts", sa.Column("camera", sa.String(50)))
    op.add_column("artifacts", sa.Column("altitude_meters", sa.Float))
    op.add_column("artifacts", sa.Column("gsd_cm_px", sa.Float))
    op.add_column("artifacts", sa.Column("format", sa.Enum(ImageFormat)))

    rasters_table = sa.Table(
        "rasters",
        sa.MetaData(),
        sa.Column(
            "bucket",
            sa.String(50),
            primary_key=True,
        ),
        sa.Column(
            "key",
            sa.String(50),
            primary_key=True,
        ),
        sa.Column("camera", sa.String(50)),
        sa.Column("altitude_meters", sa.Float),
        sa.Column("gsd_cm_px", sa.Float),
        sa.ForeignKeyConstraint(
            ["bucket", "key"], ["artifacts.bucket", "artifacts.key"]
        ),
    )
    images_table = sa.Table(
        "images",
        sa.MetaData(),
        sa.Column(
            "bucket",
            sa.String(50),
            primary_key=True,
        ),
        sa.Column(
            "key",
            sa.String(50),
            primary_key=True,
        ),
        sa.Column("format", sa.Enum(ImageFormat)),
        sa.ForeignKeyConstraint(
            ["bucket", "key"], ["rasters.bucket", "rasters.key"]
        ),
    )

    # Migrate the data.
    migrate_data_reverse(rasters=rasters_table, images=images_table)

    # Delete the new tables.
    op.drop_table("images")
    op.drop_table("videos")
    op.drop_table("rasters")

    # Rename the artifacts table back to images.
    op.rename_table("artifacts", "images")
