"""
Main entry point for the transcoder service.
"""


from fastapi import FastAPI

from ..logger import config_logger
from .routers import root

config_logger("transcoder")

app = FastAPI(debug=True)
app.include_router(root.router)
