"""
Tests for the `image_metadata` module.
"""


import enum
import unittest.mock as mock
from datetime import date, datetime, timezone, tzinfo
from typing import Dict

import dateutil.tz
import pytest
from exifread.classes import IfdTag
from faker import Faker
from fastapi import UploadFile
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

import mallard.gateway.artifact_metadata
from mallard.gateway.backends.metadata.schemas import (
    GeoPoint,
    ImageFormat,
    UavImageMetadata,
)
from mallard.gateway.routers.images import image_metadata
from mallard.type_helpers import ArbitraryTypesConfig

ExifTag = image_metadata.ExifReader.ExifTag


@pytest.fixture
def local_tz(faker: Faker) -> timezone:
    """
    Args:
        faker: The fixture to use for generating fake data.

    Returns:
        An arbitrary timezone.

    """
    local_tz_name = faker.timezone()
    local_tz = dateutil.tz.gettz(local_tz_name)
    assert local_tz is not None, f"Invalid TZ {local_tz_name} from Faker?"

    return local_tz


class TestExifReader:
    """
    Tests for the `ExifReader` class.
    """

    @dataclass(frozen=True, config=ArbitraryTypesConfig)
    class ConfigForTests:
        """
        Encapsulates standard configuration for most tests.

        Attributes:
            reader: The `ExifReader` object under test.
            mock_file: The mocked `UploadFile` that we are processing.
            mock_process_file: The mocked `exifread.process_file` function.

            timezone: The local timezone that we will use for testing.
            date_time: The raw timestamp embedded in the EXIF data.
            exif_tags: The dictionary containing the EXIF tags that we passed
                to the reader.

        """

        reader: image_metadata.ExifReader
        mock_file: UploadFile
        mock_process_file: mock.Mock

        timezone: tzinfo
        date_time: datetime
        exif_tags: Dict[str, IfdTag]

    @classmethod
    @pytest.fixture
    def config(
        cls, mocker: MockFixture, faker: Faker, local_tz: timezone
    ) -> ConfigForTests:
        """
        Generates standard configuration for most tests.

        Args:
            mocker: The fixture to use for mocking.
            faker: The fixture to use for creating fake data.
            local_tz: The local timezone to use.

        Returns:
            The configuration that it generated.

        """
        # Mock the dependencies.
        mock_file = faker.upload_file(category="image")
        mock_process_file = mocker.patch("exifread.process_file")

        # Make it look like it produces arbitrary EXIF data.
        exif_tags = faker.exif_tags()
        # Use a known timestamp.
        date_time = faker.date_time()
        exif_tags[ExifTag.IMAGE_DATE_TIME.value] = faker.image_date_time(
            date_time=date_time
        )

        mock_process_file.return_value = exif_tags

        reader = image_metadata.ExifReader(mock_file, local_tz=local_tz)

        return cls.ConfigForTests(
            reader=reader,
            mock_file=mock_file,
            mock_process_file=mock_process_file,
            timezone=local_tz,
            date_time=date_time,
            exif_tags=exif_tags,
        )

    def test_capture_datetime(self, config: ConfigForTests) -> None:
        """
        Tests that the `capture_datetime` property works.

        Args:
            config: The configuration to use for testing.

        """
        # Act.
        got_date_time = config.reader.capture_datetime

        # Assert.
        # The expected time is actually going to be shifted into UTC.
        date_time = config.date_time.replace(tzinfo=config.timezone)
        date_time = date_time.astimezone(timezone.utc)

        # It should have gotten the right date/timestamp.
        assert got_date_time == date_time

    def test_capture_datetime_missing_tags(
        self, config: ConfigForTests, mocker: MockFixture
    ) -> None:
        """
        Tests that the `capture_datetime` property handles missing EXIF tags.

        Args:
            config: The configuration to use for testing.
            mocker: The fixture to use for mocking.

        """
        # Arrange.
        # Mock the datetime class to produce consistent results.
        mock_datetime_class = mocker.patch(
            image_metadata.__name__ + ".datetime"
        )

        # Make it look like we have missing tags.
        config.exif_tags.pop(ExifTag.IMAGE_DATE_TIME.value)

        # Recreate the reader with the new EXIF tags.
        config.mock_process_file.return_value = config.exif_tags
        reader = image_metadata.ExifReader(
            config.mock_file, local_tz=config.timezone
        )

        # Act.
        got_date_time = reader.capture_datetime

        # Assert.
        # It should have just gotten the current date and time.
        mock_datetime_class.now.assert_called_once_with(timezone.utc)
        assert got_date_time == mock_datetime_class.now.return_value

    def test_capture_datetime_invalid_format(
        self, config: ConfigForTests, mocker: MockFixture
    ) -> None:
        """
        Tests that the `capture_datetime` property handles
        improperly-formatted timestamps.

        Args:
            config: The configuration to use for testing.
            mocker: The fixture to use for mocking.

        """
        # Arrange.
        # Mock the datetime class to produce consistent results.
        mock_datetime_class = mocker.patch(
            image_metadata.__name__ + ".datetime"
        )
        # However, make sure that the strptime function still works.
        mock_datetime_class.strptime.side_effect = datetime.strptime

        # Make it look like the timestamp is invalid.
        config.exif_tags[ExifTag.IMAGE_DATE_TIME.value].values = "invalid"

        # Recreate the reader with the new EXIF tags.
        config.mock_process_file.return_value = config.exif_tags
        reader = image_metadata.ExifReader(
            config.mock_file, local_tz=config.timezone
        )

        # Act.
        got_date_time = reader.capture_datetime

        # Assert.
        # It should have just gotten the current date and time.
        mock_datetime_class.now.assert_called_once_with(timezone.utc)
        assert got_date_time == mock_datetime_class.now.return_value

    def test_camera(self, config: ConfigForTests) -> None:
        """
        Tests that the `camera` property works.

        Args:
            config: The configuration to use for testing.

        """
        # Act.
        got_camera = config.reader.camera

        # Assert.
        # The camera string should just be derived from the image make and
        # model tags.
        camera_make = config.exif_tags[ExifTag.IMAGE_MAKE.value].values
        camera_model = config.exif_tags[ExifTag.IMAGE_MODEL.value].values
        expected_camera = f"{camera_make} {camera_model}"
        assert got_camera == expected_camera

    @pytest.mark.parametrize(
        "missing_tag",
        (ExifTag.IMAGE_MAKE, ExifTag.IMAGE_MODEL),
        ids=("missing_make", "missing_model"),
    )
    def test_camera_missing_tags(
        self, config: ConfigForTests, missing_tag: ExifTag
    ) -> None:
        """
        Tests that the `camera` property handles missing EXIF tags.

        Args:
            config: The configuration to use for testing.
            missing_tag: The tag that we want to simulate as missing.

        """
        # Arrange.
        # Make it look like we have missing tags.
        config.exif_tags.pop(missing_tag.value)

        # Recreate the reader with the new EXIF tags.
        config.mock_process_file.return_value = config.exif_tags
        reader = image_metadata.ExifReader(
            config.mock_file, local_tz=config.timezone
        )

        # Act.
        got_camera = reader.camera

        # Assert.
        assert got_camera is None

    @pytest.mark.parametrize(
        "lat_direction", ("N", "S"), ids=("north", "south")
    )
    @pytest.mark.parametrize("lon_direction", ("E", "W"), ids=("east", "west"))
    def test_location(
        self, config: ConfigForTests, lat_direction: str, lon_direction: str
    ) -> None:
        """
        Tests that the `location` property works.

        Args:
            config: The configuration to use for testing.
            lat_direction: The latitude direction to use.
            lon_direction: The longitude direction to use.

        """
        # Arrange.
        # Set the specified lat/lon direction.
        config.exif_tags[ExifTag.GPS_LATITUDE_REF.value].values = lat_direction
        config.exif_tags[
            ExifTag.GPS_LONGITUDE_REF.value
        ].values = lon_direction

        # Recreate the reader with the new EXIF tags.
        config.mock_process_file.return_value = config.exif_tags
        reader = image_metadata.ExifReader(
            config.mock_file, local_tz=config.timezone
        )

        # Act.
        got_location = reader.location

        # Assert.
        # Make sure the lat and lon values are reasonable.
        if lat_direction == "N":
            assert 0.0 <= got_location.latitude_deg <= 90.0
        else:
            assert -90.0 <= got_location.latitude_deg <= 90.0
        if lon_direction == "E":
            assert 0.0 <= got_location.longitude_deg <= 180.0
        else:
            assert -180.0 <= got_location.longitude_deg <= 0.0

    @pytest.mark.parametrize(
        "missing_tag",
        (
            ExifTag.GPS_LATITUDE,
            ExifTag.GPS_LONGITUDE,
            ExifTag.GPS_LATITUDE_REF,
            ExifTag.GPS_LONGITUDE_REF,
        ),
        ids=(
            "missing_lat",
            "missing_lon",
            "missing_lat_ref",
            "missing_lon_ref",
        ),
    )
    def test_location_missing_tags(
        self, config: ConfigForTests, missing_tag: ExifTag
    ) -> None:
        """
        Tests that the `location` property handles missing EXIF tags.

        Args:
            config: The configuration to use for testing.
            missing_tag: The tag to simulate as missing.

        """
        # Arrange.
        # Make it look like we have missing tags.
        config.exif_tags.pop(missing_tag.value)

        # Recreate the reader with the new EXIF tags.
        config.mock_process_file.return_value = config.exif_tags
        reader = image_metadata.ExifReader(
            config.mock_file, local_tz=config.timezone
        )

        # Act.
        got_location = reader.location

        # Assert.
        assert got_location.longitude_deg is None
        assert got_location.latitude_deg is None

    @pytest.mark.parametrize(
        "invalid_tag",
        (ExifTag.GPS_LATITUDE_REF, ExifTag.GPS_LONGITUDE_REF),
        ids=("lat_ref", "lon_ref"),
    )
    def test_location_invalid_direction(
        self, config: ConfigForTests, invalid_tag: ExifTag
    ) -> None:
        """
        Tests that the `location` property handles invalid direction tags.

        Args:
            config: The configuration to use for testing.
            invalid_tag: The specific tag to invalidate.

        Returns:

        """
        # Arrange.
        # Make it look like we have an invalid tag.
        config.exif_tags[invalid_tag.value].values = "invalid"

        # Recreate the reader with the new EXIF tags.
        config.mock_process_file.return_value = config.exif_tags
        reader = image_metadata.ExifReader(
            config.mock_file, local_tz=config.timezone
        )

        # Act.
        got_location = reader.location

        # Assert.
        assert got_location.longitude_deg is None
        assert got_location.latitude_deg is None


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class FillMetadataConfig:
    """
    Common configuration for tests of the `fill_metadata` function.

    Attributes:
        mock_reader_class: The mocked `ExifReader` class.
        mock_what: The mocked `imghdr.what` function.
        mock_upload_file: The mocked `UploadFile` to use for testing.

        image_format: The image format that `imghdr.what` will be set to return.
    """

    mock_reader_class: mock.Mock
    mock_what: mock.Mock
    mock_upload_file: UploadFile

    image_format: ImageFormat


@pytest.fixture
def fill_meta_config(mocker: MockFixture, faker: Faker) -> FillMetadataConfig:
    """
    Generates common configuration for tests of the `fill_metadata` function.

    Args:
        mocker: The fixture to use for mocking.
        faker: The fixture to use for generating fake data.

    """
    # Mock out the ExifReader class.
    mock_reader_class = mocker.patch(image_metadata.__name__ + ".ExifReader")
    # Mock out the imghdr functions.
    mock_what = mocker.patch("imghdr.what")

    # Make the fake ExifReader provide some reasonable results.
    mock_reader = mock_reader_class.return_value
    mock_reader.capture_datetime = faker.date_time()
    mock_reader.camera = faker.word()
    mock_reader.location = GeoPoint(
        latitude_deg=faker.latitude(), longitude_deg=faker.longitude()
    )

    # Choose a reasonable image format.
    image_format = faker.random_element([f for f in ImageFormat])
    mock_what.return_value = image_format.value

    # Create a fake UploadFile.
    mock_upload_file = faker.upload_file()

    return FillMetadataConfig(
        mock_reader_class=mock_reader_class,
        mock_what=mock_what,
        mock_upload_file=mock_upload_file,
        image_format=image_format,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "metadata",
    (
        UavImageMetadata(),
        UavImageMetadata(
            name="name",
            capture_date=date(2021, 1, 19),
            camera="camera",
            location=GeoPoint(latitude_deg=32, longitude_deg=-114),
        ),
        UavImageMetadata(size=1337),
    ),
    ids=("empty_metadata", "populated_metadata", "size_from_meta"),
)
async def test_fill_metadata(
    fill_meta_config: FillMetadataConfig,
    metadata: UavImageMetadata,
    local_tz: timezone,
) -> None:
    """
    Tests that `fill_metadata` works.

    Args:
        fill_meta_config: The configuration to use for testing.
        metadata: The initial metadata to provider.
        local_tz: The local timezone to use.

    """
    # Arrange.
    if metadata.size is not None:
        # In this case, simulate the absense of the content-length header.
        fill_meta_config.mock_upload_file.headers = {}

    # Act.
    got_metadata = await image_metadata.fill_metadata(
        metadata, image=fill_meta_config.mock_upload_file, local_tz=local_tz
    )

    # Assert.
    # None of the values populated from EXIF tags should be left unfilled.
    assert got_metadata.name is not None
    assert got_metadata.capture_date is not None
    assert got_metadata.camera is not None
    assert got_metadata.location.latitude_deg is not None
    assert got_metadata.location.longitude_deg is not None
    # The format should have been correctly deduced.
    assert got_metadata.format == fill_meta_config.image_format

    # The size should have been set correctly.
    if metadata.size is not None:
        assert got_metadata.size == metadata.size
    else:
        assert (
            got_metadata.size
            == fill_meta_config.mock_upload_file.headers["content-length"]
        )


@pytest.mark.asyncio
async def test_fill_metadata_naughty_jpeg(
    local_tz: timezone, faker: Faker
) -> None:
    """
    Tests that `fill_metadata` works when we give it a JPEG image that
    `imghdr` does not support out-of-the-box.

    Args:
        local_tz: The local timezone to use.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Create some fake JPEG-looking data.
    jpeg_header = b"\xff\xd8\xff"
    jpeg_contents = jpeg_header + faker.binary()
    fake_jpeg = faker.upload_file(
        category="image",
        contents=jpeg_contents,
    )

    # Act.
    got_metadata = await image_metadata.fill_metadata(
        UavImageMetadata(), image=fake_jpeg, local_tz=local_tz
    )

    # Assert.
    # It should have correctly determined the JPEG format.
    assert got_metadata.format == ImageFormat.JPEG


@pytest.mark.asyncio
async def test_fill_metadata_missing_length(
    fill_meta_config: FillMetadataConfig, local_tz: timezone
) -> None:
    """
    Tests that `fill_metadata` fails if it can't determine the size of the file.

    Args:
        fill_meta_config: The configuration to use for testing.

    """
    # Arrange.
    # Make it look like the length is not specified.
    fill_meta_config.mock_upload_file.headers = {}

    # Act and assert.
    with pytest.raises(mallard.gateway.artifact_metadata.MissingLengthError):
        await image_metadata.fill_metadata(
            UavImageMetadata(),
            image=fill_meta_config.mock_upload_file,
            local_tz=local_tz,
        )


@enum.unique
class FormatError(enum.IntEnum):
    """
    Represents the possible types of image format errors that we can encounter.
    """

    INDETERMINATE_FORMAT = enum.auto()
    """
    Image format could not be determined.
    """
    UNKNOWN_FORMAT = enum.auto()
    """
    Image format is not acceptable.
    """
    UNEXPECTED_FORMAT = enum.auto()
    """
    Image format was valid, but not what we expected.
    """


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "format_error", FormatError, ids=(e.name for e in FormatError)
)
async def test_fill_metadata_invalid_format(
    fill_meta_config: FillMetadataConfig,
    local_tz: timezone,
    format_error: FormatError,
) -> None:
    """
    Tests that `fill_metadata` behaves properly when the image format is
    invalid.

    Args:
        fill_meta_config: The configuration to use for testing.
        local_tz: The local timezone to use.
        format_error: The specific error condition to simulate.

    """
    # Arrange.
    expected_error = "unknown format"
    expected_format = fill_meta_config.image_format
    if format_error == FormatError.INDETERMINATE_FORMAT:
        # Make it look like the format could not be determined.
        fill_meta_config.mock_what.return_value = None
    elif format_error == FormatError.UNKNOWN_FORMAT:
        # Make it look like the format is not valid.
        fill_meta_config.mock_what.return_value = "invalid_format"
    elif format_error == FormatError.UNEXPECTED_FORMAT:
        # Make it look like this format was not what we expected.
        acceptable_values = {f for f in ImageFormat}
        acceptable_values.remove(fill_meta_config.image_format)
        expected_format = acceptable_values.pop()

        expected_error = "expected format"

    # Act and assert.
    with pytest.raises(image_metadata.InvalidImageError, match=expected_error):
        await image_metadata.fill_metadata(
            UavImageMetadata(format=expected_format),
            image=fill_meta_config.mock_upload_file,
            local_tz=local_tz,
        )
