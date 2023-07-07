"""
Tests for the `video_metadata` module.
"""


from typing import Any, Dict
from unittest import mock

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
