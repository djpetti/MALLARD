"""
Wrapper around FFMpeg functionality.

In case you're wondering why we can't use `python-ffmpeg` or similar, it's
because we have to be able to process data from memory instead of writing
to the disk.
"""

import asyncio
import json
from typing import Any, AsyncIterable, Coroutine, Dict, Tuple

from fastapi import UploadFile

from mallard.cli_utils import find_exe

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

_DEFAULT_PIPES = dict(
    stdin=asyncio.subprocess.PIPE,
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
)
"""
Default configuration for stdin, stdout, and stderr for subprocesses.
"""


async def _streaming_communicate(
    process: asyncio.subprocess.Process, *, input_source: UploadFile
) -> Tuple[AsyncIterable[bytes], AsyncIterable[bytes]]:
    """
    This function is sort of similar to `Process.communicate()`, but it
    asynchronously streams data to and from the process being run. This is
    really useful for FFmpeg operations, which often read and write huge
    amounts of data from stdin and to stdout.

    Args:
        process: The process to run.
        input_source: The source to get input from.

    Returns:
        Iterables that can be used to read the stdout and stderr from the
        process.

    """
    stdout_queue = asyncio.Queue(maxsize=_MAX_QUEUE_SIZE)
    stderr_queue = asyncio.Queue(maxsize=_MAX_QUEUE_SIZE)
    num_bytes_read = 0

    # Keeps track of tasks that are currently running.
    running_tasks = set()

    def _finalize_background_task(task: asyncio.Task) -> None:
        if task.exception():
            # Report exceptions if we have them.
            raise task.exception()
        running_tasks.discard(task)

    def _submit_background_task(to_run: Coroutine) -> None:
        # This is necessary to stop tasks from getting garbage collected
        # before they're done.
        next_task = asyncio.create_task(to_run)
        running_tasks.add(next_task)
        # Remove it once it finishes.
        next_task.add_done_callback(_finalize_background_task)

    async def _feed_input() -> None:
        nonlocal num_bytes_read

        # Feed data from the source to the process stdin.
        chunk = await input_source.read(_INPUT_CHUNK_SIZE)
        num_bytes_read += len(chunk)
        if len(chunk) == 0:
            # We have exhausted the input.
            process.stdin.close()
            await process.stdin.wait_closed()
            return
        process.stdin.write(chunk)
        try:
            await process.stdin.drain()
        except ConnectionResetError:
            # The process probably exited, so we should terminate nicely.
            return

        if process.returncode is None:
            # If it's still running, repeat this step.
            _submit_background_task(_feed_input())

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

    async def _read_from_queue(
        queue: asyncio.Queue, wait_task_: asyncio.Task
    ) -> AsyncIterable[bytes]:
        # Iterates the messages it reads from the queue.
        while not wait_task_.done():
            chunk = await queue.get()
            if len(chunk) > 0:
                yield chunk
            else:
                # Empty chunk indicates that we have no more data.
                break

        await wait_task_

    # We'll always be waiting for the process to exit.
    wait_task = asyncio.create_task(process.wait())
    # At the same time, feed the input to the process.
    _submit_background_task(_feed_input())
    # Also read the output from the process.
    _submit_background_task(_stream_output(process.stdout, stdout_queue))
    _submit_background_task(_stream_output(process.stderr, stderr_queue))

    # Read the data from the queues.
    return _read_from_queue(stdout_queue, wait_task), _read_from_queue(
        stderr_queue, wait_task
    )


async def ffprobe(source: UploadFile) -> Dict[str, Any]:
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
    ffprobe_process = await asyncio.create_subprocess_exec(
        ffprobe, *FFPROBE_ARGS, **_DEFAULT_PIPES
    )
    stdout, stderr = await _streaming_communicate(
        ffprobe_process, input_source=source
    )

    # There should be minimal output here, so we can just read it all at once.
    stdout = "".join([c.decode("utf8") async for c in stdout])
    stderr = "".join([c.decode("utf8") async for c in stderr])

    # Check that it worked.
    await ffprobe_process.wait()
    if ffprobe_process.returncode != 0:
        raise OSError("FFProbe execution failed: {}", stderr)

    # Otherwise, parse the output.
    return json.loads(stdout)


async def create_preview(
    source: UploadFile, preview_width: int = 128
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
    ffmpeg_process = await asyncio.create_subprocess_exec(
        ffmpeg,
        "-i",
        "pipe:",
        "-vf",
        f"scale={preview_width}:-2,setsar=1:1",
        "-c:v",
        "libx264",
        "-f",
        "h264",
        "-",
        **_DEFAULT_PIPES,
    )
    return await _streaming_communicate(ffmpeg_process, input_source=source)
