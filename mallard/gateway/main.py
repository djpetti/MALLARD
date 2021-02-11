"""
Main entry point for API.
"""


from fastapi import Depends, FastAPI
from loguru import logger

from .aiohttp_session import init_session, session
from .authentication import check_auth_token
from .config import config
from .routers import images

dependencies = []
if config["security"]["enable_auth"].get(bool):
    dependencies.append(Depends(check_auth_token))
else:
    logger.warning("Authentication has been disabled through the config file.")
app = FastAPI(debug=True, dependencies=dependencies)

app.include_router(images.router)


@app.on_event("startup")
async def init_aiohttp_session():
    """
    Properly initialize the `aiohttp` session.

    """
    await init_session()


@app.on_event("shutdown")
async def close_aiohttp_session():
    """
    Properly close the `aiohttp` session.

    """
    logger.debug("Closing aiohttp session.")
    await session.close()
