"""
Main entry point for the transcoder service.
"""


from fastapi import FastAPI

from .routers import root

app = FastAPI(debug=True)
app.include_router(root.router)
