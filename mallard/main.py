"""
Main entry point for API.
"""


from fastapi import FastAPI

from .routers import images

app = FastAPI(debug=True)

app.include_router(images.router)
