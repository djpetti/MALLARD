"""
Pydantic data models for metadata. These are shared amongst all backends.

Since different types of data might require different types of metadata,
this representation allows things to remain flexible.
"""


import enum
from datetime import date
from typing import Dict, Generic, Optional, TypeVar

from pydantic import root_validator, validator

from ...fastapi_utils import as_form
from ...schemas import ApiModel, GenericApiModel


@as_form
class GeoPoint(ApiModel):
    """
    Represents a location in the world.

    Attributes:
        latitude_deg: The latitude, in decimal degrees.
        longitude_deg: The longitude, in decimal degrees.
    """

    latitude_deg: Optional[float] = None
    longitude_deg: Optional[float] = None

    @validator("latitude_deg")
    def lat_in_range(
        cls, latitude: Optional[float]
    ) -> Optional[float]:  # pragma: no cover
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
    def lon_in_range(
        cls, longitude: Optional[float]
    ) -> Optional[float]:  # pragma: no cover
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


@enum.unique
class PlatformType(str, enum.Enum):
    """
    Enumeration of various imaging platform types.
    """

    GROUND = "ground"
    """
    Autonomous ground vehicle.
    """
    AERIAL = "aerial"
    """
    Autonomous aerial vehicle.
    """


@enum.unique
class ImageFormat(str, enum.Enum):
    """
    Enumeration of various image formats that are allowed.

    The values of the enumeration must correspond to the strings returned by
    `imghdr.what()`.
    """

    GIF = "gif"
    TIFF = "tiff"
    JPEG = "jpeg"
    BMP = "bmp"
    PNG = "png"


@enum.unique
class VideoFormat(str, enum.Enum):
    """
    Enumeration of various video formats that are allowed.
    """

    AV1 = "av1"
    AVC = "avc"
    H263 = "h263"
    HEVC = "hevc"
    MP4V_ES = "mp4v-es"
    MPEG1 = "mpeg1"
    MPEG2 = "mpeg2"
    THEORA = "theora"
    VP8 = "vp8"
    VP9 = "vp9"


class Metadata(ApiModel):
    """
    Represents a row in a metadata table.

    Attributes:
        size: The size of the artifact, in bytes.
        name: A human-readable name for the artifact. If not provided,
            it will be inferred from the filename.
        platform_type: The type of platform that these data were collected from.
        notes: Arbitrary full-text notes for this artifact.

        session_name: Name used to group images as part of the same session.
        sequence_number: An optional sequence number that can be used to
            define ordering of images within the same session.

        capture_date: Date that the artifact was captured.
        location: The location where the image was captured. If not provided, it
            will attempt to fill it automatically based on image metadata.
        location_description: An optional, human-readable description of the
            location.

    """

    class Config(ApiModel.Config):
        orm_mode = True

    size: Optional[int] = None
    name: Optional[str] = None
    platform_type: PlatformType = PlatformType.GROUND
    notes: str = ""

    session_name: Optional[str] = None
    sequence_number: Optional[int] = None

    capture_date: Optional[date] = None
    location: GeoPoint = GeoPoint()
    location_description: Optional[str] = None


@as_form
class RasterMetadata(Metadata):
    """
    Represents metadata for raster artifacts.

    camera: The camera model that was used.

    """

    camera: Optional[str] = None


@as_form
class ImageMetadata(RasterMetadata):
    """
    Represents metadata for an image.

    Attributes:
        format: The format that the image is in. This will be deduced
            automatically, but an expected format can be provided by the user
            for verification.

    """

    format: Optional[ImageFormat] = None


@as_form
class VideoMetadata(RasterMetadata):
    """
    Represents metadata for a video.

    Attributes:
        format: The format that the video is in.

        frame_rate: The video framerate, in FPS.
        num_frames: The total number of frames in the video.

    """

    format: Optional[VideoFormat]

    frame_rate: Optional[float] = None
    num_frames: Optional[int] = None


class UavPlatformMixin:
    """
    Adds attributes specific to the UAV platform.

    Attributes:
        platform_type: The type of platform that these data were collected from.

        altitude_meters: The altitude of the UAV, in meters AGL.
        gsd_cm_px: The ground-sample distance in cm/px.
    """

    platform_type: PlatformType = PlatformType.AERIAL

    altitude_meters: Optional[float] = None
    gsd_cm_px: Optional[float] = None


@as_form
class UavImageMetadata(ImageMetadata, UavPlatformMixin):
    """
    Represents metadata for an image taken by a UAV.
    """


@as_form
class UavVideoMetadata(VideoMetadata, UavPlatformMixin):
    """
    Represents metadata for a video taken by a UAV.
    """


class Ordering(ApiModel):
    """
    Represents an ordering that can be used for image data.

    Attributes:
        field: The field that we are ordering upon.
        ascending: If true, sort ascending. Otherwise, sort descending.
    """

    @enum.unique
    class Field(str, enum.Enum):
        """
        Represents the various fields that we can order by.
        """

        NAME = "name"
        """
        Order by name, alphabetically.
        """
        SESSION = "session"
        """
        Order by session name, alphabetically.
        """
        SEQUENCE_NUM = "sequence_num"
        """
        Order by sequence number.
        """
        CAPTURE_DATE = "capture_date"
        """
        Order by capture date.
        """
        CAMERA = "camera"
        """
        Order by camera model, alphabetically.
        """

    field: Field
    ascending: bool = True


RangeType = TypeVar("RangeType")
"""
Represents a type that can be used in a range. Must support comparison.
"""


class ImageQuery(ApiModel):
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

        session: Partial-text search query for session names.
        sequence_numbers: Look for images with these sequence numbers.
        capture_dates: Look for images with these capture dates.

        bounding_box: Geographic bounding box in which to look for data.
        location_description: Partial-text search query for location
            description.

        altitude_meters: Look for images that were captured at these
            altitudes, in meters AGL.
        gsd_cm_px: Look for images that were captured with these ground sample
            distances, in cm/px.

    """

    class Range(GenericApiModel, Generic[RangeType]):
        """
        Specifies a range for numeric parameters in a query.

        Attributes:
            min_value: The minimum allowed value.
            max_value: The maximum allowed value.
        """

        min_value: Optional[RangeType] = None
        max_value: Optional[RangeType] = None

        @validator("max_value")
        def min_value_less_than_max(
            cls, max_value: RangeType, values: Dict[str, RangeType]
        ) -> RangeType:  # pragma: no cover
            """
            Checks that the low end of the range is not larger than the high
            end.

            Args:
                max_value: The maximum range value.
                values: The previously-validated fields.

            Returns:
                The validated maximum range value.

            """
            min_value = values.get("min_value")
            if min_value is None or max_value is None:
                # We did not specify both sides of the range, so this check
                # is irrelevant.
                return max_value

            assert (
                min_value <= max_value
            ), "Range min_value cannot be larger than max_value."

            return max_value

        @root_validator()
        def at_least_one_side_specified(
            cls, values: Dict[str, RangeType]
        ) -> RangeType:  # pragma: no cover
            """
            Checks that at least one side of the range is specified.

            Args:
                values: The previously-validated fields.

            Returns:
                The validated value.

            """
            any_specified = False
            for v in values.values():
                any_specified = any_specified or (v is not None)

            assert (
                any_specified
            ), "At least one side of the range must be specified."
            return values

    class BoundingBox(ApiModel):
        """
        Represents a location bounding box.

        Attributes:
            south_west: The south-west corner of the box.
            north_east: The north-east corner of the box.
        """

        south_west: GeoPoint
        north_east: GeoPoint

    platform_type: Optional[PlatformType] = None
    name: Optional[str] = None
    notes: Optional[str] = None
    camera: Optional[str] = None

    session: Optional[str] = None
    sequence_numbers: Optional[Range[int]] = None
    capture_dates: Optional[Range[date]] = None

    bounding_box: Optional[BoundingBox] = None
    location_description: Optional[str] = None

    altitude_meters: Optional[Range[float]] = None
    gsd_cm_px: Optional[Range[float]] = None
