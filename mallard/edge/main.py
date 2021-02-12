"""
Main entry point edge server.
"""


from fastapi import FastAPI

from .routers import root

app = FastAPI(debug=True)
app.include_router(root.router)
