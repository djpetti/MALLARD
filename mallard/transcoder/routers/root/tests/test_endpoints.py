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

from mallard.gateway.backends.objects import ObjectStore
from mallard.transcoder.routers.root import endpoints

from .....type_helpers import ArbitraryTypesConfig


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class ConfigForTests:
    """
    Encapsulates standard configuration for most tests.

    Attributes:
        mock_ensure_streamable: The mocked `ensure_streamable` function.
        mock_ffprobe: The mocked `ffprobe` function.
        mock_create_preview: The mocked `create_preview` function.
        mock_create_thumbnail: The mocked `create_thumbnail` function.
        mock_create_streamable: The mocked `create_streamable` function.
        mock_read_file_chunks: The mocked `read_file_chunks` function.
        mock_streaming_response_class: The mocked `StreamingResponse` class.

        mock_object_store: The mocked `ObjectStore` instance.

    """

    mock_ensure_streamable: Mock
    mock_ffprobe: Mock
    mock_create_preview: Mock
    mock_create_thumbnail: Mock
    mock_create_streamable: Mock
    mock_read_file_chunks: Mock
    mock_streaming_response_class: Mock

    mock_object_store: ObjectStore


@pytest.fixture()
def config(mocker: MockFixture) -> ConfigForTests:
    """
    Provides a standard configuration for most tests.

    Returns:
        The standard configuration.

    """
    return ConfigForTests(
        mock_ensure_streamable=mocker.patch(
            endpoints.__name__ + ".ensure_streamable"
        ),
        mock_ffprobe=mocker.patch(endpoints.__name__ + ".ffprobe"),
        mock_create_preview=mocker.patch(
            endpoints.__name__ + ".create_preview"
        ),
        mock_create_thumbnail=mocker.patch(
            endpoints.__name__ + ".create_thumbnail"
        ),
        mock_create_streamable=mocker.patch(
            endpoints.__name__ + ".create_streamable"
        ),
        mock_read_file_chunks=mocker.patch(
            endpoints.__name__ + ".read_file_chunks"
        ),
        mock_streaming_response_class=mocker.patch(
            endpoints.__name__ + ".StreamingResponse"
        ),
        mock_object_store=mocker.create_autospec(ObjectStore, instance=True),
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
    # It should have read the file data.
    config.mock_read_file_chunks.assert_called_once_with(fake_video)
    # It should have called `ffprobe` with the video.
    config.mock_ffprobe.assert_called_once_with(
        config.mock_read_file_chunks.return_value
    )

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
async def test_infer_existing_video_metadata(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that `infer_existing_video_metadata` returns the expected result.

    Args:
        config: The configuration to use for testing.
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

    fake_video = faker.object_ref()

    # Act.
    result = await endpoints.infer_existing_video_metadata(
        fake_video.bucket,
        fake_video.name,
        object_store=config.mock_object_store,
    )

    # Assert.
    # It should have read the file data.
    config.mock_object_store.get_object.assert_called_once_with(fake_video)
    # It should have called `ffprobe` with the video.
    config.mock_ffprobe.assert_called_once_with(
        config.mock_object_store.get_object.return_value
    )

    assert result == fake_metadata


@pytest.mark.asyncio
async def test_infer_existing_video_metadata_invalid(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that `infer_existing_video_metadata` raises an error when the video is invalid.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    config.mock_ffprobe.side_effect = OSError

    fake_video = faker.object_ref()

    # Act.
    with pytest.raises(HTTPException) as exc_info:
        await endpoints.infer_existing_video_metadata(
            fake_video.bucket,
            fake_video.name,
            object_store=config.mock_object_store,
        )

        assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_ensure_faststart(
    config: ConfigForTests,
    faker: Faker,
    bytes_iter: AsyncIterable,
    empty_iter: AsyncIterable,
) -> None:
    """
    Tests that `ensure_faststart` returns the expected result.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        bytes_iter: Iterable generating random bytes.
        empty_iter: Iterable returning an empty bytes object.

    """
    # Arrange.
    # Create some fake video data to pass off as the streamable video.
    config.mock_ensure_streamable.return_value = (bytes_iter, empty_iter)

    fake_video = faker.object_ref()

    # Act.
    await endpoints.ensure_faststart(
        fake_video.bucket,
        fake_video.name,
        object_store=config.mock_object_store,
    )

    # Assert.
    # It should have read the video from the object store.
    config.mock_object_store.get_object.assert_called_once_with(fake_video)
    video_data = config.mock_object_store.get_object.return_value

    # It should have called `ensure_streamable` with the video.
    config.mock_ensure_streamable.assert_called_once_with(video_data)

    # It should have written it back to the object store.
    config.mock_object_store.delete_object.assert_called_once_with(fake_video)
    config.mock_object_store.create_object.assert_called_once_with(
        fake_video, data=config.mock_ensure_streamable.return_value[0]
    )


@pytest.mark.asyncio
async def test_create_video_preview(
    config: ConfigForTests,
    faker: Faker,
    bytes_iter: AsyncIterable[bytes],
    empty_iter: AsyncIterable[bytes],
) -> None:
    """
    Tests that `create_video_preview` returns the expected result.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        bytes_iter: Iterable generating random bytes.
        empty_iter: Iterable returning an empty bytes object.

    """
    # Arrange.
    # Create some fake video data to pass off as the response.
    bytes_iter, reference_bytes = tee(bytes_iter)
    config.mock_create_preview.return_value = (bytes_iter, empty_iter)

    preview_width = faker.random_int()
    fake_video = faker.object_ref()

    # Act.
    result = await endpoints.create_video_preview(
        fake_video.bucket,
        fake_video.name,
        preview_width=preview_width,
        object_store=config.mock_object_store,
    )

    # Assert.
    # It should have read the video from the object store.
    config.mock_object_store.get_object.assert_called_once_with(fake_video)
    video_data = config.mock_object_store.get_object.return_value

    # It should have called `create_preview` with the video.
    config.mock_create_preview.assert_called_once_with(
        video_data, preview_width=preview_width
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
    empty_iter: AsyncIterable[bytes],
    fail_iter: AsyncIterable[bytes],
    faker: Faker,
) -> None:
    """
    Tests that `create_video_preview` raises an error when the video is invalid.

    Args:
        config: The configuration to use for testing.
        empty_iter: Iterable returning an empty bytes object.
        fail_iter: Iterable that eventually raises an OSError.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    config.mock_create_preview.return_value = fail_iter, empty_iter
    fake_video = faker.object_ref()

    # Act.
    await endpoints.create_video_preview(
        fake_video.bucket,
        fake_video.name,
        object_store=config.mock_object_store,
    )

    # Assert.
    with pytest.raises(HTTPException) as exc_info:
        # Force it to actually read the response data.
        data_stream = config.mock_streaming_response_class.call_args[0][0]
        async for _ in data_stream:
            pass

        assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_create_streaming_video(
    config: ConfigForTests,
    faker: Faker,
    bytes_iter: AsyncIterable[bytes],
    empty_iter: AsyncIterable[bytes],
) -> None:
    """
    Tests that `create_streaming_video returns the expected result.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        bytes_iter: Iterable generating random bytes.
        empty_iter: Iterable returning an empty bytes object.

    """
    # Arrange.
    # Create some fake video data to pass off as the response.
    bytes_iter, reference_bytes = tee(bytes_iter)
    config.mock_create_streamable.return_value = (bytes_iter, empty_iter)

    max_width = faker.random_int()
    fake_video = faker.object_ref()

    # Act.
    result = await endpoints.create_streaming_video(
        fake_video.bucket,
        fake_video.name,
        max_width=max_width,
        object_store=config.mock_object_store,
    )

    # Assert.
    # It should have read the video from the object store.
    config.mock_object_store.get_object.assert_called_once_with(fake_video)
    video_data = config.mock_object_store.get_object.return_value

    # It should have called `create_streamable` with the video.
    config.mock_create_streamable.assert_called_once_with(
        video_data, max_width=max_width
    )

    # It should have created the response.
    config.mock_streaming_response_class.assert_called_once_with(
        ANY, media_type="video/vp9"
    )
    # It should have sent the video data.
    stream_data_iter = config.mock_streaming_response_class.call_args.args[0]
    video_data = [c async for c in stream_data_iter]
    reference_data = [c async for c in reference_bytes]
    assert video_data == reference_data

    assert result == config.mock_streaming_response_class.return_value


@pytest.mark.asyncio
async def test_create_streaming_video_invalid(
    config: ConfigForTests,
    empty_iter: AsyncIterable[bytes],
    fail_iter: AsyncIterable[bytes],
    faker: Faker,
) -> None:
    """
    Tests that `create_streaming_video` raises an error when the video is
    invalid.

    Args:
        config: The configuration to use for testing.
        empty_iter: Iterable returning an empty bytes object.
        fail_iter: Iterable that eventually raises an OSError.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    config.mock_create_streamable.return_value = fail_iter, empty_iter
    fake_video = faker.object_ref()

    # Act.
    await endpoints.create_streaming_video(
        fake_video.bucket,
        fake_video.name,
        object_store=config.mock_object_store,
    )

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
    faker: Faker,
    bytes_iter: AsyncIterable[bytes],
    empty_iter: AsyncIterable[bytes],
) -> None:
    """
    Tests that `create_video_thumbnail` returns the expected result.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        bytes_iter: Iterable generating random bytes.
        empty_iter: Iterable returning an empty bytes object.

    """
    # Arrange.
    # Create some fake video data to pass off as the response.
    bytes_iter, reference_bytes = tee(bytes_iter)
    config.mock_create_thumbnail.return_value = (bytes_iter, empty_iter)

    thumbnail_width = faker.random_int()
    fake_video = faker.object_ref()

    # Act.
    result = await endpoints.create_video_thumbnail(
        fake_video.bucket,
        fake_video.name,
        thumbnail_width=thumbnail_width,
        object_store=config.mock_object_store,
    )

    # Assert.
    # It should have read the video from the object store.
    config.mock_object_store.get_object.assert_called_once_with(fake_video)
    video_data = config.mock_object_store.get_object.return_value

    # It should have called `create_thumbnail` with the video.
    config.mock_create_thumbnail.assert_called_once_with(
        video_data, thumbnail_width=thumbnail_width
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
    faker: Faker,
    empty_iter: AsyncIterable[bytes],
    fail_iter: AsyncIterable[bytes],
) -> None:
    """
    Tests that `infer_video_metadata` raises an error when the video is invalid.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        empty_iter: Iterable returning an empty bytes object.
        fail_iter: Iterable that eventually raises an OSError.

    """
    # Arrange.
    config.mock_create_thumbnail.return_value = fail_iter, empty_iter
    fake_video = faker.object_ref()

    # Act.
    await endpoints.create_video_thumbnail(
        fake_video.bucket,
        fake_video.name,
        object_store=config.mock_object_store,
    )

    # Assert.
    with pytest.raises(HTTPException) as exc_info:
        # Force it to actually read the response data.
        data_stream = config.mock_streaming_response_class.call_args[0][0]
        async for _ in data_stream:
            pass

        assert exc_info.value.status_code == 422
