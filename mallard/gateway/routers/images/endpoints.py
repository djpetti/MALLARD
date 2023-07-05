"""
API endpoints for managing image data.
"""


import asyncio
import io
import uuid
from datetime import timezone
from typing import List, cast

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from loguru import logger
from PIL import Image
from starlette.responses import StreamingResponse

from ...artifact_metadata import MissingLengthError
from ...async_utils import get_process_pool
from ...backends import backend_manager as backends
from ...backends.metadata import (
    ArtifactMetadataStore,
    MetadataOperationError,
    MetadataStore,
)
from ...backends.metadata.schemas import ImageFormat, UavImageMetadata
from ...backends.objects import ObjectOperationError, ObjectStore
from ...backends.objects.models import ObjectRef, derived_id
from ...dependencies import use_bucket_images, user_timezone
from ..common import check_key_errors, get_metadata, update_metadata
from .image_metadata import InvalidImageError, fill_metadata
from .schemas import CreateResponse, MetadataResponse

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


async def filled_uav_metadata(
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
        return await fill_metadata(
            metadata, local_tz=local_tz, image=image_data
        )
    except InvalidImageError:
        raise HTTPException(
            status_code=415,
            detail="The uploaded image has an invalid format, or does not "
            "match the specified format.",
        )
    except MissingLengthError:
        raise HTTPException(
            status_code=411,
            detail="You must provide a size for the uploaded image, either in "
            "the metadata, or in the content-length header.",
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
    metadata_store: ArtifactMetadataStore = Depends(
        backends.image_metadata_store
    ),
    bucket: str = Depends(use_bucket_images),
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
    thumbnail_object_id = derived_id(object_id, "thumbnail")

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


@router.delete("/delete")
async def delete_images(
    images: List[ObjectRef] = Body(...),
    object_store: ObjectStore = Depends(backends.object_store),
    metadata_store: MetadataStore = Depends(backends.image_metadata_store),
) -> None:
    """
    Deletes existing images from the server.

    Args:
        images: The images to delete.
        object_store: The object store to use.
        metadata_store: The metadata store to use.

    """
    logger.info("Deleting {} images.", len(images))

    with check_key_errors():
        async with asyncio.TaskGroup() as tasks:
            for image in images:
                tasks.create_task(object_store.delete_object(image))
                tasks.create_task(metadata_store.delete(image))


@router.get("/{bucket}/{name}")
async def get_image(
    bucket: str,
    name: str,
    object_store: ObjectStore = Depends(backends.object_store),
    metadata_store: MetadataStore = Depends(backends.image_metadata_store),
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

    return StreamingResponse(
        image_stream,
        media_type=mime_type,
        # TODO (danielp) Re-enable content length once we can be sure that
        #  saved sizes are correct.
        # headers={"Content-Length": str(metadata.size)},
    )


@router.post("/metadata", response_model=MetadataResponse)
async def find_image_metadata(
    images: List[ObjectRef] = Body(...),
    metadata_store: MetadataStore = Depends(backends.image_metadata_store),
) -> MetadataResponse:
    """
    Retrieves the metadata for a set of images.

    Args:
        images: The set of images to get metadata for.
        metadata_store: The metadata store to use.

    Returns:
        The corresponding metadata for each image, in JSON form.

    """
    return MetadataResponse(
        metadata=await get_metadata(images, metadata_store=metadata_store)
    )


@router.patch("/metadata/batch_update")
async def batch_update_metadata(
    metadata: UavImageMetadata,
    images: List[ObjectRef] = Body(...),
    increment_sequence: bool = False,
    metadata_store: MetadataStore = Depends(backends.image_metadata_store),
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
    metadata_store = cast(ArtifactMetadataStore, metadata_store)
    await update_metadata(
        metadata=metadata,
        artifacts=images,
        increment_sequence=increment_sequence,
        metadata_store=metadata_store,
    )


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
