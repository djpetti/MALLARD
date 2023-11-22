"""
Main entry point edge server.
"""


from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from loguru import logger

from ..logger import config_logger
from .routers import root

_PACKAGE_DIR = Path(__file__).parent
"""
The directory containing this package.
"""


config_logger("edge")

app = FastAPI(debug=True)
app.include_router(root.router)

js_dir = _PACKAGE_DIR / "frontend" / "bundled"
logger.debug("Using static directory: {}", js_dir)
app.mount("/static", StaticFiles(directory=js_dir.as_posix()))
