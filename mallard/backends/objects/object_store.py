"""
Common interface for all object storage backends.
"""


import abc
from io import BufferedIOBase
from typing import Iterable, Union


class ObjectStore(abc.ABC):
    """
    Common interface for all object storage backends.
    """

    @abc.abstractmethod
    def create_bucket(self, name: str) -> None:
        """
        Creates a new bucket in the object store.

        Args:
            name: The name of the bucket.

        """

    @abc.abstractmethod
    def bucket_exists(self, name: str) -> bool:
        """
        Args:
            name: The name of the bucket.

        Returns:
            True iff the bucket exists.

        """

    @abc.abstractmethod
    def delete_bucket(self, name: str) -> None:
        """
        Deletes an existing bucket.

        Args:
            name: The name of the bucket to delete.

        """

    @abc.abstractmethod
    def list_bucket_contents(self, name: str) -> Iterable[str]:
        """
        Lists the contents of a bucket.

        Args:
            name: The name of the bucket to list the contents of.

        Returns:
            An iterator containing the unique IDs of every object in the bucket.

        """

    @abc.abstractmethod
    def create_object(
        self,
        *,
        bucket: str,
        object_name: str,
        data: Union[bytes, BufferedIOBase]
    ) -> str:
        """
        Creates a new object.

        Args:
            bucket: The name of the bucket to add the object to.
            object_name: The name of the object to add.
            data: The raw data contained in the object.

        Returns:
            The unique ID of the object.

        """

    @abc.abstractmethod
    def object_exists(self, *, bucket: str, object_name: str) -> bool:
        """
        Args:
            bucket: The name of the bucket.
            object_name: The name of the object.

        Returns:
            True iff an object with that name exists in that bucket. Note that
            it will also return false if the bucket does not exist.

        """

    @abc.abstractmethod
    def delete_object(self, *, bucket: str, object_name: str) -> None:
        """
        Deletes an existing object from the object store.

        Args:
            bucket: The name of the bucket that the object is in.
            object_name: The name of the object.

        """

    @abc.abstractmethod
    def get_object(self, *, bucket: str, object_name: str) -> BufferedIOBase:
        """
        Gets an existing object from the object store.

        Args:
            bucket: The name of the bucket.
            object_name: The name of the object to get.

        Returns:
            A stream of binary data that contains the object data.

        """

    @abc.abstractmethod
    def get_object_url(self, *, bucket: str, object_name: str) -> str:
        """
        Gets a unique URL that can be used to download an object.

        Args:
            bucket: The name of the bucket.
            object_name: The name of the object to get.

        Returns:
            A URL corresponding to the object.

        """
