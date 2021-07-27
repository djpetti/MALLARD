"""
Defines ORM models to use for metadata.
"""


from sqlalchemy import Column, Date, Enum, Float, Integer, String, Text
from sqlalchemy.ext.declarative import declarative_base

from ..schemas import ImageFormat, PlatformType

Base = declarative_base()
"""
Base class for all models.
"""


class Image(Base):
    """
    Represents an image in the database.

    Attributes:
        bucket: The ID of the bucket in which this image is stored in the object
            store.
        key: The key of this image in the object store.

        name: A human-readable name for the image. If not provided, it will be
            inferred from the image filename.
        format: The format that the image is in. This will be deduced
            automatically, but an expected format can be provided by the user
            for verification.
        platform_type: The type of platform that these data were collected from.
        notes: Arbitrary full-text notes for this image.

        session_name: Name used to group images as part of the same session.
        sequence_number: An optional sequence number that can be used to
            define ordering of images within the same session.

        capture_date: Date that the image was captured. If not provided, it will
            attempt to fill it automatically based on image metadata. If
            there is no such metadata, it will use the current date.
        camera: The camera model that was used. If not provided, it will attempt
            to fill it automatically based on image metadata.

        location_lat: Latitude of the location where the image was captured.
        location_lon: Longitude of the location where the image was captured.
        location_description: An optional, human-readable description of the
            location.

        altitude_meters: For UAV platforms, the height at which the image was
            taken, in meters AGL.
        gsd_cm_px: For UAV platforms, the ground-sample distance in cm/px.
    """

    __tablename__ = "images"

    bucket = Column(String(50), primary_key=True)
    key = Column(String(50), primary_key=True)

    name = Column(String(100))
    format = Column(Enum(ImageFormat))
    platform_type = Column(Enum(PlatformType), nullable=False)
    notes = Column(Text, default="")

    session_name = Column(String(50))
    sequence_number = Column(Integer)

    capture_date = Column(Date)
    camera = Column(String(50))

    location_lat = Column(Float)
    location_lon = Column(Float)
    location_description = Column(Text)

    altitude_meters = Column(Float)
    gsd_cm_px = Column(Float)
