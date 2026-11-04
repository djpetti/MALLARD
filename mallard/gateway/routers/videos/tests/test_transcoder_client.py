"""
Tests for the `transcoder_client` module.
"""

from asyncio import IncompleteReadError
from itertools import cycle
from unittest import mock

import pytest
from aiohttp import ClientResponse
from aiohttp.client_exceptions import ClientPayloadError
from faker import Faker
from fastapi import UploadFile
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
    mock_response.content.readexactly.side_effect = cycle(
        initial_chunks + [read_error]
    )

    return b"".join(initial_chunks) + read_error.partial


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "existing_video", [False, True], ids=["new_video", "existing_video"]
)
async def test_probe_video(
    config: ConfigForTests,
    mock_response: ClientResponse,
    faker: Faker,
    existing_video: bool,
) -> None:
    """
    Tests that `probe_video` works.

    Args:
        config: The standard configuration to use for testing.
        mock_response: The mocked response object.
        faker: The fixture to use for generating fake data.
        existing_video: Whether to simulate probing an existing video in the
            object store.

    """
    # Arrange.
    mock_post = config.mock_get_session.return_value.post

    # Make it look like the transcoder service produced a valid response.
    mock_post.return_value.__aenter__.return_value = mock_response

    fake_video = config.mock_video
    if existing_video:
        fake_video = faker.object_ref()

    # Act.
    probe_results = await transcoder_client.probe_video(fake_video)

    # Assert.
    config.mock_get_session.assert_called_once_with()
    endpoint = "/metadata/infer"
    expected_kwargs = dict(
        data=mock.ANY,
        timeout=transcoder_client.PROBE_TIMEOUT,
    )
    if existing_video:
        endpoint += f"/{fake_video.bucket}/{fake_video.name}"
        expected_kwargs.pop("data")
    mock_post.assert_called_once_with(endpoint, **expected_kwargs)
    if not existing_video:
        config.mock_read_file_chunks.assert_called_once_with(
            config.mock_video, max_length=mock.ANY
        )

    # It should have produced a correct form.
    if not existing_video:
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
@pytest.mark.parametrize(
    "existing_video", [False, True], ids=["new_video", "existing_video"]
)
async def test_probe_video_bad_response(
    config: ConfigForTests,
    mocker: MockFixture,
    faker: Faker,
    existing_video: bool,
) -> None:
    """
    Tests that `probe_video` handles a bad response from the transcoder service.

    Args:
        config: The configuration to use for testing.
        mocker: The fixture to use for generating fake data.
        faker: The fixture to use for generating fake data.
        existing_video: Whether to simulate probing an existing video in the
            object store.

    """
    # Arrange.
    mock_post = config.mock_get_session.return_value.post

    # Make it look like the transcoder service produced an invalid response.
    mock_response = mocker.create_autospec(ClientResponse, instance=True)
    mock_response.status = 500
    mock_post.return_value.__aenter__.return_value = mock_response

    fake_video = config.mock_video
    if existing_video:
        fake_video = faker.object_ref()

    # Act and assert.
    with pytest.raises(transcoder_client.HTTPException):
        await transcoder_client.probe_video(
            fake_video,
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
@pytest.mark.parametrize(
    "thumbnail_width",
    [None, 128, 256, 384],
    ids=["default", "128", "256", "384"],
)
async def test_create_thumbnail(
    config: ConfigForTests,
    faker: Faker,
    mock_response: ClientResponse,
    binary_content: bytes,
    thumbnail_width: int | None,
) -> None:
    """
    Tests that `create_thumbnail` forwards the selected or default width.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        mock_response: The mocked response object.
        binary_content: The binary content of the response object.
        thumbnail_width: The requested width, or None to use the default.

    """
    # Arrange.
    mock_post = config.mock_get_session.return_value.post
    video_ref = faker.object_ref()

    # Make it look like the transcoder service produced a valid response.
    mock_post.return_value.__aenter__.return_value = mock_response

    # Act.
    width_options = (
        {} if thumbnail_width is None else {"thumbnail_width": thumbnail_width}
    )
    got_preview = transcoder_client.create_thumbnail(
        video_ref, 512, **width_options
    )

    # Assert.
    # It should have read the probe results.
    got_preview_data = b"".join([c async for c in got_preview])
    assert got_preview_data == binary_content

    config.mock_get_session.assert_called_once_with()
    mock_post.assert_called_once_with(
        f"/create_thumbnail/{video_ref.bucket}/{video_ref.name}",
        params={
            "thumbnail_width": (
                128 if thumbnail_width is None else thumbnail_width
            )
        },
    )
    mock_response.content.readexactly.assert_has_awaits(
        [mock.call(512)] * mock_response.content.readexactly.await_count
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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "endpoint, thumbnail_width",
    [
        (transcoder_client.create_preview, None),
        (transcoder_client.create_streamable, None),
        (transcoder_client.create_thumbnail, None),
        (transcoder_client.create_thumbnail, 128),
        (transcoder_client.create_thumbnail, 256),
        (transcoder_client.create_thumbnail, 384),
    ],
    ids=[
        "create_preview",
        "create_streamable",
        "thumbnail_default",
        "thumbnail_128",
        "thumbnail_256",
        "thumbnail_384",
    ],
)
@pytest.mark.parametrize(
    "positional_args", [False, True], ids=["keyword", "positional"]
)
async def test_optimize_on_fail(
    config: ConfigForTests,
    faker: Faker,
    mock_response: ClientResponse,
    binary_content: bytes,
    endpoint: transcoder_client.TranscoderEndpoint[...],
    thumbnail_width: int | None,
    positional_args: bool,
) -> None:
    """
    Tests that optimization retries preserve endpoint options and chunk size.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        mock_response: The mocked response object.
        binary_content: The binary content of the response object.
        endpoint: The endpoint to exercise.
        thumbnail_width: The requested width, or None to use the default.
        positional_args: Whether to pass endpoint options positionally.

    """
    # Arrange.
    mock_post = config.mock_get_session.return_value.post
    video_ref = faker.object_ref()

    # Make it look like the transcoder service fails initially on the first
    # call to the endpoint.
    mock_post.return_value.__aenter__.return_value = mock_response
    mock_post.return_value.__aenter__.side_effect = (
        ClientPayloadError,
        mock.DEFAULT,
        mock.DEFAULT,
    )

    # Act.
    chunk_size = 512
    if positional_args:
        args = (chunk_size,)
        if thumbnail_width is not None:
            args += (thumbnail_width,)
        got_video = endpoint(video_ref, *args)
    else:
        options = {"chunk_size": chunk_size}
        if thumbnail_width is not None:
            options["thumbnail_width"] = thumbnail_width
        got_video = endpoint(video_ref, **options)

    # Assert.
    # It should have read the transcode results.
    got_video_data = b"".join([c async for c in got_video])
    assert got_video_data == binary_content

    assert config.mock_get_session.call_count == 3
    # In total, it should have made three calls to the transcoder.
    assert mock_post.call_count == 3

    # It should have tried to optimize the video.
    mock_post.assert_any_call(
        f"/ensure_faststart/{video_ref.bucket}/{video_ref.name}",
        timeout=mock.ANY,
    )
    mock_response.content.readexactly.assert_has_awaits(
        [mock.call(chunk_size)] * mock_response.content.readexactly.await_count
    )

    # Both thumbnail attempts must use the selected width, not just the retry.
    if endpoint is transcoder_client.create_thumbnail:
        thumbnail_call = mock.call(
            f"/create_thumbnail/{video_ref.bucket}/{video_ref.name}",
            params={
                "thumbnail_width": (
                    128 if thumbnail_width is None else thumbnail_width
                )
            },
        )
        assert mock_post.call_args_list[0] == thumbnail_call
        assert mock_post.call_args_list[2] == thumbnail_call
