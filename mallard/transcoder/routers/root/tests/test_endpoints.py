"""
Tests for the `endpoints` module.
"""


import io
from unittest.mock import Mock

import pytest
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
        mock_streaming_response=mocker.patch(
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
    config: ConfigForTests, fake_video: UploadFile, faker: Faker
) -> None:
    """
    Tests that `create_video_preview` returns the expected result.

    Args:
        config: The configuration to use for testing.
        fake_video: The fake video to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Create some fake video data to pass off as the response.
    fake_preview_data = faker.binary(length=1024)
    fake_stderr = faker.paragraph()
    config.mock_create_preview.return_value = (fake_preview_data, fake_stderr)

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
        fake_preview_data, media_type="video/mp4"
    )
    assert result == config.mock_streaming_response_class.return_value


@pytest.mark.asyncio
async def test_create_video_preview_invalid(
    config: ConfigForTests, fake_video: UploadFile
) -> None:
    """
    Tests that `infer_video_metadata` raises an error when the video is invalid.

    Args:
        config: The configuration to use for testing.
        fake_video: The fake video to use for testing.

    """
    # Arrange.
    config.mock_create_preview.side_effect = OSError

    # Act.
    with pytest.raises(HTTPException) as exc_info:
        await endpoints.create_video_preview(fake_video)

        assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_create_video_thumbnail(
    config: ConfigForTests, fake_video: UploadFile, faker: Faker
) -> None:
    """
    Tests that `create_video_thumbnail` returns the expected result.

    Args:
        config: The configuration to use for testing.
        fake_video: The fake video to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Create some fake video data to pass off as the response.
    fake_thumbnail_data = faker.binary(length=1024)
    fake_stderr = faker.paragraph()
    config.mock_create_thumbnail.return_value = (
        fake_thumbnail_data,
        fake_stderr,
    )

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
        fake_thumbnail_data, media_type="image/jpeg"
    )
    assert result == config.mock_streaming_response_class.return_value


@pytest.mark.asyncio
async def test_create_video_thumbnail_invalid(
    config: ConfigForTests, fake_video: UploadFile
) -> None:
    """
    Tests that `infer_video_metadata` raises an error when the video is invalid.

    Args:
        config: The configuration to use for testing.
        fake_video: The fake video to use for testing.

    """
    # Arrange.
    config.mock_create_thumbnail.side_effect = OSError

    # Act.
    with pytest.raises(HTTPException) as exc_info:
        await endpoints.create_video_thumbnail(fake_video)

        assert exc_info.value.status_code == 422
