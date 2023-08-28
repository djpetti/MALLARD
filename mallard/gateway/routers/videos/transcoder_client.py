"""
This is a client for the transcoder service. We *should* be able to
autogenerate this, but OpenAPI is weird about async stuff.
"""
from asyncio import IncompleteReadError
from typing import Any, AsyncIterable, Dict

import aiohttp
from fastapi import HTTPException, UploadFile
from loguru import logger

from ....config import config
from ...aiohttp_session import Session
from ...async_utils import read_file_chunks

get_session = Session(base_url=config["transcoder_base_url"].as_str())


def _make_video_form_data(video: UploadFile) -> aiohttp.FormData:
    """
    Creates the multipart form for uploading video data.

    Args:
        video: The video file.

    Returns:
        The multipart form.

    """
    data = aiohttp.FormData()
    data.add_field(
        "video",
        read_file_chunks(video),
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
        "/metadata/infer", data=_make_video_form_data(video)
    ) as response:
        if response.status != 200:
            raise HTTPException(
                status_code=response.status,
                detail=f"Metadata inference failed: {response.reason}",
            )

        return await response.json()


async def create_preview(
    video: UploadFile, chunk_size: int = 1024
) -> AsyncIterable[bytes]:
    """
    Creates a preview for the video.

    Args:
        video: The video file.
        chunk_size: Chunk size to use for the output iterator.

    Returns:
        The preview, in chunks.

    """
    logger.debug("Creating preview for video {}...", video.filename)
    async with get_session().post(
        "/create_preview", data=_make_video_form_data(video)
    ) as response:
        if response.status != 200:
            raise HTTPException(
                status_code=response.status,
                detail=f"Preview creation failed: {response.reason}",
            )

        async for chunk in _iter_exact_chunked(response.content, chunk_size):
            yield chunk


async def create_streamable(
    video: UploadFile, chunk_size: int = 1024
) -> AsyncIterable[bytes]:
    """
    Creates a preview for the video.

    Args:
        video: The video file.
        chunk_size: Chunk size to use for the output iterator.

    Returns:
        The preview, in chunks.

    """
    logger.debug("Creating streamable version for video {}...", video.filename)
    # This operation can be quite slow, so use a long timeout.
    async with get_session().post(
        "/create_streaming_video",
        data=_make_video_form_data(video),
        timeout=60 * 60,
    ) as response:
        if response.status != 200:
            raise HTTPException(
                status_code=response.status,
                detail=f"Preview creation failed: {response.reason}",
            )

        async for chunk in _iter_exact_chunked(response.content, chunk_size):
            yield chunk


async def create_thumbnail(
    video: UploadFile, chunk_size: int = 1024
) -> AsyncIterable[bytes]:
    """
    Creates a thumbnail for the video.

    Args:
        video: The video file.
        chunk_size: Chunk size to use for the output iterator.

    Returns:
        The thumbnail, in chunks.

    """
    logger.debug("Creating thumbnail for video {}...", video.filename)
    async with get_session().post(
        "/create_thumbnail", data=_make_video_form_data(video)
    ) as response:
        if response.status != 200:
            raise HTTPException(
                status_code=response.status,
                detail=f"Thumbnail creation failed: {response.reason}",
            )

        async for chunk in _iter_exact_chunked(response.content, chunk_size):
            yield chunk
