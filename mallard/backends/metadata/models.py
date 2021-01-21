"""
Data models for metadata.

Since different types of data might require different types of metadata,
this representation allows things to remain flexible.
"""


import enum
import sys
from datetime import MAXYEAR, MINYEAR, date
from typing import Dict, Generic, List, Optional, TypeVar

from pydantic import BaseModel, validator
from pydantic.generics import GenericModel

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
    location: GeoPoint = GeoPoint()
    location_description: Optional[str] = None


class UavImageMetadata(ImageMetadata):
    """
    Represents metadata for an image taken by a UAV.

    Attributes:
        altitude_meters: The altitude of the UAV, in meters AGL.
        gsd_cm_px: The ground-sample distance in cm/px.
    """

    altitude_meters: Optional[float] = None
    gsd_cm_px: Optional[float] = None


class Ordering(BaseModel):
    """
    Represents an ordering that can be used for image data.

    Attributes:
        field: The field that we are ordering upon.
        ascending: If true, sort ascending. Otherwise, sort descending.
    """

    @enum.unique
    class Field(enum.IntEnum):
        """
        Represents the various fields that we can order by.
        """

        NAME = enum.auto()
        """
        Order by name, alphabetically.
        """
        SESSION_NUM = enum.auto()
        """
        Order by session number.
        """
        SEQUENCE_NUM = enum.auto()
        """
        Order by sequence number.
        """
        CAPTURE_DATE = enum.auto()
        """
        Order by capture date.
        """
        CAMERA = enum.auto()
        """
        Order by camera model, alphabetically.
        """

    field: Field
    ascending: bool


RangeType = TypeVar("RangeType")
"""
Represents a type that can be used in a range. Must support comparison.
"""


class ImageQuery(BaseModel):
    """
    Represents a query for images that fit certain criteria. If multiple
    attributes are specified for this query, they will be ANDed. For instance,
    specifying both a name and sequence number range will look for images that
    both have a similar name, and have sequence numbers in that range.

    Attributes:
        platform_type: Search for data that was collected with this type of
            robotic platform. Defaults to all types.
        name: Partial-text search query for image names.
        notes: Partial-text search query for image notes.
        camera: Partial-text search query for camera models.

        session_numbers: Look for images from these sessions.
        sequence_numbers: Look for images with these sequence numbers.
        capture_dates: Look for images with these capture dates.

        bounding_box: Geographic bounding box in which to look for data.
        location_description: Partial-text search query for location
            description.

        altitude_meters: Look for images that were captured at these
            altitudes, in meters AGL.
        gsd_cm_px: Look for images that were captured with these ground sample
            distances, in cm/px.

        orderings: Specifies a specific ordering for the final results. It
            will first sort by the first ordering specified, then the second,
            etc.

    """

    class Config:
        allow_mutation = False

    @enum.unique
    class PlatformType(enum.IntEnum):
        """
        Enumeration of various imaging platform types.
        """

        GROUND = enum.auto()
        """
        Autonomous ground vehicle.
        """
        UAV = enum.auto()
        """
        Autonomous aerial vehicle.
        """

    class Range(GenericModel, Generic[RangeType]):
        """
        Specifies a range for numeric parameters in a query.

        Attributes:
            min_value: The minimum allowed value.
            max_value: The maximum allowed value.
        """

        min_value: RangeType
        max_value: RangeType

        @validator("max_value")
        def min_value_less_than_max(
            cls, max_value: RangeType, values: Dict[str, RangeType]
        ) -> RangeType:
            """
            Checks that the low end of the range is not larger than the high
            end.

            Args:
                max_value: The maximum range value.
                values: The previously-validated fields.

            Returns:
                The validated maximum range value.

            """
            min_value = values["min_value"]
            assert (
                min_value <= max_value
            ), "Range min_value cannot be larger than max_value."

            return max_value

    # Can't use -inf to inf for float ranges because they can't be represented
    # with JSON.
    _MAX_FLOAT_RANGE = Range[float](
        min_value=sys.float_info.min, max_value=sys.float_info.max
    )
    """
    Default float range that encompasses (almost) all float values.
    """
    _MAX_INT_RANGE = Range[int](max_value=sys.maxsize, min_value=-sys.maxsize)
    """
    Default int range that encompasses all "normal" integer values.
    """
    _MAX_DATE_RANGE = Range[date](
        min_value=date(MINYEAR, 1, 1), max_value=date(MAXYEAR, 12, 31)
    )
    """
    Default date range that encompasses all representable dates.
    """

    class BoundingBox(BaseModel):
        """
        Represents a location bounding box.

        Attributes:
            south_west: The south-west corner of the box.
            north_east: The north-east corner of the box.
        """

        south_west: GeoPoint = GeoPoint(latitude_deg=-90, longitude_deg=-180)
        north_east: GeoPoint = GeoPoint(latitude_deg=90, longitude_deg=180)

    platform_type: Optional[PlatformType] = None
    name: Optional[str] = None
    notes: Optional[str] = None
    camera: Optional[str] = None

    session_numbers: Range[int] = _MAX_INT_RANGE
    sequence_numbers: Range[int] = _MAX_INT_RANGE
    capture_dates: Range[date] = _MAX_DATE_RANGE

    bounding_box: BoundingBox = BoundingBox()
    location_description: Optional[str] = None

    altitude_meters: Range[float] = _MAX_FLOAT_RANGE
    gsd_cm_px: Range[float] = _MAX_FLOAT_RANGE

    orderings: List[Ordering] = []
