"""
Metadata storage backend specifically for image data.
"""


import abc
from typing import AsyncIterable, Iterable

from ..objects.models import ObjectRef
from .metadata_store import MetadataStore
from .schemas import ImageMetadata, ImageQuery, Ordering


class ImageMetadataStore(MetadataStore, abc.ABC):
    """
    Metadata storage backend specifically for image data.
    """

    @abc.abstractmethod
    async def add(
        self, *, object_id: ObjectRef, metadata: ImageMetadata
    ) -> None:
        """
        Adds metadata for an object to the store.

        Args:
            object_id: The ID of the object in the object store to add metadata
                for.
            metadata: The actual metadata to add.

        Raises:
            `MetadataOperationError` on failure.

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
                second, etc. Note that not all backends support all
                orderings, so YMMV.
            skip_first: If not zero, it will skip this many initial results
                from the query.
            max_num_results: The maximum number of results that this query is
                allowed to produce.

        Yields:
            The IDs of all the matching objects.

        """
        # There's a subtle typing issue here where if we don't have a yield,
        # Python interprets this as a coroutine that returns an AsyncIterator
        # instead of an async generator.
        yield  # pragma: no cover
