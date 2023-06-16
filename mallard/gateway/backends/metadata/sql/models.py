"""
Defines ORM models to use for metadata.
"""


from sqlalchemy import Column, Date, Enum, Float, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase

from ..schemas import ImageFormat, PlatformType, VideoFormat


class Base(DeclarativeBase):
    """
    Base class for all models.
    """


class Artifact(Base):
    """
    Represents artifact data in the database.

    Attributes:
        bucket: The ID of the bucket in which this artifact is stored in the
            object store.
        key: The key of this artifact in the object store.

        size: The size of the artifact, in bytes.

        name: A human-readable name for the artifact. If not provided,
            it will be inferred from the filename.
        platform_type: The type of platform that these data were collected from.
        notes: Arbitrary full-text notes for this artifact.

        session_name: Name used to group artifacts as part of the same session.
        sequence_number: An optional sequence number that can be used to
            define ordering of artifacts within the same session.

        capture_date: Date that the artifact was captured. If not provided,
            it will attempt to fill it automatically based on artifact
            metadata. If there is no such metadata, it will use the current
            date.

        location_lat: Latitude of the location where the artifact was captured.
        location_lon: Longitude of the location where the artifact was captured.
        location_description: An optional, human-readable description of the
            location.
    """

    __abstract__ = True
    # required in order to access columns with server defaults or SQL
    # expression defaults, subsequent to a flush, without triggering an
    # expired load.
    __mapper_args__ = {"eager_defaults": True}

    bucket = Column(String(50), primary_key=True)
    key = Column(String(50), primary_key=True)

    size = Column(Integer)

    name = Column(String(100), index=True)
    format = Column(Enum(ImageFormat))
    platform_type = Column(Enum(PlatformType), nullable=False, index=True)
    notes = Column(Text, default="")

    session_name = Column(String(50), index=True)
    sequence_number = Column(Integer)

    capture_date = Column(Date, index=True)

    location_lat = Column(Float)
    location_lon = Column(Float)
    location_description = Column(Text)


class Raster(Artifact):
    """
    Represents a raster in the database.

    Attributes:
        camera: The camera model that was used. If not provided, it will attempt
            to fill it automatically based on image metadata.

        altitude_meters: For UAV platforms, the height at which the raster was
            taken, in meters AGL.
        gsd_cm_px: For UAV platforms, the ground-sample distance in cm/px.

    """

    __abstract__ = True

    camera = Column(String(50), index=True)

    altitude_meters = Column(Float)
    gsd_cm_px = Column(Float)


class Image(Raster):
    """
    Represents an image in the database.

    Attributes:
        format: The format that the image is in. This will be deduced
            automatically, but an expected format can be provided by the user
            for verification.
    """

    __tablename__ = "images"

    format = Column(Enum(ImageFormat))


class Video(Raster):
    """
    Represents a video in the database.

    Attributes:
        format: The format that the video is in. This will be deduced
            automatically, but an expected format can be provided by the user
            for verification.
    """

    __tablename__ = "videos"

    format = Column(Enum(VideoFormat))
