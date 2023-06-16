"""
API endpoints for the video transcoding microservice.
"""


from typing import Annotated, Any, Dict

from fastapi import APIRouter, HTTPException, Query, UploadFile
from starlette.responses import StreamingResponse

from ...ffmpeg import create_preview, create_thumbnail, ffprobe

router = APIRouter(tags=["transcoder"])


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
    try:
        preview_stream, _ = await create_preview(
            video, preview_width=preview_width
        )
    except OSError:
        raise HTTPException(
            status_code=422,
            detail="Could not process the provided video. Is it valid?",
        )

    return StreamingResponse(preview_stream, media_type="video/mp4")


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
    try:
        thumbnail_stream, _ = await create_thumbnail(
            video, thumbnail_width=thumbnail_width
        )
    except OSError:
        raise HTTPException(
            status_code=422,
            detail="Could not process the provided video. Is it valid?",
        )

    return StreamingResponse(thumbnail_stream, media_type="image/jpeg")
