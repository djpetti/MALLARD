"""
Defines ORM models to use for metadata.
"""


import abc
from functools import partial
from typing import Set

from sqlalchemy import (
    Column,
    Date,
    Enum,
    Float,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeMeta, declarative_base, relationship

from ..schemas import ImageFormat, PlatformType, VideoFormat


class DeclarativeAbcMeta(DeclarativeMeta, abc.ABCMeta):
    """
    A meta class that allows for models with abstract methods.
    """


class Base(declarative_base(metaclass=DeclarativeAbcMeta)):
    """
    Base class for all models.
    """

    __abstract__ = True

    @staticmethod
    @abc.abstractmethod
    def pydantic_fields() -> Set[str]:
        """
        Returns:
             A list of the field names that should be set from the
            corresponding Pydantic structure.
        """


class Artifact(Base):
    """
    Represents artifact data in the database.

    Attributes:
        raster: Reference to the raster data, if this is a raster.

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

    __tablename__ = "artifacts"
    # required in order to access columns with server defaults or SQL
    # expression defaults, subsequent to a flush, without triggering an
    # expired load.
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        Index(
            "ix_name_session_capture_date",
            "name",
            "session_name",
            "capture_date",
        ),
    )

    @staticmethod
    def pydantic_fields() -> Set[str]:
        return {
            "size",
            "name",
            "platform_type",
            "notes",
            "session_name",
            "sequence_number",
            "capture_date",
            "location_description",
        }

    bucket = Column(String(50), primary_key=True)
    key = Column(String(50), primary_key=True)

    size = Column(Integer)

    name = Column(String(100), index=True)
    platform_type = Column(Enum(PlatformType), nullable=False, index=True)
    notes = Column(Text, default="")

    session_name = Column(String(50), index=True)
    sequence_number = Column(Integer)

    capture_date = Column(Date, index=True)

    location_lat = Column(Float)
    location_lon = Column(Float)
    location_description = Column(Text)


class Raster(Base):
    """
    Represents a raster in the database.

    Attributes:
        bucket: The ID of the bucket, which corresponds to the column in the
            artifacts table.
        key: The key of the artifact, which corresponds to the column in the
            artifacts table.

        camera: The camera model that was used. If not provided, it will attempt
            to fill it automatically based on image metadata.

        altitude_meters: For UAV platforms, the height at which the raster was
            taken, in meters AGL.
        gsd_cm_px: For UAV platforms, the ground-sample distance in cm/px.

    """

    __tablename__ = "rasters"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        ForeignKeyConstraint(
            ["bucket", "key"], [Artifact.bucket, Artifact.key]
        ),
    )

    @staticmethod
    def pydantic_fields() -> Set[str]:
        return {
            "camera",
            "altitude_meters",
            "gsd_cm_px",
        }

    bucket = Column(String(50), primary_key=True)
    key = Column(String(50), primary_key=True)

    camera = Column(String(50), index=True)

    altitude_meters = Column(Float)
    gsd_cm_px = Column(Float)


class Image(Base):
    """
    Represents an image in the database.

    Attributes:
        bucket: The ID of the bucket, which corresponds to the column in the
            artifacts table.
        key: The key of the artifact, which corresponds to the column in the
            artifacts table.

        format: The format that the image is in. This will be deduced
            automatically, but an expected format can be provided by the user
            for verification.
    """

    __tablename__ = "images"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        ForeignKeyConstraint(["bucket", "key"], [Raster.bucket, Raster.key]),
    )

    @staticmethod
    def pydantic_fields() -> Set[str]:
        return {
            "format",
        }

    bucket = Column(String(50), primary_key=True)
    key = Column(String(50), primary_key=True)

    format = Column(Enum(ImageFormat))


class Video(Base):
    """
    Represents a video in the database.

    Attributes:
        bucket: The ID of the bucket, which corresponds to the column in the
            artifacts table.
        key: The key of the artifact, which corresponds to the column in the
            artifacts table.

        format: The format that the video is in. This will be deduced
            automatically, but an expected format can be provided by the user
            for verification.

        frame_rate: The video framerate, in FPS.
        num_frames: The total number of frames in the video.
    """

    __tablename__ = "videos"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        ForeignKeyConstraint(["bucket", "key"], [Raster.bucket, Raster.key]),
    )

    @staticmethod
    def pydantic_fields() -> Set[str]:
        return {
            "format",
            "frame_rate",
            "num_frames",
        }

    bucket = Column(String(50), primary_key=True)
    key = Column(String(50), primary_key=True)

    format = Column(Enum(VideoFormat))

    frame_rate = Column(Float)
    num_frames = Column(Integer)


# Enable eager loading for relationships, which is easiest since we're using
# asyncio.
relationship = partial(relationship, lazy="selectin")
parent_relationship = partial(
    relationship,
    uselist=False,
    # We want it to delete children automatically when the parent is deleted.
    cascade="save-update, merge, delete, delete-orphan",
)
# Add all of the relationships between tables.
Artifact.raster = parent_relationship(
    "Raster",
    back_populates="artifact",
    foreign_keys=[Raster.bucket, Raster.key],
)

Raster.artifact = relationship(
    "Artifact",
    back_populates="raster",
    foreign_keys=[Raster.bucket, Raster.key],
)
Raster.image = parent_relationship(
    "Image",
    back_populates="raster",
    foreign_keys=[Image.bucket, Image.key],
)
Raster.video = parent_relationship(
    "Video",
    back_populates="raster",
    foreign_keys=[Video.bucket, Video.key],
)

Image.raster = relationship(
    "Raster", back_populates="image", foreign_keys=[Image.bucket, Image.key]
)

Video.raster = relationship(
    "Raster", back_populates="video", foreign_keys=[Video.bucket, Video.key]
)
