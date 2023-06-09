"""
Tests for the `ffmpeg` module.
"""


import pytest
from faker import Faker
from fastapi import UploadFile

from mallard.transcoder import ffmpeg

from .data import BIG_BUCK_BUNNY_PATH


@pytest.fixture()
def test_video(faker: Faker) -> UploadFile:
    """
    Creates the video file to test with.

    Args:
        faker: The fixture to use for generating fake data.

    Yields:
        The file that it created.

    """
    filename = faker.file_name(category="video")
    with BIG_BUCK_BUNNY_PATH.open("rb") as raw_file:
        yield UploadFile(filename, raw_file)


@pytest.mark.asyncio
async def test_ffprobe(test_video: UploadFile) -> None:
    """
    Tests that the `ffprobe` function can get valid metadata.

    Args:
        test_video: The video file to use for testing.

    """
    # Act.
    # Try probing the video.
    probe_results = await ffmpeg.ffprobe(test_video)

    # Assert.
    assert "format" in probe_results
    assert "streams" in probe_results


@pytest.mark.asyncio
async def test_create_preview(test_video: UploadFile) -> None:
    """
    Tests that `create_preview` can produce a valid preview.

    Args:
        test_video: The video file to use for testing.

    """
    # Arrange.
    preview_width = 128

    # Act.
    preview_stream, stderr_stream = await ffmpeg.create_preview(
        test_video, preview_width=preview_width
    )

    # Assert.
    # Read all the data from the stream.
    preview = b"".join([c async for c in preview_stream])
    stderr = "".join([c.decode("utf8") async for c in stderr_stream])

    assert len(preview) > 0
    # Having stderr makes debugging A LOT easier.
    print(f"FFMpeg stderr: {stderr}")

    # The preview should be a valid video. To test this, we'll run it back
    # through ffprobe and see what it says.
    preview_file = UploadFile("preview.mp4")
    await preview_file.write(preview)
    await preview_file.seek(0)

    ffprobe_result = await ffmpeg.ffprobe(preview_file)

    video_stream = ffprobe_result["streams"][0]
    assert video_stream["codec_name"] == "h264"
    assert video_stream["width"] == 128
