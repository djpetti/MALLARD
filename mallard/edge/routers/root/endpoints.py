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
