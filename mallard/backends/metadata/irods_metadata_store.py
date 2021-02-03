"""
A `MetadataStore` that uses the iRODS metadata feature as a backend.
"""


import abc
import enum
from typing import Dict, Type, TypeVar

from irods.meta import AVUOperation, iRODSMeta
from loguru import logger

from ...fastapi_utils import flatten_dict
from ..irods_store import IrodsStore
from ..objects.models import ObjectRef
from .irods_metadata_helpers import from_irods_string, to_irods_string
from .metadata_store import MetadataStore
from .models import Metadata


class IrodsMetadataStore(IrodsStore, MetadataStore, abc.ABC):
    """
    A `MetadataStore` that uses the iRODS metadata feature as a backend.
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

    async def add(self, *, object_id: ObjectRef, metadata: Metadata) -> None:
        logger.debug("Adding metadata for object {}.", object_id)

        data_object = await self._get_or_create_object(object_id)

        # Convert the metadata into simple keys and values.
        metadata_dict = self.__flatten_metadata(metadata)
        logger.debug("Using raw metadata for {}: {}", object_id, metadata_dict)

        # Add these as metadata to the iRODS object.
        avu_operations = [
            AVUOperation(operation="add", avu=iRODSMeta(k, v))
            for k, v in metadata_dict.items()
        ]
        # Add an additional operation to add the full metadata in JSON form.
        # This is useful for accessing the full metadata, whereas the
        # per-field values are useful for querying.
        avu_operations.append(
            AVUOperation(
                operation="add", avu=iRODSMeta("json", metadata.json())
            )
        )
        await self._async_db_op(
            data_object.metadata.apply_atomic_operations, *avu_operations
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

        avu_operations = [
            AVUOperation(operation="remove", avu=a)
            for a in data_object.metadata.items()
        ]
        await self._async_db_op(
            data_object.metadata.apply_atomic_operations, *avu_operations
        )
