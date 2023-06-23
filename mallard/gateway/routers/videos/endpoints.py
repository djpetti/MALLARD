"""
API endpoints for managing video data.
"""
import asyncio
import uuid
from typing import List

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    File,
    HTTPException,
    UploadFile,
)
from loguru import logger

from ...artifact_metadata import MissingLengthError
from ...backends import backend_manager as backends
from ...backends.metadata import MetadataOperationError, RasterMetadataStore
from ...backends.metadata.schemas import UavVideoMetadata
from ...backends.objects import ObjectOperationError, ObjectStore
from ...backends.objects.models import ObjectRef, derived_id
from ...dependencies import use_bucket_videos
from .schemas import CreateResponse
from .transcoder_client import create_preview, create_thumbnail
from .video_metadata import InvalidVideoError, fill_metadata

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
    except MissingLengthError:
        raise HTTPException(
            status_code=411,
            detail="You must provide a size for the uploaded video, either in "
            "the metadata, or in the content-length header.",
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
    background_tasks: BackgroundTasks = BackgroundTasks,
) -> CreateResponse:
    """
    Uploads a new video captured from a UAV.

    Args:
        metadata: The video-specific metadata.
        video_data: The actual video file to upload.
        object_store: The object store to upload the video to.
        metadata_store: The metadata store to upload the metadata to.
        bucket: The bucket to use for new videos.
        background_tasks: Handle to use for submitting background tasks.

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

    try:
        await asyncio.gather(object_task, metadata_task)
    except MetadataOperationError as error:
        # If one operation fails, it would be best to try and roll back the
        # other.
        logger.info("Rolling back object creation {} upon error.", object_id)
        await object_store.delete_object(object_id)
        raise error
    except ObjectOperationError as error:
        logger.info("Rolling back metadata creation {} upon error.", object_id)
        await metadata_store.delete(object_id)
        raise error

    # Create and save the preview.
    thumbnail_object_id = derived_id(object_id, "thumbnail")
    preview_object_id = derived_id(object_id, "preview")

    async def _create_preview_and_thumbnail() -> None:
        # Do this sequentially so that it doesn't try to read from the file
        # concurrently.
        logger.debug("Starting video transcode background task...")
        await video_data.seek(0)
        thumbnail = create_thumbnail(
            video_data, chunk_size=ObjectStore.UPLOAD_CHUNK_SIZE
        )
        await object_store.create_object(thumbnail_object_id, data=thumbnail)

        await video_data.seek(0)
        preview = create_preview(
            video_data, chunk_size=ObjectStore.UPLOAD_CHUNK_SIZE
        )
        await object_store.create_object(preview_object_id, data=preview)
        logger.debug("Finished video transcode background task.")

    background_tasks.add_task(_create_preview_and_thumbnail)

    return CreateResponse(video_id=object_id)


@router.delete("/delete")
async def delete_videos(videos: List[ObjectRef] = Body(...)) -> None:
    """
    Deletes existing videos from the server.

    Args:
        videos: The videos to delete.

    """
