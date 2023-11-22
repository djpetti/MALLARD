"""
API endpoints for managing video data.
"""
import asyncio
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
from ...backends.objects.models import ObjectRef, derived_id, unique_name
from ..common import (
    check_key_errors,
    get_metadata,
    ignore_errors,
    update_metadata,
)
from .schemas import CreateResponse, MetadataResponse
from .transcoder_client import (
    create_preview,
    create_streamable,
    create_thumbnail,
)
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
    VideoFormat.MPEG4: "video/x-msvideo",
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
    except InvalidVideoError as error:
        logger.exception(error)
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
    object_id = ObjectRef(bucket=bucket, name=unique_name())
    logger.info(
        "Creating a new video {} in bucket {}.", object_id.name, bucket
    )
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
    streamable_object_id = derived_id(object_id, "streamable")

    # Background tasks can be dispatched now that the video is added to the
    # object store.
    async def _create_preview() -> None:
        logger.debug("Starting video preview background task...")
        preview = create_preview(
            object_id, chunk_size=ObjectStore.UPLOAD_CHUNK_SIZE
        )
        await object_store.create_object(preview_object_id, data=preview)
        logger.debug("Finished video preview background task.")

    async def _create_streamable() -> None:
        logger.debug("Starting video streamable background task...")
        streamable = create_streamable(
            object_id, chunk_size=ObjectStore.UPLOAD_CHUNK_SIZE
        )
        await object_store.create_object(streamable_object_id, data=streamable)
        logger.debug("Finished video streamable background task.")

    background_tasks.add_task(_create_preview)
    background_tasks.add_task(_create_streamable)

    # Create the thumbnail.
    thumbnail = create_thumbnail(
        object_id, chunk_size=ObjectStore.UPLOAD_CHUNK_SIZE
    )
    await object_store.create_object(thumbnail_object_id, data=thumbnail)

    return CreateResponse(video_id=object_id)


@router.post("/fix_names")
async def fix_names(
    bucket: str = Depends(use_bucket_videos),
    object_store: ObjectStore = Depends(backends.object_store),
    background_tasks: BackgroundTasks = BackgroundTasks,
) -> None:
    async def _rename() -> None:
        logger.info("Fixing objects in bucket {}...", bucket)
        await object_store.copy_bucket(bucket)
        logger.info("Done fixing {}.", bucket)

    background_tasks.add_task(_rename)


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
                tasks.create_task(metadata_store.delete(video))

                tasks.create_task(object_store.delete_object(video))
                # Thumbnail creation can sometimes fail if the upload process
                # is interrupted.
                tasks.create_task(
                    ignore_errors(
                        object_store.delete_object(
                            derived_id(video, "thumbnail")
                        )
                    )
                )

                # These are created as background tasks, and could
                # potentially fail if the video is deleted before the tasks
                # are finished.
                tasks.create_task(
                    ignore_errors(
                        object_store.delete_object(
                            derived_id(video, "preview")
                        )
                    )
                )
                tasks.create_task(
                    ignore_errors(
                        object_store.delete_object(
                            derived_id(video, "streamable")
                        )
                    )
                )


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
        headers={
            "Content-Length": str(metadata.size),
            "Content-Disposition": f'attachment; filename= "{metadata.name}"',
        },
    )


async def _get_transcoded_video_stream(
    *,
    bucket: str,
    name: str,
    suffix: str,
    object_store: ObjectStore,
) -> StreamingResponse:
    """
    Retrieves a transcoded video from the server.

    Args:
        bucket: The bucket the video is in.
        name: The name of the video.
        suffix: The suffix to apply to the object id.
        object_store: The object store to use.

    Returns:
        A `StreamingResponse` object containing the thumbnail.

    """
    object_id = ObjectRef(bucket=bucket, name=name)
    preview_object_id = derived_id(object_id, suffix=suffix)
    try:
        preview_stream = await object_store.get_object(preview_object_id)
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail="Requested video could not be found.",
        )

    return StreamingResponse(preview_stream, media_type="video/vp9")


@router.get("/preview/{bucket}/{name}")
async def get_preview(
    bucket: str,
    name: str,
    object_store: ObjectStore = Depends(backends.object_store),
) -> StreamingResponse:
    """
    Retrieves a preview from the server.

    Args:
        bucket: The bucket the video is in.
        name: The name of the video.
        object_store: The object store to use.

    Returns:
        A `StreamingResponse` object containing the thumbnail.

    """
    logger.info("Getting preview for video {} in bucket {}.", name, bucket)
    return await _get_transcoded_video_stream(
        bucket=bucket, name=name, suffix="preview", object_store=object_store
    )


@router.get("/stream/{bucket}/{name}")
async def get_streamable(
    bucket: str,
    name: str,
    object_store: ObjectStore = Depends(backends.object_store),
) -> StreamingResponse:
    """
    Retrieves a streaming-optimized version of the video from the server.

    Args:
        bucket: The bucket the video is in.
        name: The name of the video.
        object_store: The object store to use.

    Returns:
        A `StreamingResponse` object containing the thumbnail.

    """
    logger.info(
        "Getting streamable version of video {} in bucket {}.", name, bucket
    )
    return await _get_transcoded_video_stream(
        bucket=bucket,
        name=name,
        suffix="streamable",
        object_store=object_store,
    )


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
async def infer_video_metadata(
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
