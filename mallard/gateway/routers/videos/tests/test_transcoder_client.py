"""
Tests for the `transcoder_client` module.
"""


from unittest import mock

import pytest
from aiohttp import ClientResponse
from faker import Faker
from fastapi import UploadFile
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.gateway.routers.videos import transcoder_client
from mallard.type_helpers import ArbitraryTypesConfig


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class ConfigForTests:
    """
    Encapsulates standard configuration for most tests.

    Attributes:
        mock_get_session: The mocked `get_session` function.
        mock_read_file_chunks: The mocked `read_file_chunks` function.

        mock_video: The mocked `UploadFile` object to use for testing.

    """

    mock_get_session: mock.Mock
    mock_read_file_chunks: mock.Mock

    mock_video: UploadFile


@pytest.fixture
def config(mocker: MockFixture, faker: Faker) -> ConfigForTests:
    """
    Fixture that creates standard configuration for most tests.

    Args:
        mocker: Fixture to use for mocking.
        faker: The fixture to use for generating fake data.

    Returns:
        The configuration that it generated.

    """
    mock_get_session = mocker.patch(
        f"{transcoder_client.__name__}.get_session"
    )
    mock_read_file_chunks = mocker.patch(
        f"{transcoder_client.__name__}.read_file_chunks"
    )

    mock_video = faker.upload_file()

    return ConfigForTests(
        mock_get_session=mock_get_session,
        mock_read_file_chunks=mock_read_file_chunks,
        mock_video=mock_video,
    )


@pytest.mark.asyncio
async def test_probe_video(
    config: ConfigForTests, mocker: MockFixture
) -> None:
    """
    Tests that `probe_video` works.

    Args:
        config: The standard configuration to use for testing.
        mocker: The fixture to use for mocking.

    """
    # Arrange.
    # Make it look like the transcoder service produced a valid response.
    mock_response = mocker.create_autospec(ClientResponse, instance=True)
    mock_response.status = 200
    config.mock_get_session.return_value.post.return_value.__aenter__.return_value.json.return_value = (
        mock_response
    )

    # Act.
    await transcoder_client.probe_video(
        config.mock_video,
    )

    config.mock_get_session.assert_called_once()
    config.mock_read_file_chunks.assert_called_once()
