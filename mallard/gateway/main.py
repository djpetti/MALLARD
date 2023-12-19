"""
Main entry point for API gateway.
"""


from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from ..config import config
from ..logger import config_logger
from .authentication import flexible_token
from .routers import images, root, videos

config_logger("gateway")


async def _dummy_token(auth_token: str | None = None) -> None:
    if auth_token is not None:
        logger.warning("auth_token provided, but auth is disabled. Ignoring.")


dependencies = []
if not config["security"]["enable_auth"].get(bool):
    logger.warning("Authentication has been disabled through the config file.")
    # Add a dummy dependency here, so that the API at least stays consistent.
    dependencies.append(Depends(_dummy_token))
else:
    dependencies.append(Depends(flexible_token))
app = FastAPI(debug=True, dependencies=dependencies)

app.include_router(images.router)
app.include_router(videos.router)
app.include_router(root.router)

allowed_origins = config["security"]["api_origins"].as_str_seq()
logger.debug("Allowing requests from origins: {}", allowed_origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
