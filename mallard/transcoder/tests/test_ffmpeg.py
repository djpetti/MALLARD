"""
Tests for the `ffmpeg` module.
"""


import asyncio
import enum
import io
from typing import AsyncIterable, Awaitable, Callable, Tuple

import pytest
from aioitertools import tee
from faker import Faker
from PIL import Image
from pytest_mock import MockerFixture

from mallard.transcoder import ffmpeg

from .data import BIG_BUCK_BUNNY_PATH, NON_STREAMABLE_PATH


@pytest.fixture()
def valid_video() -> AsyncIterable[bytes]:
    """
    Creates the video file to test with.

    Yields:
        The bytes from the file, in chunks.

    """

    async def _read_file_chunks(file_: io.IOBase) -> AsyncIterable[bytes]:
        while chunk := file_.read(100 * 1024):
            yield chunk

    with BIG_BUCK_BUNNY_PATH.open("rb") as raw_file:
        yield _read_file_chunks(raw_file)


@pytest.fixture()
def non_streamable_video() -> AsyncIterable[bytes]:
    """
    Creates a non-streamable video file to test with.

    Yields:
        The bytes from the file, in chunks.

    """

    async def _read_file_chunks(file_: io.IOBase) -> AsyncIterable[bytes]:
        while chunk := file_.read(100 * 1024):
            yield chunk

    with NON_STREAMABLE_PATH.open("rb") as raw_file:
        yield _read_file_chunks(raw_file)


@pytest.fixture()
def invalid_video() -> AsyncIterable[bytes]:
    """
    Creates a "video file" to test with that does not contain
    valid video data.

    Yields:
        The file that it created.

    """

    async def _read_file_chunks() -> AsyncIterable[bytes]:
        yield "This is not a video file.".encode("utf8")

    yield _read_file_chunks()


@pytest.fixture()
def truncated_video() -> AsyncIterable[bytes]:
    """
    Creates the video file to test with that raises an error halfway through
    reading.

    Yields:
        The bytes from the file, in chunks.

    """

    async def _read_file_chunks(file_: io.IOBase) -> AsyncIterable[bytes]:
        yield file_.read(100 * 1024)
        raise RuntimeError("This video is truncated.")

    with BIG_BUCK_BUNNY_PATH.open("rb") as raw_file:
        yield _read_file_chunks(raw_file)


@pytest.fixture(autouse=True)
def replace_concurrency_limited_runner(mocker: MockerFixture) -> None:
    """
    Replaces the `ConcurrencyLimitedRunner` class with a pass-through.

    """
    mock_runner = mocker.patch.object(ffmpeg, "_g_runner")

    # Replace the `run()` method with a pass-through.
    mock_runner.run.side_effect = asyncio.create_subprocess_exec


class VideoType(enum.Enum):
    STREAMABLE = "streamable"
    NON_STREAMABLE = "non-streamable"


@pytest.mark.parametrize(
    "choose_video",
    [VideoType.STREAMABLE, VideoType.NON_STREAMABLE],
    ids=["streamable", "non-streamable"],
)
@pytest.mark.asyncio
async def test_ensure_streamable(
    non_streamable_video: AsyncIterable[bytes],
    valid_video: AsyncIterable[bytes],
    choose_video: VideoType,
) -> None:
    """
    Tests that the `ensure_streamable` function can fix a video that is not
    streamable.

    Args:
        non_streamable_video: The video file to use for testing.

    """
    # Arrange.
    # Select the video to test with.
    video_iter = non_streamable_video
    if choose_video == VideoType.STREAMABLE:
        video_iter = valid_video

    # Get the raw video data to compare it with.
    video_iter1, video_iter2 = tee(video_iter)
    video_data = b"".join([c async for c in video_iter1])

    # Act.
    # Try streaming the video.
    output_stream, error_stream = await ffmpeg.ensure_streamable(video_iter2)

    # Assert.
    # The error stream should have FFMpeg output.
    stderr = b"".join([c async for c in error_stream])
    assert len(stderr) > 0

    # The output should have been changed.
    stdout = b"".join([c async for c in output_stream])
    assert stdout != video_data


@pytest.mark.asyncio
async def test_ffprobe(valid_video: AsyncIterable[bytes]) -> None:
    """
    Tests that the `ffprobe` function can get valid metadata.

    Args:
        valid_video: The video file to use for testing.

    """
    # Act.
    # Try probing the video.
    probe_results = await ffmpeg.ffprobe(valid_video)

    # Assert.
    assert "format" in probe_results
    assert "streams" in probe_results


@pytest.mark.asyncio
async def test_ffprobe_stress(valid_video: AsyncIterable[bytes]) -> None:
    """
    Tests that the `ffprobe` function works when run many times concurrently.

    Args:
        valid_video: The video file to use for testing.

    """
    # Arrange.
    valid_videos = tee(valid_video, 50)

    # Act.
    tasks = []
    for video in valid_videos:
        # Try probing the video.
        probe_task = asyncio.create_task(ffmpeg.ffprobe(video))
        tasks.append(probe_task)

    # Assert
    await asyncio.gather(*tasks)


@pytest.mark.asyncio
async def test_ffprobe_invalid_video(
    invalid_video: AsyncIterable[bytes],
) -> None:
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
async def test_create_preview(valid_video: AsyncIterable[bytes]) -> None:
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
    async def _preview_async() -> AsyncIterable[bytes]:
        yield preview

    ffprobe_result = await ffmpeg.ffprobe(_preview_async())

    video_stream = ffprobe_result["streams"][0]
    assert video_stream["codec_name"] == "vp9"
    assert video_stream["width"] == 128


@pytest.mark.asyncio
async def test_create_streamable(
    valid_video: AsyncIterable[bytes], faker: Faker
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
    stderr = "".join([c.decode("utf8") async for c in stderr_stream])
    # Having stderr makes debugging A LOT easier.
    print(f"FFMpeg stderr: {stderr}")
    streamable = b"".join([c async for c in preview_stream])

    assert len(streamable) > 0

    # The stream should be a valid video. To test this, we'll run it back
    # through ffprobe and see what it says.
    async def _streamable_async() -> AsyncIterable[bytes]:
        yield streamable

    ffprobe_result = await ffmpeg.ffprobe(_streamable_async())

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
    invalid_video: AsyncIterable[bytes],
    test_func: Callable[
        [AsyncIterable[bytes]],
        Awaitable[Tuple[AsyncIterable[bytes], AsyncIterable[bytes]]],
    ],
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
@pytest.mark.parametrize(
    "test_func",
    [ffmpeg.create_preview, ffmpeg.create_streamable],
    ids=["create_preview", "create_streamable"],
)
async def test_create_derived_truncated_video(
    truncated_video: AsyncIterable[bytes],
    test_func: Callable[
        [AsyncIterable[bytes]],
        Awaitable[Tuple[AsyncIterable[bytes], AsyncIterable[bytes]]],
    ],
) -> None:
    """
    Tests that the `create_preview` and `create_streamable` functions
    gracefully handle a truncated input.

    Args:
        truncated_video: The video file to use for testing.
        test_func: The function under test

    """
    # Act.
    # Try probing the video.
    with pytest.raises(OSError):
        preview, stderr = await test_func(truncated_video)

        # Assert.
        # Reading the contents of the streams should eventually trigger an
        # error.
        async for _ in preview:
            pass
        async for _ in stderr:
            pass


@pytest.mark.asyncio
async def test_create_thumbnail(valid_video: AsyncIterable[bytes]) -> None:
    """
    Tests that `create_thumbnail` can produce a valid thumbnail.

    Args:
        valid_video: The video file to use for testing.

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
