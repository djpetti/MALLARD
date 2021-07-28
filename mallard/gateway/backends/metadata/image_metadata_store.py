"""
Metadata storage backend specifically for image data.
"""


import abc
from typing import AsyncIterable, Iterable

from loguru import logger

from ..objects.models import ObjectRef
from .metadata_store import MetadataStore
from .schemas import ImageMetadata, ImageQuery, Ordering


class ImageMetadataStore(MetadataStore, abc.ABC):
    """
    Metadata storage backend specifically for image data.
    """

    @abc.abstractmethod
    async def add(
        self,
        *,
        object_id: ObjectRef,
        metadata: ImageMetadata,
        overwrite: bool = False,
    ) -> None:
        """
        Adds metadata for an object to the store.

        Args:
            object_id: The ID of the object in the object store to add metadata
                for.
            metadata: The actual metadata to add.
            overwrite: If true, and the object already exists, it will
                overwrite the object instead of producing an error.

        Raises:
            `MetadataOperationError` on failure.

        """

    async def update(
        self,
        *,
        object_id: ObjectRef,
        metadata: ImageMetadata,
        merge: bool = True,
    ) -> None:
        """
        Updates existing metadata.

        Args:
            object_id: The object to update metadata for.
            metadata: The new metadata to update.
            merge: If true, it will attempt to merge the new metadata with the
                old metadata, checking if any values in the new metadata are
                set to `None`, and using the old values instead. If False,
                it will simply replace the metadata without performing this
                check. If not necessary, disabling it eliminates a query.

        Raises:
            `MetadataOperationError` on failure.

        """
        if merge:
            # Get the old metadata.
            old_metadata = await self.get(object_id)
            old_metadata_params = old_metadata.dict()

            # Apply the new metadata on top of it.
            metadata_set_params = {
                k: v
                for k, v in metadata.dict(exclude_none=True).items()
                if k in old_metadata_params.keys()
            }
            logger.debug(
                "Updating the following metadata parameters for "
                "object ({}): {}",
                object_id,
                metadata_set_params,
            )
            # TODO (danielp) Use copy() after resolution of
            #   https://github.com/samuelcolvin/pydantic/issues/3039
            old_metadata_params.update(metadata_set_params)
            metadata = type(old_metadata)(**old_metadata_params)

        # Update the metadata.
        await self.add(object_id=object_id, metadata=metadata, overwrite=True)

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
