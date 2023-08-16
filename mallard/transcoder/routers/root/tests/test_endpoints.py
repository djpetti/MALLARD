"""
Tests for the `endpoints` module.
"""


import io
from typing import AsyncIterable
from unittest.mock import ANY, Mock

import pytest
from aioitertools import tee
from faker import Faker
from fastapi import HTTPException, UploadFile
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.transcoder.routers.root import endpoints

from .....type_helpers import ArbitraryTypesConfig


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class ConfigForTests:
    """
    Encapsulates standard configuration for most tests.

    Attributes:
        mock_ffprobe: The mocked `ffprobe` function.
        mock_create_preview: The mocked `create_preview` function.
        mock_create_thumbnail: The mocked `create_thumbnail` function.
        mock_streaming_response_class: The mocked `StreamingResponse` class.

    """

    mock_ffprobe: Mock
    mock_create_preview: Mock
    mock_create_thumbnail: Mock
    mock_streaming_response_class: Mock


@pytest.fixture()
def config(mocker: MockFixture) -> ConfigForTests:
    """
    Provides a standard configuration for most tests.

    Returns:
        The standard configuration.

    """
    return ConfigForTests(
        mock_ffprobe=mocker.patch(endpoints.__name__ + ".ffprobe"),
        mock_create_preview=mocker.patch(
            endpoints.__name__ + ".create_preview"
        ),
        mock_create_thumbnail=mocker.patch(
            endpoints.__name__ + ".create_thumbnail"
        ),
        mock_streaming_response_class=mocker.patch(
            endpoints.__name__ + ".StreamingResponse"
        ),
    )


@pytest.fixture()
def fake_video(faker: Faker) -> UploadFile:
    """
    Provides a fake video file for testing.

    Returns:
        The fake video file.

    """
    return UploadFile(
        filename=faker.file_name(category="video"),
        file=io.BytesIO(faker.binary(length=1024)),
    )


@pytest.fixture
async def bytes_iter(faker: Faker) -> AsyncIterable[bytes]:
    """
    Provides an async iterable of fake bytes for testing.

    Args:
        faker: The fixture to use for generating fake data.

    Yields:
        Random binary chunks.

    """
    num_chunks = faker.random_int(min=1, max=10)

    async def _iter():
        for _ in range(num_chunks):
            yield faker.binary(length=1024)

    # Have to wrap this in an internal function to keep pytest from treating
    # it as a test with teardown actions.
    return _iter()


@pytest.fixture
async def fail_iter() -> AsyncIterable[bytes]:
    """
    Provides an async iterable that eventually raises an OSError.

    Yields:
        Random binary chunks.

    """

    async def _iter():
        yield b""
        raise OSError

    # Have to wrap this in an internal function to keep pytest from treating
    # it as a test with teardown actions.
    return _iter()


@pytest.fixture
async def empty_iter() -> AsyncIterable[bytes]:
    """
    Provides an async iterable that yields a single empty bytes object.

    Yields:
        The empty byte object.

    """

    async def _iter():
        yield b""

    # Have to wrap this in an internal function to keep pytest from treating
    # it as a test with teardown actions.
    return _iter()


@pytest.mark.asyncio
async def test_infer_video_metadata(
    config: ConfigForTests, fake_video: UploadFile, faker: Faker
) -> None:
    """
    Tests that `infer_video_metadata` returns the expected result.

    Args:
        config: The configuration to use for testing.
        fake_video: The fake video to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Create some fake metadata for it to infer.
    fake_metadata = {
        "streams": [
            {
                "width": faker.random_int(),
                "height": faker.random_int(),
                "duration": faker.pyfloat(),
            }
        ]
    }
    config.mock_ffprobe.return_value = fake_metadata

    # Act.
    result = await endpoints.infer_video_metadata(fake_video)

    # Assert.
    # It should have called `ffprobe` with the video.
    config.mock_ffprobe.assert_called_once_with(fake_video)

    assert result == fake_metadata


@pytest.mark.asyncio
async def test_infer_video_metadata_invalid(
    config: ConfigForTests, fake_video: UploadFile
) -> None:
    """
    Tests that `infer_video_metadata` raises an error when the video is invalid.

    Args:
        config: The configuration to use for testing.
        fake_video: The fake video to use for testing.

    """
    # Arrange.
    config.mock_ffprobe.side_effect = OSError

    # Act.
    with pytest.raises(HTTPException) as exc_info:
        await endpoints.infer_video_metadata(fake_video)

        assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_create_video_preview(
    config: ConfigForTests,
    fake_video: UploadFile,
    faker: Faker,
    bytes_iter: AsyncIterable[bytes],
    empty_iter: AsyncIterable[bytes],
) -> None:
    """
    Tests that `create_video_preview` returns the expected result.

    Args:
        config: The configuration to use for testing.
        fake_video: The fake video to use for testing.
        faker: The fixture to use for generating fake data.
        bytes_iter: Iterable generating random bytes.
        empty_iter: Iterable returning an empty bytes object.

    """
    # Arrange.
    # Create some fake video data to pass off as the response.
    bytes_iter, reference_bytes = tee(bytes_iter)
    config.mock_create_preview.return_value = (bytes_iter, empty_iter)

    preview_width = faker.random_int()

    # Act.
    result = await endpoints.create_video_preview(
        fake_video, preview_width=preview_width
    )

    # Assert.
    # It should have called `create_preview` with the video.
    config.mock_create_preview.assert_called_once_with(
        fake_video, preview_width=preview_width
    )

    # It should have created the response.
    config.mock_streaming_response_class.assert_called_once_with(
        ANY, media_type="video/vp9"
    )
    # It should have sent the preview data.
    preview_data_iter = config.mock_streaming_response_class.call_args.args[0]
    preview_data = [c async for c in preview_data_iter]
    reference_data = [c async for c in reference_bytes]
    assert preview_data == reference_data

    assert result == config.mock_streaming_response_class.return_value


@pytest.mark.asyncio
async def test_create_video_preview_invalid(
    config: ConfigForTests,
    fake_video: UploadFile,
    empty_iter: AsyncIterable[bytes],
    fail_iter: AsyncIterable[bytes],
) -> None:
    """
    Tests that `infer_video_metadata` raises an error when the video is invalid.

    Args:
        config: The configuration to use for testing.
        fake_video: The fake video to use for testing.
        empty_iter: Iterable returning an empty bytes object.
        fail_iter: Iterable that eventually raises an OSError.

    """
    # Arrange.
    config.mock_create_preview.return_value = fail_iter, empty_iter

    # Act.
    await endpoints.create_video_preview(fake_video)

    # Assert.
    with pytest.raises(HTTPException) as exc_info:
        # Force it to actually read the response data.
        data_stream = config.mock_streaming_response_class.call_args[0][0]
        async for _ in data_stream:
            pass

        assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_create_video_thumbnail(
    config: ConfigForTests,
    fake_video: UploadFile,
    faker: Faker,
    bytes_iter: AsyncIterable[bytes],
    empty_iter: AsyncIterable[bytes],
) -> None:
    """
    Tests that `create_video_thumbnail` returns the expected result.

    Args:
        config: The configuration to use for testing.
        fake_video: The fake video to use for testing.
        faker: The fixture to use for generating fake data.
        bytes_iter: Iterable generating random bytes.
        empty_iter: Iterable returning an empty bytes object.

    """
    # Arrange.
    # Create some fake video data to pass off as the response.
    bytes_iter, reference_bytes = tee(bytes_iter)
    config.mock_create_thumbnail.return_value = (bytes_iter, empty_iter)

    thumbnail_width = faker.random_int()

    # Act.
    result = await endpoints.create_video_thumbnail(
        fake_video, thumbnail_width=thumbnail_width
    )

    # Assert.
    # It should have called `create_thumbnail` with the video.
    config.mock_create_thumbnail.assert_called_once_with(
        fake_video, thumbnail_width=thumbnail_width
    )

    # It should have created the response.
    config.mock_streaming_response_class.assert_called_once_with(
        ANY, media_type="image/jpeg"
    )
    # It should have sent the thumbnail data.
    thumbnail_data_iter = config.mock_streaming_response_class.call_args.args[
        0
    ]
    thumbnail_data = [c async for c in thumbnail_data_iter]
    reference_data = [c async for c in reference_bytes]
    assert thumbnail_data == reference_data

    assert result == config.mock_streaming_response_class.return_value


@pytest.mark.asyncio
async def test_create_video_thumbnail_invalid(
    config: ConfigForTests,
    fake_video: UploadFile,
    empty_iter: AsyncIterable[bytes],
    fail_iter: AsyncIterable[bytes],
) -> None:
    """
    Tests that `infer_video_metadata` raises an error when the video is invalid.

    Args:
        config: The configuration to use for testing.
        fake_video: The fake video to use for testing.
        empty_iter: Iterable returning an empty bytes object.
        fail_iter: Iterable that eventually raises an OSError.

    """
    # Arrange.
    config.mock_create_thumbnail.return_value = fail_iter, empty_iter

    # Act.
    await endpoints.create_video_thumbnail(fake_video)

    # Assert.
    with pytest.raises(HTTPException) as exc_info:
        # Force it to actually read the response data.
        data_stream = config.mock_streaming_response_class.call_args[0][0]
        async for _ in data_stream:
            pass

        assert exc_info.value.status_code == 422
