"""
API endpoints for managing video data.
"""
import asyncio
import uuid
from typing import List, cast

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
from starlette.responses import StreamingResponse

from mallard.gateway.routers.dependencies import use_bucket_videos

from ...artifact_metadata import MissingLengthError
from ...backends import backend_manager as backends
from ...backends.metadata import (
    ArtifactMetadataStore,
    MetadataOperationError,
    MetadataStore,
)
from ...backends.metadata.schemas import UavVideoMetadata, VideoFormat
from ...backends.objects import ObjectOperationError, ObjectStore
from ...backends.objects.models import ObjectRef, derived_id
from ..common import check_key_errors, get_metadata, update_metadata
from .schemas import CreateResponse, MetadataResponse
from .transcoder_client import create_preview, create_thumbnail
from .video_metadata import InvalidVideoError, fill_metadata

router = APIRouter(prefix="/videos", tags=["videos"])


_VIDEO_FORMAT_TO_MIME_TYPES = {
    VideoFormat.AV1: "video/AV1",
    VideoFormat.AVC: "video/H264",
    VideoFormat.H263: "video/H263",
    VideoFormat.HEVC: "video/H265",
    VideoFormat.THEORA: "video/ogg",
    VideoFormat.VP8: "video/VP8",
    VideoFormat.VP9: "video/VP9",
}
"""
Maps video formats to corresponding MIME types.
"""


async def filled_uav_metadata(
    metadata: UavVideoMetadata = Depends(UavVideoMetadata.as_form),
    video_data: UploadFile = File(...),
) -> UavVideoMetadata:
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
    metadata_store: ArtifactMetadataStore = Depends(
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
async def delete_videos(
    videos: List[ObjectRef] = Body(...),
    object_store: ObjectStore = Depends(backends.object_store),
    metadata_store: ArtifactMetadataStore = Depends(
        backends.video_metadata_store
    ),
) -> None:
    """
    Deletes existing videos from the server.

    Args:
        videos: The videos to delete.
        object_store: The object store to delete the videos from.
        metadata_store: The metadata store to delete the metadata from.

    """
    logger.info("Deleting {} videos.", len(videos))

    with check_key_errors():
        async with asyncio.TaskGroup() as tasks:
            for video in videos:
                tasks.create_task(object_store.delete_object(video))
                tasks.create_task(
                    object_store.delete_object(derived_id(video, "thumbnail"))
                )
                tasks.create_task(
                    object_store.delete_object(derived_id(video, "preview"))
                )

                tasks.create_task(metadata_store.delete(video))


@router.get("/{bucket}/{name}")
async def get_video(
    bucket: str,
    name: str,
    object_store: ObjectStore = Depends(backends.object_store),
    metadata_store: ArtifactMetadataStore = Depends(
        backends.video_metadata_store
    ),
) -> StreamingResponse:
    """
    Retrieves a video from the server.

    Args:
        bucket: The bucket the video is in.
        name: The name of the video.
        object_store: The object store to retrieve the video from.
        metadata_store: The metadata store to retrieve the metadata from.

    Returns:
        A `StreamingResponse` object containing the video.

    """
    logger.info("Getting video {} in bucket {}.", name, bucket)

    object_id = ObjectRef(bucket=bucket, name=name)
    with check_key_errors():
        async with asyncio.TaskGroup() as tasks:
            object_task = tasks.create_task(object_store.get_object(object_id))
            metadata_task = tasks.create_task(metadata_store.get(object_id))

    # Determine the proper MIME type for the video.
    metadata = metadata_task.result()
    mime_type = _VIDEO_FORMAT_TO_MIME_TYPES[metadata.format]

    return StreamingResponse(
        object_task.result(),
        media_type=mime_type,
        # TODO (danielp) Re-enable content length once we can be sure that
        #  saved sizes are correct.
        # headers={"Content-Length": str(metadata.size)},
    )


@router.get("/preview/{bucket}/{name}")
async def get_preview(
    bucket: str,
    name: str,
    object_store: ObjectStore = Depends(backends.object_store),
) -> StreamingResponse:
    """
    Retrieves a preview from the server.

    Args:
        bucket: The bucket the thumbnail is in.
        name: The name of the thumbnail.
        object_store: The object store to use.

    Returns:
        A `StreamingResponse` object containing the thumbnail.

    """
    logger.info("Getting preview for video {} in bucket {}.", name, bucket)

    object_id = ObjectRef(bucket=bucket, name=name)
    preview_object_id = derived_id(object_id, suffix="preview")
    try:
        preview_stream = await object_store.get_object(preview_object_id)
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail="Requested video preview could not be found.",
        )

    return StreamingResponse(preview_stream, media_type="video/vp9")


@router.post("/metadata", response_model=MetadataResponse)
async def find_video_metadata(
    videos: List[ObjectRef] = Body(...),
    metadata_store: ArtifactMetadataStore = Depends(
        backends.video_metadata_store
    ),
) -> MetadataResponse:
    """
    Retrieves the metadata for a set of videos.

    Args:
        videos: The videos to retrieve the metadata for.
        metadata_store: The metadata store to use.

    Returns:
        A `MetadataResponse` object containing the metadata for the videos.

    """
    return MetadataResponse(
        metadata=await get_metadata(videos, metadata_store=metadata_store)
    )


@router.patch("/metadata/batch_update")
async def batch_update_metadata(
    metadata: UavVideoMetadata,
    videos: List[ObjectRef] = Body(...),
    increment_sequence: bool = False,
    metadata_store: MetadataStore = Depends(backends.video_metadata_store),
) -> None:
    """
    Updates the metadata for a large number of videos at once. Note that any
    parameters that are set to `None` in `metadata` will retain their
    original values.

    Args:
        metadata: The new metadata to set.
        videos: The set of existing images to update.
        increment_sequence: If this is true, the sequence number will be
            automatically incremented for each image added, starting at whatever
            value is set in `metadata`. In this case, the order of the images
            specified in `images` will determine session numbers.
        metadata_store: The metadata store to use.

    """
    metadata_store = cast(ArtifactMetadataStore, metadata_store)
    await update_metadata(
        metadata=metadata,
        artifacts=videos,
        increment_sequence=increment_sequence,
        metadata_store=metadata_store,
    )


@router.post("/metadata/infer", response_model=UavVideoMetadata)
async def infer_image_metadata(
    metadata: UavVideoMetadata = Depends(filled_uav_metadata),
) -> UavVideoMetadata:
    """
    Infers the metadata for a video.

    Args:
        metadata: Can be used to provide partial metadata to build on.

    Returns:
        The metadata that it was able to infer.

    """
    return metadata
