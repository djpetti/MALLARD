"""
Data models for metadata.

Since different types of data might require different types of metadata,
this representation allows things to remain flexible.
"""


from datetime import date
from typing import Optional

from pydantic import BaseModel, validator

from ...fastapi_utils import as_form


class Metadata(BaseModel):
    """
    Represents a row in a metadata table.
    """

    class Config:
        allow_mutation = False


@as_form
class GeoPoint(BaseModel):
    """
    Represents a location in the world.

    Attributes:
        latitude_deg: The latitude, in decimal degrees.
        longitude_deg: The longitude, in decimal degrees.
    """

    class Config:
        allow_mutation = False

    latitude_deg: Optional[float] = None
    longitude_deg: Optional[float] = None

    @validator("latitude_deg")
    def lat_in_range(cls, latitude: Optional[float]) -> Optional[float]:
        """
        Ensures that latitude values are within valid ranges.

        Args:
            latitude: The latitude value to check.

        Returns:
            The same value.

        """
        if latitude is None:
            return latitude
        assert -90.0 <= latitude <= 90.0, "Latitude must be within [-90, 90]."
        return latitude

    @validator("longitude_deg")
    def lon_in_range(cls, longitude: Optional[float]) -> Optional[float]:
        """
        Ensures that latitude values are within valid ranges.

        Args:
            longitude: The longitude value to check.

        Returns:
            The same value.

        """
        if longitude is None:
            return longitude
        assert (
            -180.0 <= longitude <= 180.0
        ), "Longitude must be within [-180, 180]."
        return longitude


@as_form
class ImageMetadata(Metadata):
    """
    Represents metadata for an image.

    Attributes:
        name: A human-readable name for the image. If not provided, it will be
            inferred from the image filename.
        notes: Arbitrary full-text notes for this image.

        session_number: An optional session number that can be used to
            distinguish images in the same session.
        sequence_number: An optional sequence number that can be used to
            define ordering of images within the same session.

        capture_date: Date that the image was captured. If not provided, it will
            attempt to fill it automatically based on image metadata. If
            there is no such metadata, it will use the current date.
        camera: The camera model that was used. If not provided, it will attempt
            to fill it automatically based on image metadata.

        location: The location where the image was captured. If not provided, it
            will attempt to fill it automatically based on image metadata.
        location_description: An optional, human-readable description of the
            location.
    """

    name: Optional[str] = None
    notes: str = ""

    session_number: int = 0
    sequence_number: Optional[int] = None

    capture_date: Optional[date] = None
    camera: Optional[str] = None
    location: Optional[GeoPoint] = None
    location_description: Optional[str] = None


class UavImageMetadata(ImageMetadata):
    """
    Represents metadata for an image taken by a UAV.

    Attributes:
        altitude_meters: The altitude of the UAV, in meters AGL.
        gsd_cm_px: The ground-sample distance in cm/px.
    """

    altitude_meters: float
    gsd_cm_px: float
