"""
Root endpoints for the edge service.
"""


from typing import Any

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from ....config import config
from ...template_engine import template_environment

router = APIRouter()


async def _render_template(
    template_name: str, fragment: bool, **kwargs: Any
) -> str:
    """
    Renders a template.

    Args:
        template_name: The template to render.
        fragment: Whether to render a fragment or the whole page.
        **kwargs: Will be forwarded to `render_async`.

    Returns:
        The rendered template.

    """
    template = template_environment.get_template(template_name)
    return await template.render_async(
        fragment=fragment,
        api_base_url=config["api_base_url"].as_str(),
        **kwargs
    )


@router.get("/", response_class=HTMLResponse)
async def get_index(fragment: bool = False) -> str:
    """
    Handler for the default path.

    fragment: If false, it will render the entire page. Otherwise,
            it will render only the fragment, suitable for loading
            via AJAX.

    Returns:
        The HTML response.

    """
    return await _render_template("index.html", fragment=fragment)


@router.get("/details/{bucket}/{name}", response_class=HTMLResponse)
async def get_details(bucket: str, name: str, fragment: bool = False) -> str:
    """
    Handler for the details page.

    Args:
        bucket: The bucket that the image is in.
        name: The name of the image.
        fragment: If false, it will render the entire page. Otherwise,
            it will render only the fragment, suitable for loading
            via AJAX.

    Returns:
        The HTML response.

    """
    return await _render_template(
        "details.html", image_bucket=bucket, image_name=name, fragment=fragment
    )
