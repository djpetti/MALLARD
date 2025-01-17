"""
Wrapper around FFMpeg functionality.

In case you're wondering why we can't use `python-ffmpeg` or similar, it's
because we have to be able to process data from memory instead of writing
to the disk.
"""

import asyncio
import json
import tempfile
from pathlib import Path
from typing import Any, AsyncIterable, Coroutine, Dict, Tuple

from loguru import logger

from ..cli_utils import find_exe
from ..config import config
from .concurrency_limited_runner import ConcurrencyLimitedRunner

FFPROBE_ARGS = [
    "-hide_banner",
    "-show_format",
    "-show_streams",
    "-print_format",
    "json",
    "-i",
    "pipe:",
]
"""
Arguments to use for ffprobe.
"""

_INPUT_CHUNK_SIZE = 10 * 2**20
"""
Size of the chunks to use when feeding input to subprocesses.
"""
_MAX_QUEUE_SIZE = 2**20
"""
Maximum size of the queue to use when reading output data.
"""
_FILE_CHUNK_SIZE = 10 * 2**20
"""
Size of chunks to read when reading from a file.
"""

_DEFAULT_PIPES = dict(
    stdin=asyncio.subprocess.PIPE,
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
)
"""
Default configuration for stdin, stdout, and stderr for subprocesses.
"""

_g_runner = ConcurrencyLimitedRunner(
    max_processes=config["transcoder"]["max_num_processes"].as_number()
)
"""
Runner that limits the number of concurrent processes.
"""


async def _read_from_queue_until_finished(
    queue: asyncio.Queue,
    process_wait_task: asyncio.Task,
    ignore_errors: bool = False,
) -> AsyncIterable[bytes]:
    """
    Reads output from a subprocess on a queue until the subprocess exits.

    Args:
        queue: The queue to read data from.
        process_wait_task: The task that completes once the process is finished.
        ignore_errors: If tru, it will not raise an exception if the process
            exits with a non-zero code.

    Returns:

    """
    # Iterates the messages it reads from the queue.
    while True:
        chunk = await queue.get()
        if len(chunk) > 0:
            yield chunk
        else:
            # Empty chunk indicates that we have no more data.
            break

    await process_wait_task
    if not ignore_errors and process_wait_task.result() != 0:
        # If the process exited with an error, we should raise an
        # exception.
        raise OSError(
            f"Process exited with error code {process_wait_task.result()}."
        )


async def _process_io(
    process: asyncio.subprocess.Process,
    *,
    io: Coroutine,
    ignore_exit: bool = False,
) -> Any:
    """
    Performs I/O on the streams from a process. At the same time, it checks
    if the process has exited, and cancels the I/O operation automatically if
    does.

    Args:
        process: The process to check.
        io: The coroutine that performs the I/O.
        ignore_exit: If False, it will raise a `BrokenPipeError` if the process
            exits during the operation.

    Returns:

    """
    wait_task = asyncio.create_task(process.wait())
    io_task = asyncio.create_task(io)

    done, pending = await asyncio.wait(
        [wait_task, io_task], return_when=asyncio.FIRST_COMPLETED
    )
    for task in pending:
        # Cancel whatever didn't finish.
        task.cancel()

    if io_task in done:
        return io_task.result()
    if not ignore_exit:  # pragma: no coverage
        # If the process exited, we should raise an exception.
        raise BrokenPipeError("Process has exited already.")


async def _streaming_communicate(
    process: asyncio.subprocess.Process,
    *,
    input_source: AsyncIterable[bytes] | None,
) -> Tuple[AsyncIterable[bytes], AsyncIterable[bytes]]:
    """
    This function is sort of similar to `Process.communicate()`, but it
    asynchronously streams data to and from the process being run. This is
    really useful for FFmpeg operations, which often read and write huge
    amounts of data from stdin and to stdout.

    Args:
        process: The process to run.
        input_source: The source to get input from. If this is None, it will
            not feed any input to the process.

    Returns:
        Iterables that can be used to read the stdout and stderr from the
        process.

    """
    stdout_queue = asyncio.Queue(maxsize=_MAX_QUEUE_SIZE)
    stderr_queue = asyncio.Queue(maxsize=_MAX_QUEUE_SIZE)

    # Keeps track of tasks that are currently running.
    running_tasks = set()

    # Coverage is disabled on some of these functions because their behavior
    # is dependent on race conditions that are difficult to replicate reliably.
    def _finalize_background_task(
        task: asyncio.Task,
    ) -> None:  # pragma: no coverage
        if task.exception() and not isinstance(
            # This usually happens because the process exited before we
            # finished writing the input, and can be ignored.
            task.exception(),
            BrokenPipeError,
        ):
            # Kill the process so it doesn't hang.
            process.terminate()
            # Report exceptions if we have them.
            logger.opt(exception=task.exception()).error(
                "Task {} failed:", task.get_name()
            )
            raise task.exception()
        running_tasks.discard(task)

    def _submit_background_task(to_run: Coroutine) -> None:
        # This is necessary to stop tasks from getting garbage collected
        # before they're done.
        next_task = asyncio.create_task(to_run, name=to_run.__name__)
        running_tasks.add(next_task)
        # Remove it once it finishes.
        next_task.add_done_callback(_finalize_background_task)

    async def _feed_input() -> None:
        # Feed data from the source to the process stdin.
        async for chunk in input_source:
            process.stdin.write(chunk)
            try:
                await _process_io(process, io=process.stdin.drain())
            except (
                BrokenPipeError,
                ConnectionResetError,
            ):  # pragma: no coverage
                # The process probably exited, so we should terminate nicely.
                await _process_io(
                    process, io=process.stdin.wait_closed(), ignore_exit=True
                )
                return

        # We have exhausted the input.
        process.stdin.close()
        await process.stdin.wait_closed()

    async def _stream_output(
        reader: asyncio.StreamReader,
        queue: asyncio.Queue,
    ) -> None:
        # Read data from the process and write it to a queue.
        chunk = await reader.read(_INPUT_CHUNK_SIZE)
        await queue.put(chunk)
        if len(chunk) == 0:
            # We have exhausted the output stream. An empty chunk indicates
            # to queue consumers that this is the case.
            return

        if process.returncode is None:
            # If it's still running, repeat this step.
            _submit_background_task(_stream_output(reader, queue))
        elif len(chunk) > 0:
            # Ensure that the reader task exits in this case.
            await queue.put(b"")

    async def _read_from_queue(
        queue: asyncio.Queue,
        wait_task_: asyncio.Task,
        ignore_errors: bool = False,
    ) -> AsyncIterable[bytes]:
        async for chunk in _read_from_queue_until_finished(
            queue, wait_task_, ignore_errors=ignore_errors
        ):
            yield chunk

        # Wait for background tasks to complete.
        try:
            await asyncio.gather(*running_tasks)
        except BrokenPipeError:  # pragma: no coverage
            # Ignore this, because it probably just means the process exited
            # before it was finished writing.
            pass
        except Exception as err:  # pragma: no coverage
            # If we have other errors, we should raise them.
            raise err

    # We'll always be waiting for the process to exit.
    wait_task = asyncio.create_task(process.wait())
    if input_source is not None:
        # At the same time, feed the input to the process.
        _submit_background_task(_feed_input())
    # Also read the output from the process.
    _submit_background_task(_stream_output(process.stdout, stdout_queue))
    _submit_background_task(_stream_output(process.stderr, stderr_queue))

    # Read the data from the queues.
    return (
        _read_from_queue(stdout_queue, wait_task),
        # Ignore errors on stderr, because we still want to read this
        # output even if the command failed.
        _read_from_queue(stderr_queue, wait_task, ignore_errors=True),
    )


async def ensure_streamable(
    source: AsyncIterable[bytes],
) -> Tuple[AsyncIterable[bytes], AsyncIterable[bytes]]:
    """
    Ensures that an input video is actually streamable. If it's not, it fixes
    it, although this requires buffering it to the disk.

    Args:
        source: The source video.

    Returns:
        A streamable version of the source video and the FFMpeg error stream.

    """

    async def read_output_from_file(file_path: Path) -> AsyncIterable[bytes]:
        file = file_path.open("rb")
        while _chunk := file.read(_FILE_CHUNK_SIZE):
            yield _chunk

        # Delete the file when done.
        logger.debug("Deleting temporary file {}", file_path)
        file_path.unlink()

    logger.info("Fixing non-streamable video input...")

    with tempfile.NamedTemporaryFile() as input_file, tempfile.NamedTemporaryFile(
        mode="rb", suffix=".mp4", delete=False
    ) as output_file:
        async for chunk in source:
            input_file.write(chunk)
        input_file.flush()
        input_file.seek(0)

        # Use FFMpeg to fix it.
        ffmpeg = find_exe("ffmpeg")
        ffmpeg_process = await asyncio.create_subprocess_exec(
            ffmpeg,
            "-i",
            input_file.name,
            "-y",  # Automatically overwrite existing output file.
            "-c:v",
            "copy",
            "-movflags",
            "faststart",
            "-strict",
            "2",
            output_file.name,
            **_DEFAULT_PIPES,
        )

        stdout, stderr = await _streaming_communicate(
            ffmpeg_process, input_source=None
        )
        stderr = b"".join([c async for c in stderr])
        logger.debug("ffmpeg stderr: {}", stderr)
        stdout = "".join([c.decode("utf8") async for c in stdout])
        logger.debug("ffmpeg stdout: {}", stdout)

        async def _error_stream() -> AsyncIterable[bytes]:
            yield stderr

        # Read the output from the file.
        return (
            read_output_from_file(Path(output_file.name)),
            _error_stream(),
        )


async def ffprobe(source: AsyncIterable[bytes]) -> Dict[str, Any]:
    """
    Runs `ffprobe` and returns the results.

    Args:
        source: The video to probe.

    Returns:
        The FFProbe results. It will parse the JSON, but not do anything
        more than that.

    """
    # Run FFProbe.
    ffprobe = find_exe("ffprobe")
    logger.debug("Starting probe...")
    ffprobe_process = await asyncio.create_subprocess_exec(
        ffprobe, *FFPROBE_ARGS, **_DEFAULT_PIPES
    )
    stdout, stderr = await _streaming_communicate(
        ffprobe_process, input_source=source
    )

    # There should be minimal output here, so we can just read it all at once.
    stdout = "".join([c.decode("utf8") async for c in stdout])
    stderr = "".join([c.decode("utf8") async for c in stderr])
    logger.debug("ffprobe stderr: {}", stderr)
    await ffprobe_process.wait()

    # Otherwise, parse the output.
    return json.loads(stdout)


async def create_preview(
    source: AsyncIterable[bytes], preview_width: int = 128
) -> Tuple[AsyncIterable[bytes], AsyncIterable[bytes]]:
    """
    Creates a preview, which is just a small, low-resolution version of a video.

    Args:
        source: The source video to process.
        preview_width: The width of the preview to generate, in pixels.
            (Aspect ratio will be maintained.)

    Returns:
        The video preview, as a raw stream, and the stderr from FFMpeg.

    """
    ffmpeg = find_exe("ffmpeg")
    ffmpeg_process = await _g_runner.run(
        ffmpeg,
        "-i",
        "pipe:",
        "-vf",
        f"scale={preview_width}:-2,setsar=1:1,fps=30",
        "-c:v",
        "vp9",
        "-row-mt",
        "1",
        "-f",
        "webm",
        "-",
        **_DEFAULT_PIPES,
    )
    return await _streaming_communicate(ffmpeg_process, input_source=source)


async def create_streamable(
    source: AsyncIterable[bytes], max_width: int = 1920
) -> Tuple[AsyncIterable[bytes], AsyncIterable[bytes]]:
    """
    Creates a version of the video optimized for streaming.

    Args:
        source: The source video to process.
        max_width: The maximum width of the video, in pixels. (Videos with an
            original resolution lower than this will not be resized.)

    Returns:
        The video preview, as a raw stream, and the stderr from FFMpeg.

    """
    ffmpeg = find_exe("ffmpeg")
    ffmpeg_process = await _g_runner.run(
        ffmpeg,
        "-i",
        "pipe:",
        "-vf",
        f"scale='min({max_width},iw)':-2,setsar=1:1,fps=30",
        "-c:v",
        "vp9",
        "-row-mt",
        "1",
        "-b:v",
        "1800k",
        "-maxrate",
        "2610k",
        "-crf",
        "10",
        "-f",
        "webm",
        "-",
        **_DEFAULT_PIPES,
    )
    return await _streaming_communicate(ffmpeg_process, input_source=source)


async def create_thumbnail(
    source: AsyncIterable[bytes], thumbnail_width: int = 128
) -> Tuple[AsyncIterable[bytes], AsyncIterable[bytes]]:
    """
    Creates a thumbnail of the video based on the first frame.

    Args:
        source: The source video to process.
        thumbnail_width: The width of the thumbnail to generate, in pixels.
            (Aspect ratio will be maintained.)

    Returns:
        The video thumbnail, as a raw JPEG stream, and the stderr from FFMpeg.

    """
    ffmpeg = find_exe("ffmpeg")
    ffmpeg_process = await asyncio.create_subprocess_exec(
        ffmpeg,
        "-i",
        "pipe:",
        "-vf",
        f"scale={thumbnail_width}*sar:-2,setsar=1",
        "-vframes",
        "1",
        "-f",
        "singlejpeg",
        "-",
        **_DEFAULT_PIPES,
    )
    return await _streaming_communicate(ffmpeg_process, input_source=source)
