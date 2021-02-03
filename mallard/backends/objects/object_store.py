"""
Common interface for all object storage backends.
"""


import abc
from io import BytesIO
from typing import AsyncIterable, Union

from fastapi import UploadFile

from ..injectable import Injectable
from .models import ObjectRef


class BucketOperationError(Exception):
    """
    General exception triggered when an operation on a bucket fails.
    """


class ObjectOperationError(Exception):
    """
    General exception triggered when an operation on an object fails.
    """


class ObjectStore(Injectable):
    """
    Common interface for all object storage backends.
    """

    @abc.abstractmethod
    async def create_bucket(self, name: str) -> None:
        """
        Creates a new bucket in the object store.

        Args:
            name: The name of the bucket.

        Raises:
            `BucketOperationError` on failure.

        """

    @abc.abstractmethod
    async def bucket_exists(self, name: str) -> bool:
        """
        Args:
            name: The name of the bucket.

        Raises:
            `BucketOperationError` on failure.

        Returns:
            True iff the bucket exists.

        """

    @abc.abstractmethod
    async def delete_bucket(self, name: str) -> None:
        """
        Deletes an existing bucket.

        Raises:
            `KeyError` if the bucket doesn't exist, or `BucketOperationError`
            for other failures.

        Args:
            name: The name of the bucket to delete.

        """

    @abc.abstractmethod
    async def list_bucket_contents(self, name: str) -> AsyncIterable[str]:
        """
        Lists the contents of a bucket.

        Args:
            name: The name of the bucket to list the contents of.

        Raises:
            `KeyError` if the bucket doesn't exist, or`BucketOperationError`
            for other failures.

        Returns:
            An iterator containing the unique IDs of every object in the bucket.

        """

    @abc.abstractmethod
    async def create_object(
        self, object_id: ObjectRef, *, data: Union[bytes, BytesIO, UploadFile]
    ) -> None:
        """
        Creates a new object.

        Args:
            object_id: The identifier of the object being created.
            data: The raw data contained in the object.

        Notes:
            Depending on the exact semantics of the backend, this might
            overwrite an existing file. If you care about that, it's good
            practice to check with `exists()` first.

        Raises:
            `KeyError` if the bucket doesn't exist,
            or `ObjectOperationError` for other failures.

        Returns:
            The unique ID of the object.

        """

    @abc.abstractmethod
    async def object_exists(self, object_id: ObjectRef) -> bool:
        """
        Args:
            object_id: The identifier of the object being created.

        Raises:
            `ObjectOperationError` on failure.

        Returns:
            True iff an object with that name exists in that bucket. Note that
            it will also return false if the bucket does not exist.

        """

    @abc.abstractmethod
    async def delete_object(self, object_id: ObjectRef) -> None:
        """
        Deletes an existing object from the object store.

        Args:
            object_id: The identifier of the object being created.

        Raises:
            `KeyError` if the object (or bucket) doesn't exist,
            or `ObjectOperationError` for other failures.

        """

    @abc.abstractmethod
    async def get_object(self, object_id: ObjectRef) -> BytesIO:
        """
        Gets an existing object from the object store.

        Args:
            object_id: The identifier of the object being created.

        Raises:
            `KeyError` if the object (or bucket) doesn't exist,
            or `ObjectOperationError` for other failures.

        Returns:
            A stream of binary data that contains the object data.

        """
