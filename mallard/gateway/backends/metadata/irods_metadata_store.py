"""
A `MetadataStore` that uses the iRODS metadata feature as a backend.
"""


import abc
import asyncio
import enum
from typing import Dict, Type, TypeVar

from irods.data_object import iRODSDataObject
from irods.exception import CAT_UNKNOWN_FILE, CUT_ACTION_PROCESSED_ERR
from loguru import logger
from tenacity import (
    after_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

from ...fastapi_utils import flatten_dict
from ..irods_store import IrodsStore
from ..objects.models import ObjectRef, ObjectType
from .irods_metadata_helpers import to_irods_string
from .metadata_store import MetadataStore
from .schemas import (
    Metadata,
    RasterMetadata,
    UavImageMetadata,
    UavVideoMetadata,
)

_RETRY_ARGS = dict(
    stop=stop_after_attempt(20),
    wait=wait_random_exponential(1, max=30),
    after=after_log(logger, "DEBUG"),
)
"""
Common arguments to use for `retry` decorator.
"""


class IrodsMetadataStore(IrodsStore, MetadataStore, abc.ABC):
    """
    A `MetadataStore` that uses the iRODS metadata feature as a backend.
    """

    _OBJECT_TYPE_KEY = "_object_type"
    """
    An extra key we add to the metadata that keeps track of the object type.
    """

    _METADATA_TO_OBJECT_TYPE = {
        Metadata: ObjectType.ARTIFACT,
        RasterMetadata: ObjectType.RASTER,
        UavImageMetadata: ObjectType.IMAGE,
        UavVideoMetadata: ObjectType.VIDEO,
    }
    """
    Mapping from `Metadata` subclasses to their corresponding `ObjectType`.
    """

    @staticmethod
    def _combine_keys(parent: str, child: str) -> str:
        """
        Function we use for combining parent and child keys when flattening
        metadata models.

        Args:
            parent: The parent key.
            child: The child key.

        Returns:
            The combined key.

        """
        if parent == "":
            # Don't prefix with an empty key.
            return child

        return f"{parent}_{child}"

    @classmethod
    def __flatten_metadata(cls, metadata: Metadata) -> Dict[str, str]:
        """
        Flattens a metadata model into a single dict in preparation for
        insertion into the iRODS database.

        Args:
            metadata: The metadata to flatten.

        Returns:
            The flattened metadata dictionary.

        """
        metadata_dict = flatten_dict(
            metadata.dict(), combine_keys=cls._combine_keys
        )

        for key, value in metadata_dict.items():
            if isinstance(value, enum.Enum):
                # Enum values will need to be converted to their raw values for
                # insertion.
                value = value.value

            # All values need to be converted to strings for use as iRODS
            # metadata.
            metadata_dict[key] = to_irods_string(value)

        return metadata_dict

    MetadataType = TypeVar("MetadataType", bound=Metadata)

    async def __clear_metadata(self, data_object: iRODSDataObject) -> None:
        """
        Clears all existing metadata from a given object.

        Args:
            data_object: The object to remove metadata from.

        """
        avu_operations = [
            self._async_db_op(data_object.metadata.remove, a)
            for a in data_object.metadata.items()
        ]
        await asyncio.gather(*avu_operations)

    async def _get(
        self, object_id: ObjectRef, *, parse_as: Type[MetadataType]
    ) -> MetadataType:
        """
        General `get()` implementation that parses the data as a particular
        `Metadata` subclass.

        Args:
            object_id: The object for which to read metadata.
            parse_as: The `Metadata` subclass to parse the data as.

        Raises:
            `KeyError` if metadata for the specified object doesn't exist, or
            `MetadataOperationError` for other failures.

        Returns:
            The parsed metadata.

        """
        data_object = await self._get_object(object_id)

        # Read the metadata.
        metadata = data_object.metadata.get_one("json")
        logger.debug("Got raw metadata for {}: {}", object_id, metadata)
        return parse_as.parse_raw(metadata.value)

    async def add(
        self,
        *,
        object_id: ObjectRef,
        metadata: Metadata,
        overwrite: bool = False,
    ) -> None:
        logger.debug("Adding metadata for object {}.", object_id)

        data_object = await self._get_or_create_object(object_id)

        if overwrite:
            # Make sure we remove any existing metadata before adding our own.
            await self.__clear_metadata(data_object)

        # Convert the metadata into simple keys and values.
        metadata_dict = self.__flatten_metadata(metadata)
        # Add the object type.
        metadata_dict[self._OBJECT_TYPE_KEY] = self._METADATA_TO_OBJECT_TYPE[
            type(metadata)
        ].value
        logger.debug("Using raw metadata for {}: {}", object_id, metadata_dict)

        # TODO (danielp): Atomic metadata operations are only supported by
        #  relatively new versions of iRODS (>=4.2). Therefore, I'm not going
        #  to use them for now.
        # Add these as metadata to the iRODS object.
        avu_operations = [
            self._async_db_op(data_object.metadata.add, k, v)
            for k, v in metadata_dict.items()
        ]
        # Add an additional operation to add the full metadata in JSON form.
        # This is useful for accessing the full metadata, whereas the
        # per-field values are useful for querying.
        avu_operations.append(
            self._async_db_op(
                data_object.metadata.add, "json", metadata.json()
            )
        )
        await asyncio.gather(*avu_operations)

    # These exceptions can sometimes happen if the object was deleted
    # concurrently.
    @retry(
        retry=retry_if_exception_type(
            (CAT_UNKNOWN_FILE, CUT_ACTION_PROCESSED_ERR)
        ),
        **_RETRY_ARGS,
    )
    async def delete(self, object_id: ObjectRef) -> None:
        logger.debug("Deleting metadata for object {}.", object_id)

        try:
            data_object = await self._get_object(object_id)
        except KeyError:
            # This can fail under normal conditions if we are deleting the
            # underlying object at the same time. Because that's by far the
            # most common case, we simply ignore this error.
            logger.debug(
                "Not deleting metadata on nonexistent object {}.", object_id
            )
            return

        await self.__clear_metadata(data_object)
