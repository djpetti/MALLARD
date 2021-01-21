"""
Metadata storage backend specifically for image data.
"""


import abc
from typing import AsyncIterable

from ..objects.models import ObjectRef
from .metadata_store import MetadataStore
from .models import ImageQuery


class ImageMetadataStore(MetadataStore, abc.ABC):
    """
    Metadata storage backend specifically for image data.
    """

    @abc.abstractmethod
    async def query(
        self, query: ImageQuery, skip_first: int = 0
    ) -> AsyncIterable[ObjectRef]:
        """
        Queries the store for objects that match a particular set of criteria.

        Args:
            query: The criteria to match.
            skip_first: If not zero, it will skip this many initial results
                from the query.

        Returns:
            The IDs of all the matching objects.

        """
