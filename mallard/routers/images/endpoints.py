"""
API endpoints for managing image data.
"""


import asyncio
import uuid
from datetime import date, timedelta, timezone
from typing import cast

import aioitertools
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from loguru import logger
from starlette.responses import StreamingResponse

from ...backends import BackendManager
from ...backends.metadata import ImageMetadataStore, MetadataOperationError
from ...backends.metadata.models import ImageQuery, UavImageMetadata
from ...backends.objects import ObjectOperationError
from ...backends.objects.models import ObjectRef
from .image_metadata import fill_metadata
from .models import CreateResponse, QueryResponse

router = APIRouter(prefix="/images", tags=["images"])


async def use_bucket(
    backends: BackendManager = Depends(BackendManager.depend),
) -> str:
    """
    Returns:
        The bucket to use for saving new images. It will create it if it
        doesn't exist.

    """
    bucket_name = f"{date.today().isoformat()}_images"

    if not await backends.object_store.bucket_exists(bucket_name):
        logger.debug("Creating a new bucket: {}", bucket_name)
        await backends.object_store.create_bucket(bucket_name)

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

    """
    return fill_metadata(metadata, local_tz=local_tz, image=image_data)


@router.post(
    "/create_uav",
    response_model=CreateResponse,
    status_code=201,
)
async def create_uav_image(
    metadata: UavImageMetadata = Depends(filled_uav_metadata),
    image_data: UploadFile = File(...),
    backends: BackendManager = Depends(BackendManager.depend),
    bucket: str = Depends(use_bucket),
) -> CreateResponse:
    """
    Uploads a new image captured from a UAV.

    Args:
        metadata: The image-specific metadata.
        image_data: The actual image file to upload.
        backends: Used to access storage backends.
        bucket: The bucket to use for new images.

    Returns:
        A `CreateResponse` object for this image.

    """
    # Create the image in the object store.
    unique_name = uuid.uuid4().hex
    object_id = ObjectRef(bucket=bucket, name=unique_name)
    logger.info("Creating a new image {} in bucket {}.", unique_name, bucket)
    object_task = asyncio.create_task(
        backends.object_store.create_object(object_id, data=image_data)
    )

    # Create the corresponding metadata.
    metadata_task = asyncio.create_task(
        backends.metadata_store.add(object_id=object_id, metadata=metadata)
    )
    try:
        await asyncio.gather(object_task, metadata_task)
    except MetadataOperationError as error:
        # If one operation fails, it would be best to try and roll back the
        # other.
        logger.info("Rolling back object creation {} upon error.", object_id)
        await backends.object_store.delete_object(object_id)
        raise error
    except ObjectOperationError as error:
        logger.info("Rolling back metadata add for {} upon error.", object_id)
        await backends.metadata_store.delete(object_id)
        raise error

    return CreateResponse(image_id=object_id)


@router.delete("/delete/{bucket}/{name}")
async def delete_image(
    bucket: str,
    name: str,
    backends: BackendManager = Depends(BackendManager.depend),
) -> None:
    """
    Deletes an existing image from the server.

    Args:
        bucket: The bucket that the image is in.
        name: The name of the image.
        backends: Used to access storage backends.

    """
    logger.info("Deleting image {} in bucket {}.", name, bucket)
    object_id = ObjectRef(bucket=bucket, name=name)

    object_task = asyncio.create_task(
        backends.object_store.delete_object(object_id)
    )
    metadata_task = asyncio.create_task(
        backends.metadata_store.delete(object_id)
    )

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
    backends: BackendManager = Depends(BackendManager.depend),
) -> StreamingResponse:
    """
    Gets the contents of a specific image.

    Args:
        bucket: The bucket that the image is in.
        name: The name of the image.
        backends: Used to access storage backends.

    Returns:
        The binary contents of the image.

    """
    logger.debug("Getting image {} in bucket {}.", name, bucket)
    object_id = ObjectRef(bucket=bucket, name=name)

    try:
        image_stream = await backends.object_store.get_object(object_id)
    except KeyError:
        # The image doesn't exist.
        raise HTTPException(
            status_code=404, detail="Requested image could not be found."
        )

    return StreamingResponse(image_stream)


@router.post("/query")
async def query_images(
    query: ImageQuery,
    results_per_page: int = Query(50, gt=0),
    page_num: int = Query(1, gt=0),
    backends: BackendManager = Depends(BackendManager.depend),
) -> QueryResponse:
    """
    Performs a query for images that meet certain criteria.

    Args:
        query: Specifies the query to perform.
        results_per_page: The maximum number of results to include in a
            single response.
        page_num: If there are multiple pages of results, this can be used to
            specify a later page.
        backends: Used to access storage backends.

    Returns:
        The query response.

    """
    logger.debug("Querying for images that match {}.", query)
    # First of all, we assume that this particular backend can query images.
    metadata = cast(ImageMetadataStore, backends.metadata_store)

    skip_first = (page_num - 1) * results_per_page
    results = await metadata.query(query, skip_first=skip_first)

    # Limit the query results to one page.
    page_results = aioitertools.islice(results, results_per_page)
    # Get all the results.
    image_ids = [r async for r in page_results]
    logger.debug("Query produced {} results.", len(image_ids))
    # This logic can result in the final page being empty, which is a
    # deliberate design decision.
    is_last_page = len(image_ids) < results_per_page

    return QueryResponse(
        image_ids=image_ids, page_num=page_num, is_last_page=is_last_page
    )
