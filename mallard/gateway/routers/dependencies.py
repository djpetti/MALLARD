"""
Dependencies that are common to multiple routers.
"""


from datetime import date, timedelta, timezone
from typing import Annotated

from fastapi import Depends, Query
from loguru import logger

from ..backends import backend_manager as backends
from ..backends.objects import ObjectStore

_IMAGE_BUCKET = "mallard-images"
"""
Name of the bucket to use for images.
"""
_VIDEO_BUCKET = "mallard-videos"
"""
Name of the bucket to use for videos.
"""


def user_timezone(tz: Annotated[float, Query(..., ge=-24, le=24)]) -> timezone:
    """
    Adds the user's current timezone offset as a query parameter so we can
    show correct timings.

    Args:
        tz: The offset of the user's local timezone from GMT, in hours.

    Returns:
        The offset of the user's local timezone from GMT, in hours.

    """
    return timezone(timedelta(hours=tz))


async def _use_bucket(object_store: ObjectStore, *, bucket_name: str) -> str:
    """
    Args:
        object_store: The object store to use.
        bucket_name: The name of the bucket.

    Returns:
        The bucket to use for saving new artifacts. It will create it if it
        doesn't exist.

    """
    if not await object_store.bucket_exists(bucket_name):
        logger.debug("Creating a new bucket: {}", bucket_name)
        # We specify exists_ok because there is a possible race-condition if
        # it is servicing multiple requests concurrently.
        await object_store.create_bucket(bucket_name, exists_ok=True)

    return bucket_name


async def use_bucket_images(
    object_store: ObjectStore = Depends(backends.object_store),
) -> str:
    """
    Args:
        object_store: The object store to use.

    Returns:
        The bucket to use for saving new images. It will create it if it
        doesn't exist.

    """
    return await _use_bucket(object_store, bucket_name=_IMAGE_BUCKET)


async def use_bucket_videos(
    object_store: ObjectStore = Depends(backends.object_store),
) -> str:
    """
    Args:
        object_store: The object store to use.

    Returns:
        The bucket to use for saving new videos. It will create it if it
        doesn't exist.

    """
    return await _use_bucket(object_store, bucket_name=_VIDEO_BUCKET)
