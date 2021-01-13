"""
Common interface for all metadata storage backends.
"""


import abc

from .models import Metadata


class MetadataStore(abc.ABC):
    """
    Common interface for all metadata storage backends.
    """

    @abc.abstractmethod
    def add(self, *, object_id: str, metadata: Metadata) -> None:
        """
        Adds metadata for an object to the store.

        Args:
            object_id: The ID of the object in the object store to add metadata
                for.
            metadata: The actual metadata to add.

        """

    @abc.abstractmethod
    def get(self, object_id: str) -> Metadata:
        """
        Gets the associated metadata for a particular object.

        Args:
            object_id: The ID of the object in the object store.

        Returns:
            The metadata associated with this object.

        """

    @abc.abstractmethod
    def delete(self, object_id: str) -> None:
        """
        Deletes the metadata associated with a particular object.

        Args:
            object_id: The ID of the object in the object store.

        """
