"""
Routs for endpoints common to all artifact types.
"""
from typing import Annotated, List, cast

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from loguru import logger
from starlette.responses import StreamingResponse

from mallard.gateway.backends import backend_manager as backends
from mallard.gateway.backends.metadata import (
    ArtifactMetadataStore,
    MetadataStore,
)
from mallard.gateway.backends.metadata.schemas import ImageQuery, Ordering
from mallard.gateway.backends.objects import ObjectStore
from mallard.gateway.backends.objects.models import ObjectRef, derived_id
from mallard.gateway.routers.root.schemas import QueryResponse

router = APIRouter()


@router.post("/query", response_model=QueryResponse)
async def query_artifacts(
    queries: List[ImageQuery] = Body([ImageQuery()]),
    orderings: List[Ordering] = Body([]),
    results_per_page: Annotated[int, Query(gt=0)] = 50,
    page_num: Annotated[int, Query(gt=0)] = 1,
    metadata_store: MetadataStore = Depends(backends.artifact_metadata_store),
) -> QueryResponse:
    """
    Performs a query for artifacts that meet certain criteria.

    Args:
        queries: Specifies the queries to perform.
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
    logger.debug(
        "Querying for images that match {}.",
        " OR ".join((str(q) for q in queries)),
    )
    # First, we assume that this particular backend can query images.
    metadata = cast(ArtifactMetadataStore, metadata_store)

    skip_first = (page_num - 1) * results_per_page
    results = metadata.query(
        queries,
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
    logger.debug(
        "Getting thumbnail for artifact {} in bucket {}.", name, bucket
    )
    object_id = ObjectRef(bucket=bucket, name=name)

    thumbnail_object_id = derived_id(object_id, suffix="thumbnail")
    try:
        image_stream = await object_store.get_object(thumbnail_object_id)
    except KeyError:
        # The thumbnail doesn't exist.
        raise HTTPException(
            status_code=404,
            detail="Requested thumbnail could not be found.",
        )

    return StreamingResponse(image_stream, media_type="image/jpeg")
