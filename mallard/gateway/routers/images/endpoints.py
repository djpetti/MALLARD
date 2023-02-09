"""
API endpoints for managing image data.
"""


import asyncio
import io
import uuid
from datetime import date, timedelta, timezone
from typing import List, cast

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
)
from loguru import logger
from PIL import Image
from starlette.responses import StreamingResponse

from ...async_utils import get_process_pool
from ...backends import backend_manager as backends
from ...backends.metadata import (
    ImageMetadataStore,
    MetadataOperationError,
    MetadataStore,
)
from ...backends.metadata.schemas import (
    ImageFormat,
    ImageQuery,
    Metadata,
    Ordering,
    UavImageMetadata,
)
from ...backends.objects import ObjectOperationError, ObjectStore
from ...backends.objects.models import ObjectRef
from .image_metadata import InvalidImageError, fill_metadata
from .schemas import CreateResponse, QueryResponse

router = APIRouter(prefix="/images", tags=["images"])


_IMAGE_FORMAT_TO_MIME_TYPES = {
    ImageFormat.GIF: "image/gif",
    ImageFormat.TIFF: "image/tiff",
    ImageFormat.JPEG: "image/jpeg",
    ImageFormat.BMP: "image/bmp",
    ImageFormat.PNG: "image/png",
}
"""
Maps image formats to corresponding MIME types.
"""

_THUMBNAIL_SIZE = (128, 128)
"""
Max size in pixels of generated thumbnails.
"""


def _thumbnail_id(object_id: ObjectRef) -> ObjectRef:
    """
    Transforms an object ID to the ID for the corresponding thumbnail.

    Args:
        object_id: The object ID.

    Returns:
        The ID for the corresponding thumbnail.

    """
    thumbnail_name = f"{object_id.name}.thumbnail"
    return ObjectRef(bucket=object_id.bucket, name=thumbnail_name)


def _create_thumbnail_sync(image: bytes) -> io.BytesIO:
    """
    Non-async version of `_create_thumbnail`. This is meant to be run in
    a separate process so as not to block the event loop.

    Args:
        image: The image data to create a thumbnail for.

    Returns:
        The thumbnail that it created.

    """
    pil_image = Image.open(io.BytesIO(image))
    pil_image.thumbnail(_THUMBNAIL_SIZE)
    # Make sure it's an RGB image.
    pil_image = pil_image.convert("RGB")

    # Save result as a JPEG.
    thumbnail = io.BytesIO()
    pil_image.save(thumbnail, format="jpeg")
    thumbnail.seek(0)

    return thumbnail


async def _create_thumbnail(image: bytes) -> io.BytesIO:
    """
    Generates a thumbnail from an input image.

    Args:
        image: The image to generate the thumbnail from.

    Returns:
        The generated thumbnail.

    """
    # Run in a separate process so we don't block the event loop.
    logger.debug("Creating thumbnail for image.")
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        get_process_pool(), _create_thumbnail_sync, image
    )


async def use_bucket(
    object_store: ObjectStore = Depends(backends.object_store),
) -> str:
    """
    Args:
        object_store: The object store to use.

    Returns:
        The bucket to use for saving new images. It will create it if it
        doesn't exist.

    """
    bucket_name = f"{date.today().isoformat()}-images"

    if not await object_store.bucket_exists(bucket_name):
        logger.debug("Creating a new bucket: {}", bucket_name)
        # We specify exists_ok because there is a possible race-condition if
        # it is servicing multiple requests concurrently.
        await object_store.create_bucket(bucket_name, exists_ok=True)

    return bucket_name


def user_timezone(tz: float = Query(..., ge=-24, le=24)) -> timezone:
    """
    Adds the user's current timezone offset as a query parameter so we can
    show correct timings.

    Args:
        tz: The offset of the user's local timezone from GMT, in hours.

    Returns:
        The offset of the user's local timezone from GMT, in hours.

    """
    return timezone(timedelta(hours=tz))


def filled_uav_metadata(
    metadata: UavImageMetadata = Depends(UavImageMetadata.as_form),
    image_data: UploadFile = File(...),
    local_tz: timezone = Depends(user_timezone),
) -> UavImageMetadata:
    """
    Intercepts requests containing UAV image metadata and fills in any missing
    fields from EXIF data.

    Args:
        metadata: The metadata sent in the request.
        image_data: The raw image data.
        local_tz: The local user's timezone offset from GMT.

    Returns:
        A copy of the metadata with missing fields filled.

    Raises:
        `HTTPException` if auto-filling the metadata failed.

    """
    try:
        return fill_metadata(metadata, local_tz=local_tz, image=image_data)
    except InvalidImageError:
        raise HTTPException(
            status_code=415,
            detail="The uploaded image has an invalid format, or does not "
            "match the specified format.",
        )


@router.post(
    "/create_uav",
    response_model=CreateResponse,
    status_code=201,
)
async def create_uav_image(
    metadata: UavImageMetadata = Depends(filled_uav_metadata),
    image_data: UploadFile = File(...),
    object_store: ObjectStore = Depends(backends.object_store),
    metadata_store: MetadataStore = Depends(backends.metadata_store),
    bucket: str = Depends(use_bucket),
) -> CreateResponse:
    """
    Uploads a new image captured from a UAV.

    Args:
        metadata: The image-specific metadata.
        image_data: The actual image file to upload.
        object_store: The object store to use.
        metadata_store: The metadata store to use.
        bucket: The bucket to use for new images.

    Returns:
        A `CreateResponse` object for this image.

    """
    # Since we are uploading images, the metadata store should be able to
    # handle them.
    metadata_store = cast(ImageMetadataStore, metadata_store)

    # We need the raw image data to create the thumbnail.
    image_bytes = await image_data.read()
    # Reset so we can read it again when storing it.
    await image_data.seek(0)

    # Create the image in the object store.
    unique_name = uuid.uuid4().hex
    object_id = ObjectRef(bucket=bucket, name=unique_name)
    logger.info("Creating a new image {} in bucket {}.", unique_name, bucket)
    object_task = asyncio.create_task(
        object_store.create_object(object_id, data=image_data)
    )

    # Create the corresponding metadata.
    metadata_task = asyncio.create_task(
        metadata_store.add(object_id=object_id, metadata=metadata)
    )

    # Create and save the thumbnail.
    thumbnail_object_id = _thumbnail_id(object_id)

    async def _create_and_save_thumbnail() -> None:
        thumbnail = await _create_thumbnail(image_bytes)
        await object_store.create_object(thumbnail_object_id, data=thumbnail)

    thumbnail_task = asyncio.create_task(_create_and_save_thumbnail())

    try:
        await asyncio.gather(object_task, metadata_task, thumbnail_task)
    except MetadataOperationError as error:
        # If one operation fails, it would be best to try and roll back the
        # other.
        logger.info("Rolling back object creation {} upon error.", object_id)
        await object_store.delete_object(object_id)
        await object_store.delete_object(thumbnail_object_id)
        raise error
    except ObjectOperationError as error:
        logger.info("Rolling back metadata add for {} upon error.", object_id)
        await metadata_store.delete(object_id)
        raise error

    return CreateResponse(image_id=object_id)


@router.delete("/delete/{bucket}/{name}")
async def delete_image(
    bucket: str,
    name: str,
    object_store: ObjectStore = Depends(backends.object_store),
    metadata_store: MetadataStore = Depends(backends.metadata_store),
) -> None:
    """
    Deletes an existing image from the server.

    Args:
        bucket: The bucket that the image is in.
        name: The name of the image.
        object_store: The object store to use.
        metadata_store: The metadata store to use.

    """
    logger.info("Deleting image {} in bucket {}.", name, bucket)
    object_id = ObjectRef(bucket=bucket, name=name)

    object_task = asyncio.create_task(object_store.delete_object(object_id))
    metadata_task = asyncio.create_task(metadata_store.delete(object_id))

    try:
        await asyncio.gather(object_task, metadata_task)
    except KeyError:
        # The image doesn't exist.
        raise HTTPException(
            status_code=404, detail="Requested image could not be found."
        )


@router.get("/{bucket}/{name}")
async def get_image(
    bucket: str,
    name: str,
    object_store: ObjectStore = Depends(backends.object_store),
    metadata_store: MetadataStore = Depends(backends.metadata_store),
) -> StreamingResponse:
    """
    Gets the contents of a specific image.

    Args:
        bucket: The bucket that the image is in.
        name: The name of the image.
        object_store: The object store to use.
        metadata_store: The metadata store to use.

    Returns:
        The binary contents of the image.

    """
    logger.debug("Getting image {} in bucket {}.", name, bucket)
    object_id = ObjectRef(bucket=bucket, name=name)

    object_task = asyncio.create_task(object_store.get_object(object_id))
    metadata_task = asyncio.create_task(metadata_store.get(object_id))

    try:
        image_stream, metadata = await asyncio.gather(
            object_task, metadata_task
        )
    except KeyError:
        # Cancel anything that's still pending to avoid extraneous work.
        object_task.cancel()
        metadata_task.cancel()

        # The image doesn't exist.
        raise HTTPException(
            status_code=404, detail="Requested image could not be found."
        )

    # Determine the proper MIME type to use.
    mime_type = _IMAGE_FORMAT_TO_MIME_TYPES[metadata.format]

    return StreamingResponse(image_stream, media_type=mime_type)


@router.get("/thumbnail/{bucket}/{name}")
async def get_thumbnail(
    bucket: str,
    name: str,
    object_store: ObjectStore = Depends(backends.object_store),
) -> StreamingResponse:
    """
    Gets the thumbnail for a specific image.

    Args:
        bucket: The bucket that the image is in.
        name: The name of the image.
        object_store: The object store to use.

    Returns:
        The binary contents of the thumbnail.

    """
    logger.debug("Getting thumbnail for image {} in bucket {}.", name, bucket)
    object_id = ObjectRef(bucket=bucket, name=name)

    thumbnail_object_id = _thumbnail_id(object_id)
    try:
        image_stream = await object_store.get_object(thumbnail_object_id)
    except KeyError:
        # The thumbnail doesn't exist.
        raise HTTPException(
            status_code=404,
            detail="Requested image thumbnail could not be found.",
        )

    return StreamingResponse(image_stream, media_type="image/jpeg")


@router.get("/metadata/{bucket}/{name}", response_model=UavImageMetadata)
async def get_image_metadata(
    bucket: str,
    name: str,
    metadata_store: MetadataStore = Depends(backends.metadata_store),
) -> Metadata:
    """
    Gets the complete metadata for an image.

    Args:
        bucket: The bucket that the image is in.
        name: The name of the image.
        metadata_store: The metadata store to use.

    Returns:
        The image metadata, in JSON form.

    """
    logger.debug("Getting metadata for image {} in bucket {}.", name, bucket)
    object_id = ObjectRef(bucket=bucket, name=name)

    try:
        metadata = await metadata_store.get(object_id)
    except KeyError:
        # The image doesn't exist.
        raise HTTPException(
            status_code=404,
            detail="Requested image metadata could not be found.",
        )

    return metadata


@router.patch("/metadata/batch_update")
async def batch_update_metadata(
    metadata: UavImageMetadata,
    images: List[ObjectRef] = Body(...),
    increment_sequence: bool = Query(False),
    metadata_store: MetadataStore = Depends(backends.metadata_store),
) -> None:
    """
    Updates the metadata for a large number of images at once. Note that any
    parameters that are set to `None` in `metadata` will retain their
    original values.

    Args:
        metadata: The new metadata to set.
        images: The set of existing images to update.
        increment_sequence: If this is true, the sequence number will be
            automatically incremented for each image added, starting at whatever
            value is set in `metadata`. In this case, the order of the images
            specified in `images` will determine session numbers.
        metadata_store: The metadata store to use.

    """
    # Since we are dealing with images, the metadata store should be able to
    # handle them.
    metadata_store = cast(ImageMetadataStore, metadata_store)

    update_tasks = []
    for image_id in images:
        update_tasks.append(
            asyncio.create_task(
                metadata_store.update(object_id=image_id, metadata=metadata)
            )
        )

        # Increment the sequence number if appropriate.
        if increment_sequence and metadata.sequence_number is not None:
            metadata = metadata.copy(
                update=dict(sequence_number=metadata.sequence_number + 1)
            )

    await asyncio.gather(*update_tasks)


@router.post("/metadata/infer", response_model=UavImageMetadata)
async def infer_image_metadata(
    metadata: UavImageMetadata = Depends(filled_uav_metadata),
) -> UavImageMetadata:
    """
    Infers the metadata for an image.

    Args:
        metadata: Can be used to provide partial metadata to build on.

    Returns:
        The metadata that it was able to infer.

    """
    return metadata


@router.post("/query", response_model=QueryResponse)
async def query_images(
    query: ImageQuery = ImageQuery(),
    orderings: List[Ordering] = Body([]),
    results_per_page: int = Query(50, gt=0),
    page_num: int = Query(1, gt=0),
    metadata_store: MetadataStore = Depends(backends.metadata_store),
) -> QueryResponse:
    """
    Performs a query for images that meet certain criteria.

    Args:
        query: Specifies the query to perform.
        orderings: Specifies a specific ordering for the final results. It
            will first sort by the first ordering specified, then the
            second, etc.
        results_per_page: The maximum number of results to include in a
            single response.
        page_num: If there are multiple pages of results, this can be used to
            specify a later page.
        metadata_store: The metadata store to use.

    Returns:
        The query response.

    """
    logger.debug("Querying for images that match {}.", query)
    # First, we assume that this particular backend can query images.
    metadata = cast(ImageMetadataStore, metadata_store)

    skip_first = (page_num - 1) * results_per_page
    results = metadata.query(
        [query],
        skip_first=skip_first,
        max_num_results=results_per_page,
        orderings=orderings,
    )

    # Get all the results.
    image_ids = [r async for r in results]
    logger.debug("Query produced {} results.", len(image_ids))
    # This logic can result in the final page being empty, which is a
    # deliberate design decision.
    is_last_page = len(image_ids) < results_per_page

    return QueryResponse(
        image_ids=image_ids, page_num=page_num, is_last_page=is_last_page
    )
