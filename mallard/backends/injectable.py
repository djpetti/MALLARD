"""
Superclass for injectable dependencies.
"""


import abc
from typing import TypeVar

from confuse import ConfigView


class Injectable(abc.ABC):
    """
    Superclass for injectable dependencies.
    """

    ClassType = TypeVar("ClassType")

    @classmethod
    @abc.abstractmethod
    def from_config(cls: ClassType, config: ConfigView) -> ClassType:
        """
        Creates a new instance based on the provided configuration.

        Args:
            config: The configuration to use to initialize the class.

        Returns:
            The new instance that it created.

        """
