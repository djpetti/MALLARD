"""
Common interface for all metadata storage backends.
"""


import abc

from ..injectable import Injectable
from ..objects.models import ObjectRef
from .schemas import Metadata


class MetadataOperationError(Exception):
    """
    General exception triggered when an operation on the metadata store fails.
    """


class MetadataStore(Injectable):
    """
    Common interface for all metadata storage backends.
    """

    @abc.abstractmethod
    async def get(self, object_id: ObjectRef) -> Metadata:
        """
        Gets the associated metadata for a particular object.

        Args:
            object_id: The ID of the object in the object store.

        Raises:
            `KeyError` if metadata for the specified object doesn't exist, or
            `MetadataOperationError` for other failures.

        Returns:
            The metadata associated with this object.

        """

    @abc.abstractmethod
    async def delete(self, object_id: ObjectRef) -> None:
        """
        Deletes the metadata associated with a particular object.

        Args:
            object_id: The ID of the object in the object store.

        Raises:
            -`KeyError`, possibly, if metadata for the specified object
                doesn't exist. This is not guaranteed, so if you really need to
                know, check explicitly.
            - `MetadataOperationError` for other failures.

        """
