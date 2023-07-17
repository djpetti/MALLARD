"""
Tests for the `video_metadata` module.
"""


from datetime import datetime
from typing import Any, Dict

import pytest
from faker import Faker
from fastapi import UploadFile
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

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
