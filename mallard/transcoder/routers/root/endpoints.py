"""
API endpoints for the video transcoding microservice.
"""


from typing import Annotated, Any, AsyncIterable, Dict

from fastapi import APIRouter, HTTPException, Query, UploadFile
from loguru import logger
from starlette.responses import StreamingResponse

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
    Gets the metadata for a video.

    Args:
        video: The video to get the metadata for.

    Returns:
        The metadata, which is just the output from `ffprobe`.

    """
    try:
        return await ffprobe(video)
    except OSError:
        raise HTTPException(
            status_code=422,
            detail="Could not process the provided video. Is it valid?",
        )


@router.post("/create_preview")
async def create_video_preview(
    video: UploadFile, preview_width: Annotated[int, Query(gt=0)] = 128
) -> StreamingResponse:
    """
    Creates a preview for a video.

    Args:
        video: The video to create a preview for.
        preview_width: The width of the preview, in pixels.

    Returns:
        The preview that was created.

    """
    preview_stream, error_stream = await create_preview(
        video, preview_width=preview_width
    )
    return _streaming_response_with_errors(
        preview_stream, error_stream=error_stream, content_type="video/vp9"
    )


@router.post("/create_streaming_video")
async def create_streaming_video(
    video: UploadFile, max_width: Annotated[int, Query(gt=0)] = 1920
) -> StreamingResponse:
    """
    Creates a preview for a video.

    Args:
        video: The video to create a preview for.
        max_width: The maximum width of the video, in pixels. (Videos with an
            original resolution lower than this will not be resized.)

    Returns:
        The transcoded video that was created.

    """
    output_stream, error_stream = await create_streamable(
        video, max_width=max_width
    )
    return _streaming_response_with_errors(
        output_stream, error_stream=error_stream, content_type="video/vp9"
    )


@router.post("/create_thumbnail")
async def create_video_thumbnail(
    video: UploadFile, thumbnail_width: Annotated[int, Query(gt=0)] = 128
) -> StreamingResponse:
    """
    Creates a thumbnail for a video.

    Args:
        video: The video to create a thumbnail for.
        thumbnail_width: The width of the thumbnail, in pixels.

    Returns:
        The thumbnail that was created.

    """
    thumbnail_stream, error_stream = await create_thumbnail(
        video, thumbnail_width=thumbnail_width
    )
    return _streaming_response_with_errors(
        thumbnail_stream, error_stream=error_stream, content_type="image/jpeg"
    )
