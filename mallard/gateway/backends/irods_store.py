"""
Base class containing methods for interacting with iRODS at a low level.
"""


import asyncio
import functools
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, TypeVar

from confuse import ConfigView
from irods.data_object import iRODSDataObject
from irods.exception import (
    OVERWRITE_WITHOUT_FORCE_FLAG,
    SYS_INTERNAL_NULL_INPUT_ERR,
    CollectionDoesNotExist,
    DataObjectDoesNotExist,
)
from irods.session import iRODSSession
from loguru import logger
from tenacity import (
    after_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

from .async_db_mixin import AsyncDbMixin
from .objects.models import ObjectRef

_RETRY_ARGS = dict(
    stop=stop_after_attempt(20),
    wait=wait_random_exponential(1, max=30),
    after=after_log(logger, "DEBUG"),
)
"""
Common arguments to use for `retry` decorator.
"""


class IrodsStore(AsyncDbMixin):
    """
    Base class containing methods for interacting with iRODS at a low level.
    """

    ClassType = TypeVar("ClassType")

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

    def __init__(
        self,
        *args: Any,
        session: iRODSSession,
        root_collection: Path,
        **kwargs: Any,
    ):
        """
        Args:
            *args: Will be forwarded to the superclass.
            session: The iRODS session to use for iRODS operations.
            root_collection: This is the path to the collection that we will
                store all our data under. It will be created if it doesn't
                exist.
            **kwargs: Will be forwarded to the superclass.
        """
        super().__init__(*args, **kwargs)

        self.__session = session
        self.__root_path = root_collection

    @property
    def _session(self) -> iRODSSession:
        """
        Returns:
            The iRODS session that we are using.

        """
        return self.__session

    @property
    def _root_path(self) -> Path:
        """
        Returns:
            The path to the root collection that we are using.

        """
        return self.__root_path

    def _bucket_path(self, name: str) -> Path:
        """
        Gets the path to a bucket.

        Args:
            name: The name of the bucket.

        Returns:
            The full path to the bucket on the server.

        """
        return self._root_path / name

    def _object_path(self, object_id: ObjectRef) -> Path:
        """
        Gets the path to an object.

        Args:
            object_id: The unique ID of the object.

        Returns:
            The full path to the object on the server.

        """
        return self._bucket_path(object_id.bucket) / object_id.name

    async def _get_object(self, object_id: ObjectRef) -> iRODSDataObject:
        """
        Gets the raw data object from iRODS.

        Args:
            object_id: The object ID.

        Raises:
            `KeyError` if the object does not exist.

        Returns:
            The retrieved data object.

        """
        object_path = self._object_path(object_id)

        try:
            data_object = await self._async_db_op(
                self._session.data_objects.get, object_path.as_posix()
            )
        except (DataObjectDoesNotExist, CollectionDoesNotExist):
            raise KeyError(f"Object '{object_id}' does not exist.")

        return data_object

    async def _get_or_create_object(
        self, object_id: ObjectRef
    ) -> iRODSDataObject:
        """
        Gets the raw data object from iRODS, creating it if it does not exist
        yet.

        Args:
            object_id: The object ID.

        Returns:
            The retrieved data object.

        """

        @retry(
            retry=retry_if_exception_type(SYS_INTERNAL_NULL_INPUT_ERR),
            **_RETRY_ARGS,
        )
        async def _create_object(path: Path) -> iRODSDataObject:
            # Enable retrying this because it sometimes fails if someone else is
            # trying to create the same object concurrently.
            return await self._async_db_op(
                self._session.data_objects.create, path.as_posix()
            )

        try:
            return await self._get_object(object_id)
        except KeyError:
            # Object does not exist yet.
            try:
                object_path = self._object_path(object_id)
                logger.debug("Creating a new object at {}.", object_path)
                return await _create_object(object_path)
            except OVERWRITE_WITHOUT_FORCE_FLAG:
                # Somewhere in the interim, the object was created,
                # so getting it is the correct action. This should be a
                # relatively rare race condition that only occurs if two
                # clients are trying to get the same object concurrently.
                logger.debug(
                    "Creating {} failed due to new object, getting it instead.",
                    object_id,
                )
                return await self._get_object(object_id)
