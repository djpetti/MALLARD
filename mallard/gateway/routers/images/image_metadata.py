"""
Helper functions for extracting metadata from images.
"""


import enum
import imghdr
from datetime import datetime, timezone, tzinfo
from functools import cached_property
from typing import BinaryIO, Optional, TypeVar

import exifread
from fastapi import UploadFile
from loguru import logger

from ...backends.metadata.schemas import GeoPoint, ImageFormat, ImageMetadata


class InvalidImageError(Exception):
    """
    Raised when an image is invalid.
    """


class MissingLengthError(Exception):
    """
    Raised when the file length is not specified,
    and the content-length header is missing.
    """


class ExifReader:
    """
    Extracts EXIF data from images.
    """

    @enum.unique
    class LatLonDirection(enum.Enum):
        """
        Possible directions that can be used for lat/lon values.
        """

        NORTH = "N"
        SOUTH = "S"
        EAST = "E"
        WEST = "W"

    @enum.unique
    class ExifTag(enum.Enum):
        """
        EXIF tag names.
        """

        IMAGE_DATE_TIME = "Image DateTime"
        IMAGE_MAKE = "Image Make"
        IMAGE_MODEL = "Image Model"
        GPS_LATITUDE = "GPS GPSLatitude"
        GPS_LONGITUDE = "GPS GPSLongitude"
        GPS_LATITUDE_REF = "GPS GPSLatitudeRef"
        GPS_LONGITUDE_REF = "GPS GPSLongitudeRef"

    def __init__(self, image_file: UploadFile, *, local_tz: tzinfo):
        """
        Args:
            image_file: The file to extract EXIF data from.
            local_tz: Specifies the offset of the user's local timezone from
                GMT, in hours.
        """
        self.__name = image_file.filename
        self.__exif = exifread.process_file(image_file.file, details=False)
        logger.debug(
            "Read raw EXIF data from {}: {}", self.__name, self.__exif
        )

        self.__local_tz = local_tz

    @classmethod
    def __dms_to_decimal(
        cls,
        degrees: float,
        minutes: float,
        seconds: float,
        *,
        direction: LatLonDirection,
    ) -> float:
        """
        Converts an angle specified in degrees, minutes, seconds into decimal
        degrees.

        Args:
            degrees: The degrees value.
            minutes: The minutes value.
            seconds: The seconds value.
            direction: The direction reference that is associated with this
                angle.

        Returns:
            The same angle in decimal degrees.

        """
        angle = degrees + minutes / 60 + seconds / (60**2)
        if direction in {cls.LatLonDirection.WEST, cls.LatLonDirection.SOUTH}:
            angle *= -1

        return angle

    @cached_property
    def capture_datetime(self) -> datetime:
        """
        Extracts the date and time at which this image was captured. Will fall
        back on the current date and time if it can't be found.

        Returns:
            The extracted date and time.

        """
        capture_time_tag = self.__exif.get(self.ExifTag.IMAGE_DATE_TIME.value)
        if capture_time_tag is None:
            logger.warning(
                "Image {} has no capture date/time tag.", self.__name
            )
            return datetime.now(timezone.utc)

        # Parse the time.
        try:
            capture_time = datetime.strptime(
                capture_time_tag.values, "%Y:%m:%d %H:%M:%S"
            )
        except ValueError:
            logger.error(
                "Image {} has capture time {}, but format is not correct.",
                self.__name,
                capture_time_tag.values,
            )
            return datetime.now(timezone.utc)

        # Convert to UTC. Note that EXIF is not timezone-aware, so a reasonable
        # assumption is that it's in the user's local timezone.
        capture_time = capture_time.replace(tzinfo=self.__local_tz)
        return capture_time.astimezone(timezone.utc)

    @cached_property
    def camera(self) -> Optional[str]:
        """
        Returns:
            A string representing the camera make and model. If this can't be
            extracted, it will return None.

        """
        make_tag = self.__exif.get(self.ExifTag.IMAGE_MAKE.value)
        model_tag = self.__exif.get(self.ExifTag.IMAGE_MODEL.value)
        if make_tag is None or model_tag is None:
            logger.warning(
                "Image {} has no camera make/model tags.", self.__name
            )
            return None

        return f"{make_tag.values} {model_tag.values}"

    @cached_property
    def location(self) -> GeoPoint:
        """
        Returns:
            The location that the image was taken at. If this can't be
            extracted, it will return an empty `GeoPoint`.

        """
        # Parse the GPS data.
        lat = self.__exif.get(self.ExifTag.GPS_LATITUDE.value)
        lon = self.__exif.get(self.ExifTag.GPS_LONGITUDE.value)
        lat_direction = self.__exif.get(self.ExifTag.GPS_LATITUDE_REF.value)
        lon_direction = self.__exif.get(self.ExifTag.GPS_LONGITUDE_REF.value)
        if None in {lat, lon, lat_direction, lon_direction}:
            logger.warning("Image {} is missing GPS tags.", self.__name)
            return GeoPoint()

        try:
            lat_direction = self.LatLonDirection(lat_direction.values)
            lon_direction = self.LatLonDirection(lon_direction.values)
        except ValueError:
            logger.warning(
                "Image {} has GPS directions {} and {}, which are invalid.",
                self.__name,
                lat_direction,
                lon_direction,
            )
            return GeoPoint()

        # Convert to decimal degrees.
        lat_floats = [c.decimal() for c in lat.values]
        lat_decimal = self.__dms_to_decimal(
            *lat_floats, direction=lat_direction
        )
        lon_floats = [c.decimal() for c in lon.values]
        lon_decimal = self.__dms_to_decimal(
            *lon_floats, direction=lon_direction
        )

        return GeoPoint(latitude_deg=lat_decimal, longitude_deg=lon_decimal)


_JPEG_MAGIC = b"\xff\xd8\xff"
"""
JPEG magic header bytes.
"""


def _test_jpeg(header: bytes, _: Optional[BinaryIO]) -> Optional[str]:
    """
    Additional test for JPEG images to work around this bug
    (https://bugs.python.org/issue28591) in `imghdr`.

    Args:
        header: The 32-byte header data to check.

    Returns:
        The string "jpeg" if it is a JPEG, or None if it is not.

    """
    if header.startswith(_JPEG_MAGIC):
        return "jpeg"


imghdr.tests.append(_test_jpeg)


MetadataType = TypeVar("MetadataType", bound=ImageMetadata)


async def _check_format(
    metadata: MetadataType, *, image: UploadFile
) -> ImageFormat:
    """
    Checks the format of an image.

    Args:
        metadata: The metadata specified by the user.
        image: The image.

    Returns:
        The format that it deduced for the image.

    Raises:
        `InvalidImageError` if either the format could not be deduced, or the
        user supplied an expected format that does not match the actual format.

    """
    format_str = imghdr.what(image.file)
    logger.debug("Got format for image {}: '{}'", image.filename, format_str)

    # Reset the image file after reading data.
    await image.seek(0)

    try:
        image_format = ImageFormat(format_str)
    except ValueError:
        raise InvalidImageError(f"Image has unknown format '{format_str}'.")

    if metadata.format is not None and image_format != metadata.format:
        raise InvalidImageError(
            f"Image has format {image_format}, but expected format"
            f" {metadata.format}."
        )

    return image_format


async def fill_metadata(
    metadata: MetadataType, *, image: UploadFile, local_tz: tzinfo
) -> MetadataType:
    """
    Attempts to fill in missing image metadata automatically.

    Args:
        metadata: The image metadata to fill in.
        image: The corresponding image.
        local_tz: Specifies the user's local timezone.

    Returns:
        A completed copy of the image metadata.

    """
    # Fill in missing fields.
    size = metadata.size
    if size is None:
        size = image.headers.get("content-length")
    if size is None:
        raise MissingLengthError("No size specified for image upload.")

    name = metadata.name
    if name is None:
        name = image.filename

    exif = ExifReader(image, local_tz=local_tz)

    # Reset the image file after reading the EXIF data.
    await image.seek(0)

    capture_date = metadata.capture_date
    if capture_date is None:
        capture_date = exif.capture_datetime.date()
    camera = metadata.camera
    if camera is None:
        camera = exif.camera
    location = metadata.location
    if location.latitude_deg is None or location.longitude_deg is None:
        location = exif.location

    update_fields = dict(
        size=size,
        name=name,
        capture_date=capture_date,
        camera=camera,
        location=location,
        format=await _check_format(metadata, image=image),
    )
    logger.debug("Updating metadata with fields {}.", update_fields)
    return metadata.copy(update=update_fields)
