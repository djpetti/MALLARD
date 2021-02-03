"""
Metadata storage backend specifically for image data.
"""


import abc
from typing import AsyncIterable, Iterable

from ..objects.models import ObjectRef
from .metadata_store import MetadataStore
from .models import ImageQuery, Ordering


class ImageMetadataStore(MetadataStore, abc.ABC):
    """
    Metadata storage backend specifically for image data.
    """

    @abc.abstractmethod
    async def query(
        self,
        query: ImageQuery,
        orderings: Iterable[Ordering] = (),
        skip_first: int = 0,
        max_num_results: int = 500,
    ) -> AsyncIterable[ObjectRef]:
        """
        Queries the store for objects that match a particular set of criteria.

        Args:
            query: The criteria to match.
            orderings: Specifies a specific ordering for the final results. It
                will first sort by the first ordering specified, then the
                second, etc.
            skip_first: If not zero, it will skip this many initial results
                from the query.
            max_num_results: The maximum number of results that this query is
                allowed to produce.

        Returns:
            The IDs of all the matching objects.

        """
