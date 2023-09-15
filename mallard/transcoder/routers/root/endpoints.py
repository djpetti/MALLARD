"""
API endpoints for the video transcoding microservice.
"""


from typing import Annotated, Any, AsyncIterable, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from loguru import logger
from starlette.responses import StreamingResponse

from ....gateway.async_utils import read_file_chunks
from ....gateway.backends import backend_manager as backends
from ....gateway.backends.objects import ObjectStore
from ....gateway.backends.objects.models import ObjectRef
from ...ffmpeg import (
    create_preview,
    create_streamable,
    create_thumbnail,
    ffprobe,
)

router = APIRouter(tags=["transcoder"])


def _streaming_response_with_errors(
    data_stream: AsyncIterable[bytes],
    *,
    error_stream: AsyncIterable[bytes],
    content_type: str = None
) -> StreamingResponse:
    """
    Creates a `StreamingResponse` and handles any errors that might occur
    while reading the stream.

    Args:
        data_stream: The stream to read from.
        error_stream: The stream containing error information. This will NOT
            be included in the response, but will be used to craft a useful
            error message.

    Returns:
        The `StreamingResponse`.

    """

    async def _read_and_handle_errors(stream: AsyncIterable[bytes]):
        try:
            async for chunk in stream:
                yield chunk
            logger.debug(
                "ffmpeg stderr: {}",
                "".join([c.decode("utf8") async for c in error_stream]),
            )

        except OSError:
            logger.error(
                "ffmpeg stderr: {}",
                "".join([c.decode("utf8") async for c in error_stream]),
            )
            raise HTTPException(
                status_code=422,
                detail="Could not process the provided video. Is it valid?",
            )

    return StreamingResponse(
        _read_and_handle_errors(data_stream), media_type=content_type
    )


@router.post("/metadata/infer")
async def infer_video_metadata(video: UploadFile) -> Dict[str, Any]:
    """
    Infers the metadata for a video.

    Args:
        video: The video to get the metadata for.

    Returns:
        The metadata, which is just the output from `ffprobe`.

    """
    try:
        return await ffprobe(read_file_chunks(video))
    except OSError:
        raise HTTPException(
            status_code=422,
            detail="Could not process the provided video. Is it valid?",
        )


@router.post("/create_preview/{bucket}/{name}")
async def create_video_preview(
    bucket: str,
    name: str,
    preview_width: Annotated[int, Query(gt=0)] = 128,
    object_store: ObjectStore = Depends(backends.object_store),
) -> StreamingResponse:
    """
    Creates a preview for a video.

    Args:
        bucket: The bucket that the video is in.
        name: The name of the video.
        preview_width: The width of the preview, in pixels.
        object_store: The object store to retrieve the video from.

    Returns:
        The preview that was created.

    """
    video = await object_store.get_object(ObjectRef(bucket=bucket, name=name))

    preview_stream, error_stream = await create_preview(
        video, preview_width=preview_width
    )
    return _streaming_response_with_errors(
        preview_stream, error_stream=error_stream, content_type="video/vp9"
    )


@router.post("/create_streaming_video/{bucket}/{name}")
async def create_streaming_video(
    bucket: str,
    name: str,
    max_width: Annotated[int, Query(gt=0)] = 1920,
    object_store: ObjectStore = Depends(backends.object_store),
) -> StreamingResponse:
    """
    Creates a preview for a video.

    Args:
        bucket: The bucket that the video is in.
        name: The name of the video.
        max_width: The maximum width of the video, in pixels. (Videos with an
            original resolution lower than this will not be resized.)
        object_store: The object store to retrieve the video from.

    Returns:
        The preview that was created.

    """
    video = await object_store.get_object(ObjectRef(bucket=bucket, name=name))

    output_stream, error_stream = await create_streamable(
        video, max_width=max_width
    )
    return _streaming_response_with_errors(
        output_stream, error_stream=error_stream, content_type="video/vp9"
    )


@router.post("/create_thumbnail/{bucket}/{name}")
async def create_video_thumbnail(
    bucket: str,
    name: str,
    thumbnail_width: Annotated[int, Query(gt=0)] = 128,
    object_store: ObjectStore = Depends(backends.object_store),
) -> StreamingResponse:
    """
    Creates a thumbnail for a video.

    Args:
        bucket: The bucket that the video is in.
        name: The name of the video.
        thumbnail_width: The width of the thumbnail, in pixels.
        object_store: The object store to retrieve the video from.

    Returns:
        The thumbnail that was created.

    """
    video = await object_store.get_object(ObjectRef(bucket=bucket, name=name))

    thumbnail_stream, error_stream = await create_thumbnail(
        video, thumbnail_width=thumbnail_width
    )
    return _streaming_response_with_errors(
        thumbnail_stream, error_stream=error_stream, content_type="image/jpeg"
    )
