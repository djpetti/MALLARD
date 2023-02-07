"""
Main entry point for API gateway.
"""


from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from ..config import config
from .aiohttp_session import init_session, close_session
from .authentication import check_auth_token
from .routers import images

dependencies = []
if config["security"]["enable_auth"].get(bool):
    dependencies.append(Depends(check_auth_token))
else:
    logger.warning("Authentication has been disabled through the config file.")
app = FastAPI(debug=True, dependencies=dependencies)

app.include_router(images.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config["security"]["api_origins"].as_str_seq(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    await close_session()
