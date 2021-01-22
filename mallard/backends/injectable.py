"""
Superclass for injectable dependencies.
"""


import abc
from contextlib import asynccontextmanager
from typing import AsyncIterator, TypeVar

from confuse import ConfigView


class Injectable(abc.ABC):
    """
    Superclass for injectable dependencies.
    """

    ClassType = TypeVar("ClassType")

    @classmethod
    @abc.abstractmethod
    @asynccontextmanager
    async def from_config(
        cls: ClassType, config: ConfigView
    ) -> AsyncIterator[ClassType]:
        """
        Context manager that creates a new instance based on the provided
        configuration. Cleanup of connections, etc. should be performed on exit.

        Args:
            config: The configuration to use to initialize the class.

        Yields:
            The new instance that it created.

        """
