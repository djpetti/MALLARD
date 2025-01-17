"""
Metadata storage backend specifically for image data.
"""


import abc
from typing import AsyncIterable, Generic, Iterable, TypeVar

from loguru import logger

from ..objects.models import ObjectRef, TypedObjectRef
from .metadata_store import MetadataStore
from .schemas import ImageQuery, Ordering, RasterMetadata

MetadataTypeVar = TypeVar("MetadataTypeVar", bound=RasterMetadata)
"""
Used to specify the type of metadata stored in the database.
"""


class ArtifactMetadataStore(MetadataStore, Generic[MetadataTypeVar], abc.ABC):
    """
    Metadata storage backend specifically for artifacts.
    """

    @abc.abstractmethod
    async def add(
        self,
        *,
        object_id: ObjectRef,
        metadata: MetadataTypeVar,
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

    @abc.abstractmethod
    async def get(self, object_id: ObjectRef) -> MetadataTypeVar:
        """
        This is only re-defined in order to narrow the return type.

        See the superclass for documentation.

        """

    async def update(
        self,
        *,
        object_id: ObjectRef,
        metadata: MetadataTypeVar,
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
            old_metadata_params.update(metadata_set_params)
            metadata = type(old_metadata)(**old_metadata_params)

        # Update the metadata.
        await self.add(object_id=object_id, metadata=metadata, overwrite=True)

    @abc.abstractmethod
    async def query(
        self,
        queries: Iterable[ImageQuery],
        orderings: Iterable[Ordering] = (),
        skip_first: int = 0,
        max_num_results: int = 500,
    ) -> AsyncIterable[TypedObjectRef]:
        """
        Queries the store for objects that match a particular set of criteria.

        Args:
            queries: The criteria to match.
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
