"""
Utilities that are common to all routers.
"""


import asyncio
from contextlib import contextmanager
from typing import Iterable, List

from fastapi import HTTPException
from loguru import logger

from ..backends.metadata import (
    ArtifactMetadataStore,
    MetadataStore,
    MetadataTypeVar,
)
from ..backends.metadata.schemas import Metadata
from ..backends.objects.models import ObjectRef


@contextmanager
def check_key_errors() -> Iterable[None]:
    """
    Checks for key errors in an `ExceptionGroup` raised by the code in the
    context manager, and produces the appropriate response if there are any.

    """
    try:
        yield

    except ExceptionGroup as ex_group:
        # Check for key errors, which are raised when the images do not
        # exist. We have a standard HTTP error for that.
        key_errors, others = ex_group.split(KeyError)

        if key_errors is not None:
            error_messages = [f"\t-{e}" for e in key_errors.exceptions]
            combined_error = "\n".join(error_messages)
            logger.error("Could not find artifacts: {}", combined_error)
            raise HTTPException(
                status_code=404,
                detail=f"Some of the artifacts could not be "
                f"found:\n{combined_error}",
            )

        if others is not None:
            # Otherwise, just raise it again.
            raise others


async def get_metadata(
    artifacts: List[ObjectRef], *, metadata_store: MetadataStore
) -> List[Metadata]:
    """
    Gets the metadata for the given artifacts.

    Args:
        artifacts: The artifacts to get the metadata for.
        metadata_store: The metadata store to use.

    Returns:
        The metadata for the given artifacts.
    """
    logger.debug("Getting metadata for artifacts {}", artifacts)

    tasks = []
    with check_key_errors():
        async with asyncio.TaskGroup() as task_group:
            for object_id in artifacts:
                tasks.append(
                    task_group.create_task(metadata_store.get(object_id))
                )

    return [t.result() for t in tasks]


async def update_metadata(
    *,
    metadata: MetadataTypeVar,
    artifacts: List[ObjectRef],
    increment_sequence: bool = False,
    metadata_store: ArtifactMetadataStore,
) -> None:
    """
    Updates the metadata for the given artifacts.

    Args:
        metadata: The metadata to set.
        artifacts: The artifacts to update the metadata for.
        increment_sequence: Whether to increment the sequence number.
        metadata_store: The metadata store to use.

    """
    logger.debug("Updating metadata for artifacts {}", artifacts)

    with check_key_errors():
        async with asyncio.TaskGroup() as task_group:
            for object_id in artifacts:
                task_group.create_task(
                    metadata_store.update(
                        object_id=object_id,
                        metadata=metadata,
                    )
                )

                # Increment the sequence number if appropriate.
                if increment_sequence and metadata.sequence_number is not None:
                    metadata = metadata.copy(
                        update=dict(
                            sequence_number=metadata.sequence_number + 1
                        )
                    )
