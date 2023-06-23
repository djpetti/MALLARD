"""
This module exists purely to provide a global session for `aiohttp`.
"""


from functools import partial
from typing import Any

import aiohttp
from loguru import logger


class Session:
    """
    Wrapper around a session that allows it to be used with FastAPI's
    dependency injection system.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        """
        Args:
            *args: Will be forwarded to `ClientSession`.
            **kwargs: Will be forwarded to `ClientSession`.
        """
        self.__session_maker = partial(aiohttp.ClientSession, *args, **kwargs)
        self.__session = None

    def __call__(self) -> aiohttp.ClientSession:
        if self.__session is None:
            logger.debug("Creating a new session.")
            self.__session = self.__session_maker()

        return self.__session

    async def close(self) -> None:
        """
        Closes the session.
        """
        if self.__session is not None:
            logger.debug("Closing the session.")
            await self.__session.close()
            self.__session = None
