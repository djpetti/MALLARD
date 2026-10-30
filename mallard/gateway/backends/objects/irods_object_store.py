"""
Object store that uses iRODS as backing storage.
"""

import shutil
from functools import singledispatchmethod
from io import BufferedRandom, BytesIO
from typing import Any, AsyncIterable, AsyncIterator, Union

from irods.exception import CollectionDoesNotExist
from loguru import logger
from starlette.datastructures import UploadFile

from ..irods_store import IrodsStore
from .models import ObjectRef
from .object_store import BucketOperationError, ObjectStore, ObjectStream


class _SizedObjectStream:
    """Expose an object's known size without buffering its streamed data."""

    def __init__(self, chunks: AsyncIterator[bytes], total_size: int) -> None:
        """Initialize the stream.

        Args:
            chunks: The iterator supplying object data.
            total_size: The object's size in bytes from iRODS metadata.
        """
        self.__chunks = chunks
        self.__total_size = total_size

    def __aiter__(self) -> AsyncIterator[bytes]:
        """Return the iterator supplying object data.

        Returns:
            The underlying asynchronous chunk iterator.
        """
        return self.__chunks

    def __len__(self) -> int:
        """Return the full object's size in bytes.

        Returns:
            The size reported by iRODS metadata.
        """
        return self.__total_size

    @property
    def content_range(self) -> str | None:
        """Return no content range because the stream contains the full object.

        Returns:
            None, since range requests are unsupported.
        """
        return None


class IrodsObjectStore(IrodsStore, ObjectStore):
    """
    Object store that uses iRODS as backing storage.
    """

    _COPY_BUFFER_SIZE = 2**20  # 1 MB
    """
    Buffer size to use when copying file data, in bytes.
    """

    @singledispatchmethod
    async def __copy_file(
        self, source: Any, dest_file: BufferedRandom
    ) -> None:
        """
        Copies the source data into a destination file.

        Args:
            source: The source data to copy.
            dest_file: The destination file.

        """
        raise NotImplementedError(
            f"__copy_file is not implemented for source of type {type(source)}."
        )

    @__copy_file.register
    async def _(self, source: bytes, dest_file: BufferedRandom) -> None:
        # Write the bytes directly.
        await self._async_db_op(dest_file.write, source)

    @__copy_file.register
    async def _(self, source: BytesIO, dest_file: BufferedRandom) -> None:
        await self._async_db_op(shutil.copyfileobj, source, dest_file)

    @__copy_file.register
    async def _(self, source: UploadFile, dest_file: BufferedRandom) -> None:
        # This is a little trickier since our source supports async reads.
        while source_data := await source.read(self._COPY_BUFFER_SIZE):
            await self.__copy_file(source_data, dest_file)

    async def create_bucket(self, name: str, exists_ok: bool = False) -> None:
        # By default, iRODS will not produce an error if a collection already
        # exists, so if we requested that check, we have to do it manually.
        if not exists_ok and await self.bucket_exists(name):
            raise BucketOperationError("Bucket '{}' already exists.", name)

        # In this case, buckets are an abstraction over iRODS collections.
        collection_path = self._bucket_path(name)
        logger.debug("Creating new collection {}.", collection_path)

        collection = await self._async_db_op(
            self._session.collections.create, collection_path.as_posix()
        )
        logger.debug("Created collection with ID {}.", collection.id)

    async def bucket_exists(self, name: str) -> bool:
        collection_path = self._bucket_path(name)
        return await self._async_db_op(
            self._session.collections.exists, collection_path.as_posix()
        )

    async def delete_bucket(self, name: str) -> None:
        collection_path = self._bucket_path(name)

        if not await self.bucket_exists(name):
            raise KeyError(f"Bucket '{name}' does not exist.")

        logger.debug("Deleting collection {}.", name)
        await self._async_db_op(
            self._session.collections.remove,
            collection_path.as_posix(),
            force=True,
        )

    async def list_bucket_contents(self, name: str) -> AsyncIterable[str]:
        collection_path = self._bucket_path(name)

        try:
            collection = await self._async_db_op(
                self._session.collections.get, collection_path.as_posix()
            )
        except CollectionDoesNotExist:
            # Invalid bucket.
            raise KeyError(f"Bucket '{name}' does not exist.")

        data_objects = await self._async_db_op(lambda: collection.data_objects)
        for data_object in data_objects:
            yield data_object.name

    async def create_object(
        self, object_id: ObjectRef, *, data: Union[bytes, BytesIO, UploadFile]
    ) -> None:
        if not await self.bucket_exists(object_id.bucket):
            # Invalid bucket.
            raise KeyError(f"Bucket '{object_id.bucket}' does not exist.")

        logger.info("Requesting creation of new object {}.", object_id)

        # Open a file for the object.
        data_object = await self._get_or_create_object(object_id)
        with await self._async_db_op(data_object.open, "w") as dest_file:
            # Copy the data.
            await self.__copy_file(data, dest_file)

    async def object_exists(self, object_id: ObjectRef) -> bool:
        object_path = self._object_path(object_id)

        return await self._async_db_op(
            self._session.data_objects.exists, object_path.as_posix()
        )

    async def delete_object(self, object_id: ObjectRef) -> None:
        if not await self.object_exists(object_id):
            raise KeyError(f"Object '{object_id}' does not exist.")

        logger.info("Requesting deletion of object {}.", object_id)

        object_path = self._object_path(object_id)
        return await self._async_db_op(
            self._session.data_objects.unlink,
            object_path.as_posix(),
            force=True,
        )

    async def get_object(
        self, object_id: ObjectRef, data_range: str | None = None
    ) -> ObjectStream:
        """Get the full object as a sized stream.

        Args:
            object_id: The identifier of the object to retrieve.
            data_range: An HTTP Range value, ignored because ranges are
                unsupported.

        Returns:
            The full object stream with its size and no content range.
        """
        data_object = await self._get_object(object_id)
        object_file = await self._async_db_op(data_object.open, "r")

        async def _read_chunks() -> AsyncIterator[bytes]:
            """Read object data lazily and close the file when iteration ends.

            Yields:
                The next chunk of object data.
            """
            try:
                while chunk := await self._async_db_op(
                    object_file.read, self._COPY_BUFFER_SIZE
                ):
                    yield chunk
            finally:
                # Close after both normal exhaustion and a failed read.
                await self._async_db_op(object_file.close)

        # Metadata supplies the length without reading or buffering object data.
        return _SizedObjectStream(_read_chunks(), data_object.size)
