"""
Mixin class that contains helpers for dealing asynchronously with databases.
"""


import asyncio
from typing import Any, Callable, TypeVar


class AsyncDbMixin:
    """
    Mixin class that contains helpers for dealing asynchronously with databases.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        """
        Args:
            *args: Will be forwarded to the next class in the MRO.
            **kwargs: Will be forwarded to the next class in the MRO.
        """
        super().__init__(*args, **kwargs)

        # Used to synchronize access to the database.
        self.__db_lock = asyncio.Lock()

    AsyncOpRet = TypeVar("AsyncOpRet")

    async def _async_db_op(
        self, target: Callable[..., AsyncOpRet], *args: Any, **kwargs: Any
    ) -> AsyncOpRet:
        """
        Helper for running iRODS operations in an asynchronous manner.

        Args:
            target: The target function to run.
            *args: Will be passed to the function.
            **kwargs: Will be passed to the function.

        Returns:
            The return value of the function.

        """
        async with self.__db_lock:
            return await asyncio.to_thread(target, *args, **kwargs)
