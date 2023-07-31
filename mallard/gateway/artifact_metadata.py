"""
Common utilities for handling artifact metadata.
"""


from typing import Any, TypeVar

from fastapi import UploadFile
from loguru import logger

from .backends.metadata.schemas import Metadata


class MissingLengthError(Exception):
    """
    Raised when the file length is not specified,
    and the content-length header is missing.
    """


MetadataType = TypeVar("MetadataType", bound=Metadata)


def fill_metadata(
    metadata: MetadataType, *, artifact: UploadFile, **inferred_fields: Any
) -> MetadataType:
    """
    Fills in missing values in a metadata structure. Any values that are
    missing will be filled in with the values from the missing_items
    dictionary.

    Args:
        metadata: The metadata structure to fill in.
        artifact: The artifact file that the metadata corresponds to.
        inferred_fields: Values to use if not specified, generally inferred
            from the actual data.
    """
    # These fields can be inferred from the file.
    inferred_fields["size"] = artifact.headers.get("content-length")
    inferred_fields["name"] = artifact.filename

    original_fields = metadata.dict()
    field_meta = metadata.__fields__
    update_fields = {}
    for name, value in original_fields.items():
        if name in inferred_fields and value == field_meta[name].default:
            # If it's not specified originally, update it from an inferred
            # value.
            update_fields[name] = inferred_fields.get(name)

    logger.debug("Updating metadata with fields {}.", update_fields)
    filled_metadata = metadata.copy(update=update_fields)

    if filled_metadata.size is None:
        raise MissingLengthError("No size specified for image upload.")
    return filled_metadata
