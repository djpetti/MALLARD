"""
Custom `UvicornWorker` subclass that facilitates running under
Gunicorn.
"""


from starlette.config import Config
from uvicorn.workers import UvicornWorker

config = Config()


class ConfigurableWorker(UvicornWorker):
    """
    Custom `UvicornWorker` subclass that facilitates running under
    Gunicorn.
    """

    # Command-line options passed to uvicorn.
    CONFIG_KWARGS = {
        "root_path": config("SCRIPT_NAME", default=""),
        "proxy_headers": True,
    }
