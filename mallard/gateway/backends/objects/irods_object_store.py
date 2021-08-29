"""
Object store that uses iRODS as backing storage.
"""


import shutil
from functools import singledispatchmethod
from io import BufferedRandom, BytesIO
from typing import Any, AsyncIterable, Union

from irods.exception import CollectionDoesNotExist
from loguru import logger
from starlette.datastructures import UploadFile

from ..irods_store import IrodsStore
from .models import ObjectRef
from .object_store import BucketOperationError, ObjectStore


class IrodsObjectStore(IrodsStore, ObjectStore):
    """
    Object store that uses iRODS as backing storage.
    """

    _COPY_BUFFER_SIZE = 4096
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

    async def get_object(self, object_id: ObjectRef) -> BytesIO:
        data_object = await self._get_object(object_id)
        return await self._async_db_op(data_object.open, "r")
