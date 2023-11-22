"""
Handles custom logger configuration.
"""


import sys
from pathlib import Path

from loguru import logger

_LOG_DIR = Path("/logs")
if not _LOG_DIR.exists():
    # This probably means we're running outside of Docker. Just write to the
    # current directory.
    _LOG_DIR = Path(".")
"""
Default log directory to use.
"""


def config_logger(name: str) -> None:
    """
    Configures the default logger.

    Args:
        name: The name to use for the log file.

    """
    logger.remove()

    # Log more important stuff to the console.
    logger.add(sys.stderr, level="INFO")
    logger.add(
        _LOG_DIR / f"{name}.log",
        level="DEBUG",
        enqueue=True,
        rotation="00:00",
        retention="30 days",
        compression="zip",
    )
