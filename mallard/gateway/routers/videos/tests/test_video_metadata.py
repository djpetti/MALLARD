"""
Tests for the `video_metadata` module.
"""


from datetime import date, datetime
from typing import Any, Dict
from unittest import mock

import pytest
from faker import Faker
from fastapi import UploadFile
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.gateway.artifact_metadata import MissingLengthError
from mallard.gateway.backends.metadata.schemas import (
    GeoPoint,
    UavVideoMetadata,
    VideoFormat,
)
from mallard.type_helpers import ArbitraryTypesConfig

from .. import video_metadata


class TestFFProbeReader:
    """
    Tests for the `FFProbeReader` class.
    """

    @dataclass(frozen=True, config=ArbitraryTypesConfig)
    class ConfigForTests:
        """
        Encapsulates standard configuration for most tests.

        Attributes:
            reader: The `FFProbeReader` object under test.
            mock_file: A mock `UploadFile` that we are processing.

            ffprobe_results: The results of the FFProbe call.

        """

        reader: video_metadata.FFProbeReader
        mock_file: UploadFile

        ffprobe_results: Dict[str, Any]

    @classmethod
    @pytest.fixture
    def config(cls, faker: Faker) -> ConfigForTests:
        """
        Generates standard configuration for most tests.

        Args:
            faker: The fixture to use for creating fake data.

        Returns:
            The configuration that it generated.

        """
        # Mock the dependencies.
        mock_file = faker.upload_file(category="image")

        # Fake the results of the FFProbe call.
        ffprobe_results = faker.ffprobe_results()

        reader = video_metadata.FFProbeReader(ffprobe_results)

        return cls.ConfigForTests(
            reader=reader,
            mock_file=mock_file,
            ffprobe_results=ffprobe_results,
        )

    def test_no_video_stream(self, config: ConfigForTests) -> None:
        """
        Tests that an exception is raised when there is no video stream.

        Args:
            config: The configuration to use for testing.

        """
        # Arrange.
        # Remove the video stream from FFProbe.
        config.ffprobe_results["streams"] = []

        # Act and assert.
        with pytest.raises(video_metadata.InvalidVideoError):
            video_metadata.FFProbeReader(config.ffprobe_results)

    def test_capture_datetime(self, config: ConfigForTests) -> None:
        """
        Tests that the capture date/time is correct.

        Args:
            config: The configuration to use for the test.

        """
        # Arrange.
        # Check the capture time from FFProbe.
        capture_datetime = datetime.fromisoformat(
            config.ffprobe_results["format"]["tags"]["creation_time"]
        )

        # Act and assert.
        assert config.reader.capture_datetime == capture_datetime

    def test_capture_datetime_missing(
        self, config: ConfigForTests, mocker: MockFixture, faker: Faker
    ) -> None:
        """
        Tests that it returns the current time when there is no capture time
        metadata.

        Args:
            config: The configuration to use for the test.
            mocker: The fixture to use for mocking.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Mock out the datetime call so we can control what it returns.
        mock_datetime_class = mocker.patch(
            f"{video_metadata.__name__}.datetime"
        )
        fake_current_time = faker.date_time_this_century()
        mock_datetime_class.now.return_value = fake_current_time

        # Remove the capture time from FFProbe.
        config.ffprobe_results["format"]["tags"].pop("creation_time")

        # Act and assert.
        assert config.reader.capture_datetime == fake_current_time

    def test_format(self, config: ConfigForTests) -> None:
        """
        Tests that extracting the video format works.

        Args:
            config: The configuration to use for testing.

        """
        # Arrange.
        # Check the format from FFProbe.
        format_code = config.ffprobe_results["streams"][1]["codec_name"]
        format_ = video_metadata.FFProbeReader.FFPROBE_FORMAT_CODES[
            format_code
        ]

        # Act and assert.
        assert config.reader.format == format_

    def test_unknown_format(self, config: ConfigForTests) -> None:
        """
        Tests that it raises an exception if the format is unknown.

        Args:
            config: The configuration to use for testing.

        """
        # Arrange.
        # Add an invalid format.
        config.ffprobe_results["streams"][1]["codec_name"] = "unknown"

        # Act and assert.
        with pytest.raises(video_metadata.InvalidVideoError):
            (lambda: config.reader.format)()

    def test_frame_rate(self, config: ConfigForTests) -> None:
        """
        Tests that extracting the frame rate works.

        Args:
            config: The configuration to use for testing.

        """
        # Arrange.
        # Check the frame rate from FFProbe.
        frame_rate = eval(
            config.ffprobe_results["streams"][1]["avg_frame_rate"]
        )

        # Act and assert.
        assert config.reader.frame_rate == frame_rate

    def test_num_frames(self, config: ConfigForTests) -> None:
        """
        Tests that extracting the number of frames works.

        Args:
            config: The configuration to use for testing.

        """
        # Arrange.
        # Check the number of frames from FFProbe.
        num_frames = int(config.ffprobe_results["streams"][1]["nb_frames"])

        # Act and assert.
        assert config.reader.num_frames == num_frames


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class FillMetadataConfig:
    """
    Common configuration for test of the `fill_metadata` function.

    Attributes:
        mock_probe_video: The mocked `probe_video` function.
        mock_upload_file: The mocked `UploadFile` to use for testing.

        probe_results: The fake results of FFProbe.

    """

    mock_probe_video: mock.Mock
    mock_upload_file: UploadFile

    probe_results: Dict[str, Any]


@pytest.fixture
def fill_meta_config(mocker: MockFixture, faker: Faker) -> FillMetadataConfig:
    """
    Generates common configuration for tests of the `fill_metadata` function.

    Args:
        mocker: The fixture to use for mocking.
        faker: The fixture to use for generating fake data.

    Returns:
        The configuration that it generated.

    """
    # Mock the dependencies.
    mock_probe_video = mocker.patch(f"{video_metadata.__name__}.probe_video")
    mock_upload_file = faker.upload_file(category="video")

    # Make it look like the probe produced results.
    probe_results = faker.ffprobe_results()
    mock_probe_video.return_value = probe_results

    return FillMetadataConfig(
        mock_probe_video=mock_probe_video,
        mock_upload_file=mock_upload_file,
        probe_results=probe_results,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "metadata",
    (
        UavVideoMetadata(),
        UavVideoMetadata(
            name="name",
            capture_date=date(2021, 1, 19),
            camera="camera",
            location=GeoPoint(latitude_deg=32, longitude_deg=-114),
        ),
        UavVideoMetadata(size=1337),
    ),
    ids=("empty_metadata", "populated_metadata", "size_from_meta"),
)
async def test_fill_metadata(
    fill_meta_config: FillMetadataConfig,
    metadata: UavVideoMetadata,
) -> None:
    """
    Tests that the `fill_metadata` function works.

    Args:
        fill_meta_config: The configuration to use for testing.
        metadata: The initial metadata to use for testing.

    """
    # Arrange.
    if metadata.size is not None:
        # In this case, simulate the absense of the content-length header.
        fill_meta_config.mock_upload_file.headers = {}

    # Act.
    got_metadata = await video_metadata.fill_metadata(
        metadata, video=fill_meta_config.mock_upload_file
    )

    # Assert.
    # It should have reset the position in the video file after reading.
    fill_meta_config.mock_upload_file.seek.assert_called_once_with(0)

    # None of the values populated from FFProbe results or file metadata should
    # have been left unfilled.
    assert got_metadata.name is not None
    assert got_metadata.capture_date is not None
    assert got_metadata.frame_rate is not None
    assert got_metadata.num_frames is not None
    assert got_metadata.format is not None

    # The size should have been set correctly.
    if metadata.size is not None:
        assert got_metadata.size == metadata.size
    else:
        assert (
            got_metadata.size
            == fill_meta_config.mock_upload_file.headers["content-length"]
        )


@pytest.mark.asyncio
async def test_fill_metadata_missing_length(
    fill_meta_config: FillMetadataConfig,
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
    with pytest.raises(MissingLengthError):
        await video_metadata.fill_metadata(
            UavVideoMetadata(),
            video=fill_meta_config.mock_upload_file,
        )


@pytest.mark.asyncio
async def test_fill_metadata_mismatched_format(
    fill_meta_config: FillMetadataConfig, faker: Faker
) -> None:
    """
    Tests that `fill_metadata` fails if the format of the file does not match
    what's listed in the metadata.

    Args:
        fill_meta_config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Make it look like the format does not match.
    fill_meta_config.probe_results["format"]["format_name"] = "h264"

    metadata = faker.video_metadata()
    metadata.copy(update=dict(format=VideoFormat.H263))

    # Act and assert.
    with pytest.raises(video_metadata.InvalidVideoError):
        await video_metadata.fill_metadata(
            metadata, video=fill_meta_config.mock_upload_file
        )
