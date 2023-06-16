"""
API endpoints for managing video data.
"""
import asyncio
import io
import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
)
from loguru import logger

from ...backends import backend_manager as backends
from ...backends.metadata import RasterMetadataStore
from ...backends.metadata.schemas import UavVideoMetadata
from ...backends.objects import ObjectStore
from ...backends.objects.models import ObjectRef, derived_id
from ...dependencies import use_bucket_videos
from .schemas import CreateResponse
from .transcoder_client import create_preview, create_thumbnail
from .video_metadata import InvalidVideoError, fill_metadata

_TRANSCODER_BASE_URL = "http://transcoder:8000"
"""
Base URL of the transcoder service.
"""


router = APIRouter(prefix="/video", tags=["videos"])


async def filled_uav_metadata(
    metadata: UavVideoMetadata = Depends(UavVideoMetadata.as_form),
    video_data: UploadFile = File(...),
):
    """
    Intercepts requests containing UAV video metadata and fills in any missing
    fields based on `ffprobe` results.

    Args:
        metadata: The metadata sent in the request.
        video_data: The raw video data.

    Returns:
        A copy of the metadata with missing fields filled.

    Raises:
        `HTTPException` if auto-filling the metadata failed.

    """
    try:
        return await fill_metadata(metadata, video=video_data)
    except InvalidVideoError:
        raise HTTPException(
            status_code=415,
            detail="The uploaded video has an invalid format, or does not "
            "match the specified format.",
        )


@router.post("/create_uav", response_model=CreateResponse, status_code=201)
async def create_uav_video(
    metadata: UavVideoMetadata = Depends(filled_uav_metadata),
    video_data: UploadFile = File(...),
    object_store: ObjectStore = Depends(backends.object_store),
    metadata_store: RasterMetadataStore = Depends(
        backends.video_metadata_store
    ),
    bucket: str = Depends(use_bucket_videos),
) -> CreateResponse:
    """
    Uploads a new video captured from a UAV.

    Args:
        metadata: The video-specific metadata.
        video_data: The actual video file to upload.
        object_store: The object store to upload the video to.
        metadata_store: The metadata store to upload the metadata to.
        bucket: The bucket to use for new videos.

    Returns:
        A `CreateResponse` object for this video.

    """
    # Create the image in the object store.
    unique_name = uuid.uuid4().hex
    object_id = ObjectRef(bucket=bucket, name=unique_name)
    logger.info("Creating a new video {} in bucket {}.", unique_name, bucket)
    object_task = asyncio.create_task(
        object_store.create_object(object_id, data=video_data)
    )

    # Create the corresponding metadata.
    metadata_task = asyncio.create_task(
        metadata_store.add(object_id=object_id, metadata=metadata)
    )

    # Create and save the preview.
    thumbnail_object_id = derived_id(object_id, "thumbnail")
    preview_object_id = derived_id(object_id, "preview")

    async def _create_preview_and_thumbnail() -> None:
        # Do this sequentially so that it doesn't try to read from the file
        # concurrently.
        thumbnail = create_thumbnail(video_data)
        await object_store.create_object(thumbnail_object_id, data=thumbnail)
