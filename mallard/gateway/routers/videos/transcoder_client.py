"""
This is a client for the transcoder service. We *should* be able to
autogenerate this, but OpenAPI is weird about async stuff.
"""
import asyncio
from asyncio import IncompleteReadError
from typing import Any, AsyncIterable, Dict

import aiohttp
from fastapi import HTTPException, UploadFile
from loguru import logger
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

from ....config import config
from ...aiohttp_session import Session
from ...async_utils import read_file_chunks
from ...backends.objects.models import ObjectRef

_PROBE_SIZE = 5 * 2**20  # 5 MB
"""
Number of bytes to read from the start of the video when probing it.
"""


get_session = Session(base_url=config["transcoder"]["base_url"].as_str())

LONG_OP_TIMEOUT = aiohttp.ClientTimeout(connect=60)
"""
Timeout for long operations. By default, there is no timeout, except to
establish the initial connection (this should happen quickly, even if the
transcoder service is under high load.)
"""

client_retry = retry(
    retry=retry_if_exception_type(asyncio.Timeout),
    wait=wait_random_exponential(multiplier=1, max=60),
    after=lambda _: logger.warning("Retrying transcoder API call..."),
    stop=stop_after_attempt(10),
)


def _make_video_form_data(
    video: UploadFile, max_length: int | None = None
) -> aiohttp.FormData:
    """
    Creates the multipart form for uploading video data.

    Args:
        video: The video file.
        max_length: The maximum number of bytes from the file to upload.

    Returns:
        The multipart form.

    """
    data = aiohttp.FormData()
    data.add_field(
        "video",
        read_file_chunks(video, max_length=max_length),
        filename=video.filename,
        content_type=video.content_type,
    )

    return data


async def _iter_exact_chunked(
    reader: aiohttp.StreamReader, chunk_size: int
) -> AsyncIterable[bytes]:
    """
    Reads the stream reader in chunks of the exact size, except for the last
    one, which may be smaller.

    Args:
        reader: The reader to read from.
        chunk_size: The chunk size to use.

    Yields:
        The chunks.

    """
    while True:
        try:
            chunk = await reader.readexactly(chunk_size)
            yield chunk
        except IncompleteReadError as error:
            # We reached the end of the stream. Yield the partial chunk.
            yield error.partial
            break


@client_retry
async def probe_video(video: UploadFile) -> Dict[str, Any]:
    """
    Probes the video file using ffprobe.

    Args:
        video: The video file.

    Returns:
        The ffprobe results.

    """
    logger.debug("Probing video {}...", video.filename)

    async with get_session().post(
        "/metadata/infer",
        data=_make_video_form_data(video, max_length=_PROBE_SIZE),
    ) as response:
        if response.status != 200:
            raise HTTPException(
                status_code=response.status,
                detail=f"Metadata inference failed: {response.reason}",
            )

        return await response.json()


@client_retry
async def create_preview(
    video: ObjectRef, chunk_size: int = 1024
) -> AsyncIterable[bytes]:
    """
    Creates a preview for the video.

    Args:
        video: The video file.
        chunk_size: Chunk size to use for the output iterator.

    Returns:
        The preview, in chunks.

    """
    logger.debug("Creating preview for video {}...", video)
    async with get_session().post(
        f"/create_preview/{video.bucket}/{video.name}",
        # This operation can be quite slow, so use a long timeout.
        timeout=LONG_OP_TIMEOUT,
    ) as response:
        if response.status != 200:
            raise HTTPException(
                status_code=response.status,
                detail=f"Preview creation failed: {response.reason}",
            )

        async for chunk in _iter_exact_chunked(response.content, chunk_size):
            yield chunk


@client_retry
async def create_streamable(
    video: ObjectRef, chunk_size: int = 1024
) -> AsyncIterable[bytes]:
    """
    Creates a preview for the video.

    Args:
        video: The video file.
        chunk_size: Chunk size to use for the output iterator.

    Returns:
        The preview, in chunks.

    """
    logger.debug("Creating streamable version for video {}...", video)
    async with get_session().post(
        f"/create_streaming_video/{video.bucket}/{video.name}",
        # This operation can be quite slow, so use a long timeout.
        timeout=LONG_OP_TIMEOUT,
    ) as response:
        if response.status != 200:
            logger.error("Streamable creation failed: {}", response.reason)
            raise HTTPException(
                status_code=response.status,
                detail=f"Streamable creation failed: {response.reason}",
            )

        async for chunk in _iter_exact_chunked(response.content, chunk_size):
            yield chunk


@client_retry
async def create_thumbnail(
    video: ObjectRef, chunk_size: int = 1024
) -> AsyncIterable[bytes]:
    """
    Creates a thumbnail for the video.

    Args:
        video: The video file.
        chunk_size: Chunk size to use for the output iterator.

    Returns:
        The thumbnail, in chunks.

    """
    logger.debug("Creating thumbnail for video {}...", video)
    async with get_session().post(
        f"/create_thumbnail/{video.bucket}/{video.name}",
    ) as response:
        if response.status != 200:
            raise HTTPException(
                status_code=response.status,
                detail=f"Thumbnail creation failed: {response.reason}",
            )

        async for chunk in _iter_exact_chunked(response.content, chunk_size):
            yield chunk
