"""
API endpoints for managing video data.
"""

import asyncio
from typing import Annotated, List, cast

from aiohttp.client_exceptions import ClientPayloadError
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    File,
    Header,
    HTTPException,
    UploadFile,
)
from loguru import logger
from starlette.responses import StreamingResponse
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

from ...artifact_metadata import MissingLengthError
from ...backends import backend_manager as backends
from ...backends.metadata import (
    ArtifactMetadataStore,
    MetadataOperationError,
    MetadataStore,
)
from ...backends.metadata.schemas import UavVideoMetadata, VideoFormat
from ...backends.objects import ObjectStore
from ...backends.objects.models import ObjectRef, derived_id, unique_name
from ...backends.objects.s3_object_store import S3ObjectStore
from ..common import (
    check_key_errors,
    get_metadata,
    ignore_errors,
    update_metadata,
)
from ..dependencies import use_bucket_videos
from .schemas import CreateResponse, MetadataResponse
from .transcoder_client import (
    create_preview,
    create_streamable,
    create_thumbnail,
)
from .video_metadata import InvalidVideoError, fill_metadata

router = APIRouter(prefix="/videos", tags=["videos"])

background_task_retry = retry(
    retry=retry_if_exception_type(ClientPayloadError),
    wait=wait_random_exponential(multiplier=1, max=60),
    after=lambda *_: logger.warning("Retrying background task..."),
    stop=stop_after_attempt(10),
)


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


async def _fill_metadata(
    metadata: UavVideoMetadata,
    video_file: UploadFile,
    saved_video: ObjectRef | None = None,
) -> UavVideoMetadata:
    """
    Fills UAV video metadata with proper error handling.

    Args:
        metadata: Any existing metadata we have.
        video_file: The raw video data to infer from.
        saved_video: The reference to the video in the object store,
            if we have it.

    Returns:
        A copy of the metadata with missing fields filled.

    Raises:
        `HTTPException` if auto-filling the metadata failed.

    """
    try:
        return await fill_metadata(
            metadata, video=video_file, saved_video=saved_video
        )
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
    return await _fill_metadata(metadata, video_data)


@router.post("/create_uav", response_model=CreateResponse, status_code=201)
async def create_uav_video(
    metadata: UavVideoMetadata = Depends(UavVideoMetadata.as_form),
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
    await object_store.create_object(object_id, data=video_data)

    # Infer the metadata and save it.
    try:
        metadata = await _fill_metadata(
            metadata, video_file=video_data, saved_video=object_id
        )
        await metadata_store.add(object_id=object_id, metadata=metadata)
    except (MetadataOperationError, HTTPException) as error:
        # If one operation fails, it would be best to try and roll back the
        # other.
        logger.info("Rolling back object creation {} upon error.", object_id)
        await object_store.delete_object(object_id)
        raise error

    # Create and save the preview.
    thumbnail_object_id = derived_id(object_id, "thumbnail")
    preview_object_id = derived_id(object_id, "preview")
    streamable_object_id = derived_id(object_id, "streamable")

    # Background tasks can be dispatched now that the video is added to the
    # object store.
    @background_task_retry
    async def _create_preview() -> None:
        logger.debug("Starting video preview background task...")
        preview = create_preview(
            object_id, chunk_size=ObjectStore.UPLOAD_CHUNK_SIZE
        )
        await object_store.create_object(preview_object_id, data=preview)
        logger.debug("Finished video preview background task.")

    @background_task_retry
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


# TODO (danielp) This is a debugging-only endpoint that should eventually be
#  removed.
@router.post("/rerun_video_processing/{bucket}/{name}")
async def rerun_video_processing(
    bucket: str,
    name: str,
    background_tasks: BackgroundTasks = BackgroundTasks,
    object_store: ObjectStore = Depends(backends.object_store),
) -> None:  # pragma: no coverage
    """
    Reruns the background processing tasks for an existing video.

    Args:
        bucket: The bucket the video is in.
        name: The name of the video.
        background_tasks: Handle to use for submitting background tasks.
        object_store: The object store to verify the video object.

    """
    # Create the object reference for the existing video.
    object_id = ObjectRef(bucket=bucket, name=name)
    logger.info("Regenerating tasks for video {} in bucket {}.", name, bucket)

    # Check if the video object exists
    if not await object_store.object_exists(object_id):
        raise HTTPException(status_code=404, detail="Video not found.")

    # Create the preview and streamable tasks.
    @background_task_retry
    async def _create_preview() -> None:
        logger.debug("Starting video preview background task...")
        preview = create_preview(
            object_id, chunk_size=ObjectStore.UPLOAD_CHUNK_SIZE
        )
        await object_store.create_object(
            derived_id(object_id, "preview"), data=preview
        )
        logger.debug("Finished video preview background task.")

    @background_task_retry
    async def _create_streamable() -> None:
        logger.debug("Starting video streamable background task...")
        streamable = create_streamable(
            object_id, chunk_size=ObjectStore.UPLOAD_CHUNK_SIZE
        )
        await object_store.create_object(
            derived_id(object_id, "streamable"), data=streamable
        )
        logger.debug("Finished video streamable background task.")

    background_tasks.add_task(_create_preview)
    background_tasks.add_task(_create_streamable)


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


@router.head("/{bucket}/{name}")
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
    data_range: str | None = None,
) -> StreamingResponse:
    """
    Retrieves a transcoded video from the server.

    Args:
        bucket: The bucket the video is in.
        name: The name of the video.
        suffix: The suffix to apply to the object id.
        object_store: The object store to use.
        data_range: Optional specifier for the range of data to read,
         in the same format as the HTTP `Range` header.

    Returns:
        A `StreamingResponse` object containing the thumbnail.

    """
    object_store = cast(S3ObjectStore, object_store)

    object_id = ObjectRef(bucket=bucket, name=name)
    preview_object_id = derived_id(object_id, suffix=suffix)
    try:
        preview_stream = await object_store.get_object(
            preview_object_id, data_range=data_range
        )
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail="Requested video could not be found.",
        )

    status_code = 200
    headers = {
        "Content-Length": str(len(preview_stream)),
        "Accept-Ranges": "bytes",
    }
    if data_range is not None:
        # We requested partial data.
        status_code = 206
        headers["Content-Range"] = preview_stream.content_range

        if preview_stream.content_range is None:
            # This can only happen if a range was provided but not valid.
            raise HTTPException(
                status_code=416, detail="Invalid range specified."
            )

    return StreamingResponse(
        preview_stream,
        status_code=status_code,
        media_type="video/webm",
        headers=headers,
    )


@router.head("/preview/{bucket}/{name}")
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


@router.head("/stream/{bucket}/{name}")
@router.get("/stream/{bucket}/{name}")
async def get_streamable(
    bucket: str,
    name: str,
    object_store: ObjectStore = Depends(backends.object_store),
    range_header: Annotated[str | None, Header(alias="range")] = None,
) -> StreamingResponse:
    """
    Retrieves a streaming-optimized version of the video from the server.

    Args:
        bucket: The bucket the video is in.
        name: The name of the video.
        object_store: The object store to use.
        range_header: The Range header from the request.

    Returns:
        A `StreamingResponse` object containing the video stream.
    """
    logger.info(
        "Getting streamable version of video {} in bucket {}.", name, bucket
    )
    return await _get_transcoded_video_stream(
        bucket=bucket,
        name=name,
        suffix="streamable",
        object_store=object_store,
        data_range=range_header,
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
