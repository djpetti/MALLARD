"""
This is a client for the transcoder service. We *should* be able to
autogenerate this, but OpenAPI is weird about async stuff.
"""
import io
from typing import Any, AsyncIterable, Dict

from fastapi import HTTPException, UploadFile
from loguru import logger

from ....config import config
from ...aiohttp_session import session


async def _read_file_chunks(
    file_data: UploadFile, chunk_size: int = 1024
) -> AsyncIterable[bytes]:
    """
    Helper function that reads file data in chunks asynchronously.

    Args:
        file_data: The raw video data.
        chunk_size: The size of the chunks to read.

    Yields:
        The next chunk of the video data.

    """

    while True:
        chunk = await file_data.read(chunk_size)
        if not chunk:
            break
        yield chunk


def _make_api_url(uri: str) -> str:
    """
    Helper function that makes an API URL.

    Args:
        uri: The URI to make the URL for.

    Returns:
        The API URL.

    """
    base_url = config["transcoder_base_url"].as_str()
    return f"{base_url}/{uri}"


async def probe_video(video: UploadFile) -> Dict[str, Any]:
    """
    Probes the video file using ffprobe.

    Args:
        video: The video file.

    Returns:
        The ffprobe results.

    """
    logger.debug("Probing video {}...", video.filename)
    async with session.post(
        _make_api_url("metadata/infer"), data=_read_file_chunks(video)
    ) as response:
        if response.status != 200:
            raise HTTPException(
                status_code=response.status,
                detail=f"Metadata inference failed: {response.reason}",
            )

        return await response.json()


async def create_preview(video: UploadFile) -> AsyncIterable[bytes]:
    """
    Creates a preview for the video.

    Args:
        video: The video file.

    Returns:
        The preview, in chunks.

    """
    logger.debug("Creating preview for video {}...", video.filename)
    async with session.post(
        _make_api_url("create_preview"), data=_read_file_chunks(video)
    ) as response:
        if response.status != 200:
            raise HTTPException(
                status_code=response.status,
                detail=f"Preview creation failed: {response.reason}",
            )

        async for chunk in response.content.iter_chunks(1024):
            yield chunk


async def create_thumbnail(video: UploadFile) -> AsyncIterable[bytes]:
    """
    Creates a thumbnail for the video.

    Args:
        video: The video file.

    Returns:
        The thumbnail, in chunks.

    """
    logger.debug("Creating thumbnail for video {}...", video.filename)
    async with session.post(
        _make_api_url("create_thumbnail"), data=_read_file_chunks(video)
    ) as response:
        if response.status != 200:
            raise HTTPException(
                status_code=response.status,
                detail=f"Thumbnail creation failed: {response.reason}",
            )

        async for chunk in response.content.iter_chunks(1024):
            yield chunk
