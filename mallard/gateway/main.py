"""
Main entry point for API gateway.
"""


from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from ..config import config
from .authentication import get_auth
from .routers import images, root, videos

dependencies = []
if not config["security"]["enable_auth"].get(bool):
    logger.warning("Authentication has been disabled through the config file.")
else:
    dependencies.append(Depends(get_auth().authenticated()))
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
