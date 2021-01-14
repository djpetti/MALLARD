"""
API endpoints for managing image data.
"""


from uuid import UUID

from faker import Faker
from fastapi import APIRouter, Depends, File, UploadFile
from starlette.responses import StreamingResponse

from mallard.backends.metadata.models import UavImageMetadata
from mallard.routers.images.tests.faker_providers import ImageProvider

from .models import CreateResponse, Query, QueryResponse

router = APIRouter(prefix="/images", tags=["images"])


g_faker = Faker()
g_faker.add_provider(ImageProvider)


@router.post(
    "/create_uav",
    response_model=CreateResponse,
    status_code=201,
)
async def create_uav_image(
    metadata: UavImageMetadata = Depends(UavImageMetadata.as_form),
    image_data: UploadFile = File(...),
) -> CreateResponse:
    """
    Uploads a new image captured from a UAV.

    Args:
        metadata: The image-specific metadata.
        image_data: The actual image file to upload.

    Returns:
        A `CreateResponse` object for this image.

    """
    return g_faker.create_response()


@router.delete("/delete/{image_id}")
async def delete_image(image_id: UUID) -> None:
    """
    Deletes an existing image from the server.

    Args:
        image_id: The unique ID of the image to delete.

    """


@router.get("/{image_id}")
async def get_image(image_id: UUID) -> StreamingResponse:
    """
    Gets the contents of a specific image.

    Args:
        image_id: The unique ID of the image to get.

    Returns:
        The binary contents of the image.

    """
    image_stream = g_faker.image(formats={"jpeg"})
    return StreamingResponse(image_stream, media_type="image/jpeg")


@router.post("/query")
async def query_images(
    query: Query, results_per_page: int = 50, page_num: int = 1
) -> QueryResponse:
    """
    Performs a query for images that meet certain criteria.

    Args:
        query: Specifies the query to perform.
        results_per_page: The maximum number of results to include in a
            single response.
        page_num: If there are multiple pages of results, this can be used to
            specify a later page.

    Returns:
        The query response.

    """
    return g_faker.query_response()
