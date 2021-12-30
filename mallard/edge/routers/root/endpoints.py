"""
Root endpoints for the edge service.
"""


from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from ...template_engine import template_environment

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def get_index() -> str:
    """
    Handler for the default path.

    Returns:
        The HTML response.

    """
    template = template_environment.get_template("index.html")
    return await template.render_async()


@router.get("/details/{bucket}/{name}", response_class=HTMLResponse)
async def get_details(bucket: str, name: str) -> str:
    """
    Handler for the details page.

    Args:
        bucket: The bucket that the image is in.
        name: The name of the image.

    Returns:
        The HTML response.

    """
    template = template_environment.get_template("details.html")
    return await template.render_async(
        show_back=True, image_bucket=bucket, image_name=name
    )
