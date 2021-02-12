"""
Main entry point edge server.
"""


from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from loguru import logger

from .routers import root

_PACKAGE_DIR = Path(__file__).parent
"""
The directory containing this package.
"""


app = FastAPI(debug=True)
app.include_router(root.router)

js_dir = _PACKAGE_DIR / "frontend" / "bundled"
logger.debug("Using JS static directory: {}", js_dir)
app.mount("/static/js", StaticFiles(directory=js_dir.as_posix()))
