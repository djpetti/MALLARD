"""
Object store that uses iRODS as backing storage.
"""


import asyncio
import shutil
from contextlib import asynccontextmanager
from functools import singledispatchmethod
from io import BufferedRandom, BytesIO
from pathlib import Path
from typing import Any, AsyncIterable, AsyncIterator, Callable, TypeVar, Union

from confuse import ConfigView
from fastapi import UploadFile
from irods.exception import CollectionDoesNotExist, DataObjectDoesNotExist
from irods.session import iRODSSession
from loguru import logger

from .models import ObjectRef
from .object_store import ObjectStore


class IrodsObjectStore(ObjectStore):
    """
    Object store that uses iRODS as backing storage.
    """

    ClassType = ObjectStore.ClassType

    _COPY_BUFFER_SIZE = 4096
    """
    Buffer size to use when copying file data, in bytes.
    """

    @classmethod
    @asynccontextmanager
    async def from_config(
        cls: ClassType, config: ConfigView
    ) -> AsyncIterator[ClassType]:
        # Extract the configuration.
        host = config["host"].as_str()
        port = config["port"].get(int)
        user = config["user"].as_str()
        password = config["password"].as_str()
        zone = config["zone"].as_str()
        root_collection = config["root_collection"].as_path()

        with await asyncio.to_thread(
            iRODSSession,
            host=host,
            port=port,
            user=user,
            password=password,
            zone=zone,
        ) as session:
            yield cls(session=session, root_collection=root_collection)

    def __init__(self, *, session: iRODSSession, root_collection: Path):
        """
        Args:
            session: The iRODS session to use for iRODS operations.
            root_collection: This is the path to the collection that we will
                store all our data under. It will be created if it doesn't
                exist.
        """
        self.__session = session
        self.__root_path = root_collection

        # Used to synchronize access to the iRODS session.
        self.__session_lock = asyncio.Lock()

    AsyncOpRet = TypeVar("AsyncOpRet")

    async def __async_db_op(
        self, target: Callable[..., AsyncOpRet], *args: Any, **kwargs: Any
    ) -> AsyncOpRet:
        """
        Helper for running iRODS operations in an asynchronous manner.

        Args:
            target: The target function to run.
            *args: Will be passed to the function.
            **kwargs: Will be passed to the function.

        Returns:
            The return value of the function.

        """
        async with self.__session_lock:
            return await asyncio.to_thread(target, *args, **kwargs)

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
        await self.__async_db_op(dest_file.write, source)

    @__copy_file.register
    async def _(self, source: BytesIO, dest_file: BufferedRandom) -> None:
        await self.__async_db_op(shutil.copyfileobj, source, dest_file)

    @__copy_file.register
    async def _(self, source: UploadFile, dest_file: BufferedRandom) -> None:
        # This is a little trickier since our source supports async reads.
        while source_data := await source.read(self._COPY_BUFFER_SIZE):
            await self.__copy_file(source_data, dest_file)

    async def create_bucket(self, name: str) -> None:
        # In this case, buckets are an abstraction over iRODS collections.
        collection_path = self.__root_path / name
        logger.debug("Creating new collection {}.", collection_path)

        collection = await self.__async_db_op(
            self.__session.collections.create, collection_path.as_posix()
        )
        logger.debug("Created collection with ID {}.", collection.id)

    async def bucket_exists(self, name: str) -> bool:
        collection_path = self.__root_path / name
        return await self.__async_db_op(
            self.__session.collections.exists, collection_path.as_posix()
        )

    async def delete_bucket(self, name: str) -> None:
        collection_path = self.__root_path / name

        if not await self.bucket_exists(name):
            raise KeyError(f"Bucket '{name}' does not exist.")

        await self.__async_db_op(
            self.__session.collections.remove,
            collection_path.as_posix(),
            force=True,
        )

    async def list_bucket_contents(self, name: str) -> AsyncIterable[str]:
        collection_path = self.__root_path / name

        try:
            collection = await self.__async_db_op(
                self.__session.collections.get, collection_path.as_posix()
            )
        except CollectionDoesNotExist:
            # Invalid bucket.
            raise KeyError(f"Bucket '{name}' does not exist.")

        data_objects = await self.__async_db_op(
            lambda: collection.data_objects
        )
        for data_object in data_objects:
            yield data_object.name

    async def create_object(
        self, object_id: ObjectRef, *, data: Union[bytes, BytesIO, UploadFile]
    ) -> None:
        if not await self.bucket_exists(object_id.bucket):
            # Invalid bucket.
            raise KeyError(f"Bucket '{object_id.bucket}' does not exist.")

        object_path = self.__root_path / object_id.bucket / object_id.name
        logger.debug("Creating new object at {}.", object_path)

        # Open a file for the object.
        data_object = await self.__async_db_op(
            self.__session.data_objects.create, object_path.as_posix()
        )
        with await self.__async_db_op(data_object.open, "w") as dest_file:
            # Copy the data.
            await self.__copy_file(data, dest_file)

    async def object_exists(self, object_id: ObjectRef) -> bool:
        object_path = self.__root_path / object_id.bucket / object_id.name

        return await self.__async_db_op(
            self.__session.data_objects.exists, object_path.as_posix()
        )

    async def delete_object(self, object_id: ObjectRef) -> None:
        if not await self.object_exists(object_id):
            raise KeyError(f"Object '{object_id}' does not exist.")

        object_path = self.__root_path / object_id.bucket / object_id.name
        return await self.__async_db_op(
            self.__session.data_objects.unlink,
            object_path.as_posix(),
            force=True,
        )

    async def get_object(self, object_id: ObjectRef) -> BytesIO:
        object_path = self.__root_path / object_id.bucket / object_id.name

        try:
            data_object = await self.__async_db_op(
                self.__session.data_objects.get, object_path.as_posix()
            )
        except DataObjectDoesNotExist:
            raise KeyError(f"Object '{object_id}' does not exist.")

        return await self.__async_db_op(data_object.open, "r")
