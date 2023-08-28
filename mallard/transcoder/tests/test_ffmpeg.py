"""
Tests for the `ffmpeg` module.
"""


import io
from typing import AsyncIterable, Callable, Tuple

import pytest
from faker import Faker
from fastapi import UploadFile
from PIL import Image

from mallard.transcoder import ffmpeg

from .data import BIG_BUCK_BUNNY_PATH


@pytest.fixture()
def valid_video(faker: Faker) -> UploadFile:
    """
    Creates the video file to test with.

    Args:
        faker: The fixture to use for generating fake data.

    Yields:
        The file that it created.

    """
    filename = faker.file_name(category="video")
    with BIG_BUCK_BUNNY_PATH.open("rb") as raw_file:
        yield UploadFile(raw_file, filename=filename)


@pytest.fixture()
def invalid_video(faker: Faker) -> UploadFile:
    """
    Creates a "video file" to test with that does not contain
    valid video data.

    Args:
        faker: The fixture to use for generating fake data.

    Yields:
        The file that it created.

    """
    filename = faker.file_name(category="video")
    return UploadFile(
        io.BytesIO("This is not a video " "file.".encode("utf8")),
        filename=filename,
    )


@pytest.mark.asyncio
async def test_ffprobe(valid_video) -> None:
    """
    Tests that the `ffprobe` function can get valid metadata.

    Args:
        test_video: The video file to use for testing.

    """
    # Act.
    # Try probing the video.
    probe_results = await ffmpeg.ffprobe(valid_video)

    # Assert.
    assert "format" in probe_results
    assert "streams" in probe_results


@pytest.mark.asyncio
async def test_ffprobe_invalid_video(invalid_video: UploadFile) -> None:
    """
    Tests that the `ffprobe` function gracefully handles an invalid input.

    Args:
        invalid_video: The video file to use for testing.

    """
    # Act.
    # Try probing the video.
    with pytest.raises(OSError):
        await ffmpeg.ffprobe(invalid_video)


@pytest.mark.asyncio
async def test_create_preview(valid_video: UploadFile) -> None:
    """
    Tests that `create_preview` can produce a valid preview.

    Args:
        valid_video: The video file to use for testing.

    """
    # Arrange.
    preview_width = 128

    # Act.
    preview_stream, stderr_stream = await ffmpeg.create_preview(
        valid_video, preview_width=preview_width
    )

    # Assert.
    # Read all the data from the stream.
    preview = b"".join([c async for c in preview_stream])
    stderr = "".join([c.decode("utf8") async for c in stderr_stream])
    # Having stderr makes debugging A LOT easier.
    print(f"FFMpeg stderr: {stderr}")

    assert len(preview) > 0

    # The preview should be a valid video. To test this, we'll run it back
    # through ffprobe and see what it says.
    preview_file = UploadFile(io.BytesIO(), filename="preview.mp4")
    await preview_file.write(preview)
    await preview_file.seek(0)

    ffprobe_result = await ffmpeg.ffprobe(preview_file)

    video_stream = ffprobe_result["streams"][0]
    assert video_stream["codec_name"] == "vp9"
    assert video_stream["width"] == 128


@pytest.mark.asyncio
async def test_create_streamable(
    valid_video: UploadFile, faker: Faker
) -> None:
    """
    Tests that `create_streamable` can produce a valid streamable video.

    Args:
        valid_video: The video file to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    max_width = faker.random_int(min=128, max=3840)

    # Act.
    preview_stream, stderr_stream = await ffmpeg.create_streamable(
        valid_video, max_width=max_width
    )

    # Assert.
    # Read all the data from the stream.
    streamable = b"".join([c async for c in preview_stream])
    stderr = "".join([c.decode("utf8") async for c in stderr_stream])
    # Having stderr makes debugging A LOT easier.
    print(f"FFMpeg stderr: {stderr}")

    assert len(streamable) > 0

    # The preview should be a valid video. To test this, we'll run it back
    # through ffprobe and see what it says.
    streamable_file = UploadFile(io.BytesIO(), filename="streamable.mp4")
    await streamable_file.write(streamable)
    await streamable_file.seek(0)

    ffprobe_result = await ffmpeg.ffprobe(streamable_file)

    video_stream = ffprobe_result["streams"][0]
    assert video_stream["codec_name"] == "vp9"
    # The input width of the video is 480, so it shouldn't go any higher than
    # that.
    assert video_stream["width"] == min(max_width, 480)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "test_func",
    [ffmpeg.create_preview, ffmpeg.create_thumbnail, ffmpeg.create_streamable],
    ids=["create_preview", "create_thumbnail", "create_streamable"],
)
async def test_create_derived_invalid_video(
    invalid_video: UploadFile,
    test_func: Callable[[UploadFile], Tuple[AsyncIterable, AsyncIterable]],
) -> None:
    """
    Tests that the `create_preview`, `create_thumbnail`,
    and `create_streamable` functions gracefully handle an invalid input.

    Args:
        invalid_video: The video file to use for testing.
        test_func: The function under test

    """
    # Act.
    # Try probing the video.
    with pytest.raises(OSError):
        preview, stderr = await test_func(invalid_video)

        # Assert.
        # Reading the contents of the streams should eventually trigger an
        # error.
        async for _ in preview:
            pass
        async for _ in stderr:
            pass


@pytest.mark.asyncio
async def test_create_thumbnail(valid_video) -> None:
    """
    Tests that `create_thumbnail` can produce a valid thumbnail.

    Args:
        test_video: The video file to use for testing.

    """
    # Arrange.
    thumbnail_width = 128

    # Act.
    thumbnail_stream, stderr_stream = await ffmpeg.create_thumbnail(
        valid_video, thumbnail_width=thumbnail_width
    )

    # Assert.
    # Read all the data from the stream.
    thumbnail = b"".join([c async for c in thumbnail_stream])
    stderr = "".join([c.decode("utf8") async for c in stderr_stream])
    # Having stderr makes debugging A LOT easier.
    print(f"FFMpeg stderr: {stderr}")

    assert len(thumbnail) > 0

    # The thumbnail should be a valid image.
    image = Image.open(io.BytesIO(thumbnail))
    assert image.format == "JPEG"
    assert image.width == thumbnail_width
