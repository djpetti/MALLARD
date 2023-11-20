"""
Tests for the `transcoder_client` module.
"""


from asyncio import IncompleteReadError
from unittest import mock

import pytest
from aiohttp import ClientResponse
from faker import Faker
from fastapi import HTTPException, UploadFile
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.config_view_mock import ConfigViewMock
from mallard.gateway.routers.videos import transcoder_client
from mallard.type_helpers import ArbitraryTypesConfig


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class ConfigForTests:
    """
    Encapsulates standard configuration for most tests.

    Attributes:
        mock_get_session: The mocked `get_session` function.
        mock_read_file_chunks: The mocked `read_file_chunks` function.
        mock_form_data_class: The mocked `FormData` class.
        mock_config: The mocked `ConfigView` instance.

        mock_video: The mocked `UploadFile` object to use for testing.

    """

    mock_get_session: mock.Mock
    mock_read_file_chunks: mock.Mock
    mock_form_data_class: mock.Mock
    mock_config: ConfigViewMock

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
    mock_form_data_class = mocker.patch(
        f"{transcoder_client.__name__}.aiohttp.FormData"
    )
    mock_config = mocker.patch.object(
        transcoder_client, "config", new_callable=ConfigViewMock
    )

    mock_video = faker.upload_file()

    # Set a valid transcoder URL.
    mock_config["transcoder"]["base_url"].as_str.return_value = faker.uri()

    return ConfigForTests(
        mock_get_session=mock_get_session,
        mock_read_file_chunks=mock_read_file_chunks,
        mock_form_data_class=mock_form_data_class,
        mock_video=mock_video,
        mock_config=mock_config,
    )


@pytest.fixture
def mock_response(mocker: MockFixture) -> ClientResponse:
    """
    Fixture that creates a mocked `ClientResponse` object.

    Args:
        mocker: The fixture to use for mocking.

    Returns:
        The mocked object.

    """
    mock_response = mocker.create_autospec(ClientResponse, instance=True)
    mock_response.status = 200
    return mock_response


@pytest.fixture
def binary_content(mock_response: MockFixture, faker: Faker) -> bytes:
    """
    Fixture that sets up a response containing a binary blob as content.

    Args:
        mock_response: The mocked response object.
        faker: The fixture to use for generating fake data.

    Returns:
        The binary blob.

    """
    mock_response.content.readexactly = mock.AsyncMock()
    initial_chunks = [faker.binary(1024) for _ in range(3)]
    read_error = IncompleteReadError(b"", None)
    mock_response.content.readexactly.side_effect = initial_chunks + [
        read_error
    ]

    return b"".join(initial_chunks) + read_error.partial


@pytest.mark.asyncio
async def test_probe_video(
    config: ConfigForTests, mock_response: ClientResponse
) -> None:
    """
    Tests that `probe_video` works.

    Args:
        config: The standard configuration to use for testing.
        mock_response: The mocked response object.

    """
    # Arrange.
    mock_post = config.mock_get_session.return_value.post

    # Make it look like the transcoder service produced a valid response.
    mock_post.return_value.__aenter__.return_value = mock_response

    # Act.
    probe_results = await transcoder_client.probe_video(
        config.mock_video,
    )

    # Assert.
    config.mock_get_session.assert_called_once_with()
    mock_post.assert_called_once_with(
        "/metadata/infer",
        data=mock.ANY,
        timeout=transcoder_client.PROBE_TIMEOUT,
    )
    config.mock_read_file_chunks.assert_called_once_with(
        config.mock_video, max_length=mock.ANY
    )

    # It should have produced a correct form.
    config.mock_form_data_class.assert_called_once_with()
    mock_form_data = config.mock_form_data_class.return_value
    mock_form_data.add_field.assert_called_once_with(
        "video",
        config.mock_read_file_chunks.return_value,
        filename=config.mock_video.filename,
        content_type=config.mock_video.content_type,
    )

    # It should have read the probe results.
    assert probe_results == mock_response.json.return_value


@pytest.mark.asyncio
async def test_probe_video_bad_response(
    config: ConfigForTests, mocker: MockFixture
) -> None:
    """
    Tests that `probe_video` handles a bad response from the transcoder service.

    Args:
        config: The configuration to use for testing.
        mocker: The fixture to use for generating fake data.

    """
    # Arrange.
    mock_post = config.mock_get_session.return_value.post

    # Make it look like the transcoder service produced an invalid response.
    mock_response = mocker.create_autospec(ClientResponse, instance=True)
    mock_response.status = 500
    mock_post.return_value.__aenter__.return_value = mock_response

    # Act and assert.
    with pytest.raises(transcoder_client.HTTPException):
        await transcoder_client.probe_video(
            config.mock_video,
        )


@pytest.mark.asyncio
async def test_create_preview(
    config: ConfigForTests,
    faker: Faker,
    mock_response: ClientResponse,
    binary_content: bytes,
) -> None:
    """
    Tests that `create_preview` works.

    Args:
        config: The configuration to use for testing.
        faker: Fixture to use for generating fake data.
        mock_response: The mocked response object.
        binary_content: The binary content of the response object.

    """
    # Arrange.
    mock_post = config.mock_get_session.return_value.post
    video_ref = faker.object_ref()

    # Make it look like the transcoder service produced a valid response.
    mock_post.return_value.__aenter__.return_value = mock_response

    # Act.
    got_preview = transcoder_client.create_preview(
        video_ref,
    )

    # Assert.
    # It should have read the probe results.
    got_preview_data = b"".join([c async for c in got_preview])
    assert got_preview_data == binary_content

    config.mock_get_session.assert_called_once_with()
    mock_post.assert_called_once_with(
        f"/create_preview/{video_ref.bucket}/{video_ref.name}",
        timeout=mock.ANY,
    )


@pytest.mark.asyncio
async def test_create_preview_bad_response(
    config: ConfigForTests, mocker: MockFixture, faker: Faker
) -> None:
    """
    Tests that `create_preview` handles a bad response from the transcoder
    service.

    Args:
        config: The configuration to use for testing.
        mocker: The fixture to use for generating fake data.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    mock_post = config.mock_get_session.return_value.post
    video_ref = faker.object_ref()

    # Make it look like the transcoder service produced an invalid response.
    mock_response = mocker.create_autospec(ClientResponse, instance=True)
    mock_response.status = 500
    mock_post.return_value.__aenter__.return_value = mock_response

    # Act and assert.
    with pytest.raises(transcoder_client.HTTPException):
        async for _ in transcoder_client.create_preview(
            video_ref,
        ):
            pass


@pytest.mark.asyncio
async def test_create_streamable(
    config: ConfigForTests,
    mock_response: ClientResponse,
    binary_content: bytes,
    faker: Faker,
) -> None:
    """
    Tests that `create_streamable` works.

    Args:
        config: The configuration to use for testing.
        mock_response: The mocked response object.
        binary_content: The binary content of the response object.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    mock_post = config.mock_get_session.return_value.post
    video_ref = faker.object_ref()

    # Make it look like the transcoder service produced a valid response.
    mock_post.return_value.__aenter__.return_value = mock_response

    # Act.
    got_stream = transcoder_client.create_streamable(
        video_ref,
    )

    # Assert.
    # It should have read the streaming results.
    got_video_data = b"".join([c async for c in got_stream])
    assert got_video_data == binary_content

    config.mock_get_session.assert_called_once_with()
    mock_post.assert_called_once_with(
        f"/create_streaming_video/{video_ref.bucket}/{video_ref.name}",
        timeout=mock.ANY,
    )


@pytest.mark.asyncio
async def test_create_streamable_bad_response(
    config: ConfigForTests, mocker: MockFixture, faker: Faker
) -> None:
    """
    Tests that `create_streamable` handles a bad response from the transcoder
    service.

    Args:
        config: The configuration to use for testing.
        mocker: The fixture to use for generating fake data.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    mock_post = config.mock_get_session.return_value.post
    video_ref = faker.object_ref()

    # Make it look like the transcoder service produced an invalid response.
    mock_response = mocker.create_autospec(ClientResponse, instance=True)
    mock_response.status = 500
    mock_post.return_value.__aenter__.return_value = mock_response

    # Act and assert.
    with pytest.raises(transcoder_client.HTTPException):
        async for _ in transcoder_client.create_streamable(
            video_ref,
        ):
            pass


@pytest.mark.asyncio
async def test_create_thumbnail(
    config: ConfigForTests,
    faker: Faker,
    mock_response: ClientResponse,
    binary_content: bytes,
) -> None:
    """
    Tests that `create_thumbnail` works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        mock_response: The mocked response object.
        binary_content: The binary content of the response object.

    """
    # Arrange.
    mock_post = config.mock_get_session.return_value.post
    video_ref = faker.object_ref()

    # Make it look like the transcoder service produced a valid response.
    mock_post.return_value.__aenter__.return_value = mock_response

    # Act.
    got_preview = transcoder_client.create_thumbnail(
        video_ref,
    )

    # Assert.
    # It should have read the probe results.
    got_preview_data = b"".join([c async for c in got_preview])
    assert got_preview_data == binary_content

    config.mock_get_session.assert_called_once_with()
    mock_post.assert_called_once_with(
        f"/create_thumbnail/{video_ref.bucket}/{video_ref.name}"
    )


@pytest.mark.asyncio
async def test_create_thumbnail_bad_response(
    config: ConfigForTests, mocker: MockFixture, faker: Faker
) -> None:
    """
    Tests that `create_thumbnail` handles a bad response from the transcoder
    service.

    Args:
        config: The configuration to use for testing.
        mocker: The fixture to use for generating fake data.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    mock_post = config.mock_get_session.return_value.post
    video_ref = faker.object_ref()

    # Make it look like the transcoder service produced an invalid response.
    mock_response = mocker.create_autospec(ClientResponse, instance=True)
    mock_response.status = 500
    mock_post.return_value.__aenter__.return_value = mock_response

    # Act and assert.
    with pytest.raises(transcoder_client.HTTPException):
        async for _ in transcoder_client.create_thumbnail(
            video_ref,
        ):
            pass
