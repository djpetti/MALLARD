"""
Object storage backend for object stores that follow the S3 API.
"""

import asyncio
from contextlib import asynccontextmanager
from functools import singledispatch
from io import BytesIO
from typing import AsyncIterable, AsyncIterator, Optional, Union

from aiobotocore import get_session
from aiobotocore.client import AioBaseClient
from aiobotocore.response import StreamingBody
from botocore.exceptions import ClientError
from confuse import ConfigView
from loguru import logger
from starlette.datastructures import UploadFile

from ...async_utils import read_file_chunks
from .models import ObjectRef
from .object_store import (
    BucketOperationError,
    ObjectOperationError,
    ObjectStore,
)


def _name_to_key(name: str) -> str:
    """
    Converts an object name to a suitable S3 key.

    Args:
        name: The object name.

    Returns:
        The key to use.

    """
    return name.replace("-", "/")


def _key_to_name(key: str) -> str:
    """
    Converts an S3 key to an object name.

    Args:
        key: The key.

    Returns:
        The object name.

    """
    return key.replace("/", "-")


class _MultiPartUploadHelper:
    """
    Helper class to deal with multi-part uploads.
    """

    def __init__(self, client: AioBaseClient, object_id: ObjectRef):
        """
        Args:
            client: The S3 client to use.
            object_id: The ID of the object that we are uploading.

        Notes:
            This is not meant to be used directly. Use `create()` instead.
        """

        self.__client = client
        self.__object_id = object_id
        self.__upload_id = None

        # Uploads that are still in-progress.
        self.__pending_upload_tasks = set()
        # Maps entity tags to corresponding part numbers.
        self.__tags_to_part_numbers = {}
        # Maps pending tasks to corresponding part numbers.
        self.__tasks_to_part_numbers = {}
        # Keeps track of the current part number. (We assume parts are
        # uploaded in-order.)
        self.__part_number = 1

    @classmethod
    @asynccontextmanager
    async def create(
        cls, *, client: AioBaseClient, object_id: ObjectRef
    ) -> "AsyncIterable[_MultiPartUploadHelper]":
        """
        Context manager that creates a new instance.

        Args:
            client: The S3 client to use.
            object_id: The ID of the object that we are uploading.

        Yields:
            The new instance that it created.

        """
        uploader = cls(client, object_id)
        uploader.__upload_id = await uploader.__start_upload(
            uploader.__object_id
        )

        try:
            yield uploader

            # Make sure the upload is completed upon context manager exit.
            await uploader.finish()
        except Exception as error:
            # Make sure storage is freed if there is an error.
            await uploader.abort()
            raise error

    async def __start_upload(self, object_id: ObjectRef) -> str:
        """
        Starts a new multi-part upload.

        Args:
            object_id: The object to start the upload for.

        Returns:
            The upload ID.

        """
        logger.debug("Starting multi-part upload for {}.", object_id)

        response = await self.__client.create_multipart_upload(
            Bucket=object_id.bucket, Key=_name_to_key(object_id.name)
        )
        upload_id = response["UploadId"]

        logger.debug("Got upload ID: {}", upload_id)
        return upload_id

    def add_data(self, data: Union[bytes, BytesIO]) -> None:
        """
        Adds a new chunk of data to the file.

        Args:
            data: The data to add.

        """
        # We don't actually need to wait for this upload to complete,
        # so we simply spawn a new task.
        task = asyncio.create_task(
            self.__client.upload_part(
                Body=data,
                Bucket=self.__object_id.bucket,
                Key=_name_to_key(self.__object_id.name),
                UploadId=self.__upload_id,
                PartNumber=self.__part_number,
            )
        )
        self.__pending_upload_tasks.add(task)

        self.__tasks_to_part_numbers[task] = self.__part_number
        self.__part_number += 1

    async def wait_for_upload(self) -> None:
        """
        Waits for at least one pending upload to finish before returning.

        """
        # Wait for at least one to finish.
        done, pending = await asyncio.wait(
            self.__pending_upload_tasks, return_when=asyncio.FIRST_COMPLETED
        )
        self.__pending_upload_tasks = pending
        logger.debug(
            "Finished waiting, still have {} pending uploads.", len(pending)
        )

        for task in done:
            # Save the entity tag and part number.
            entity_tag = task.result()["ETag"]
            part_number = self.__tasks_to_part_numbers.pop(task)
            self.__tags_to_part_numbers[entity_tag] = part_number

    async def finish(self) -> None:
        """
        Finishes the upload, waiting for all parts to complete.

        Notes:
            This will be called automatically when exiting the context manager.

        """
        # Wait for all the uploads.
        while self.num_pending > 0:
            await self.wait_for_upload()

        # Create the parts list.
        parts = [
            {"ETag": k, "PartNumber": v}
            for k, v in self.__tags_to_part_numbers.items()
        ]
        # It insists that the parts be ordered by part number.
        parts.sort(key=lambda i: i["PartNumber"])

        # Finalize the upload.
        logger.debug("Finalizing upload of {}.", self.__object_id)
        await self.__client.complete_multipart_upload(
            Bucket=self.__object_id.bucket,
            Key=_name_to_key(self.__object_id.name),
            UploadId=self.__upload_id,
            MultipartUpload=dict(Parts=parts),
        )

    async def abort(self) -> None:
        """
        Aborts the upload.

        Notes:
            This will be called automatically by the context manager in case
            of error.

        """
        # Wait for any pending uploads to complete or error out first so we
        # can guarantee that all storage will be freed.
        logger.debug("Aborting, waiting for pending uploads...")
        while self.num_pending > 0:
            # This is hard to test reliably because we have to simulate an
            # upload that takes a long time.
            await self.wait_for_upload()  # pragma: no cover

        await self.__client.abort_multipart_upload(
            Bucket=self.__object_id.bucket,
            Key=_name_to_key(self.__object_id.name),
            UploadId=self.__upload_id,
        )

    @property
    def num_pending(self) -> int:
        """
        Returns:
            The number of currently-pending uploads.

        """
        return len(self.__pending_upload_tasks)


class _SafeObjectIter:
    """
    `aiobotocore` gets mad if we don't properly close response handles,
    so this class exists in order to make sure they get closed.

    """

    _DEFAULT_CHUNK_SIZE = 2**20
    """
    Default chunk size to use for the output iterator.
    """

    def __init__(
        self, response: StreamingBody, chunk_size: int = _DEFAULT_CHUNK_SIZE
    ):
        self.__response = response
        self.__chunk_size = chunk_size

    def __del__(self):
        # Ensure, at all costs, that the response is closed.
        self.__response.close()

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self

    async def __anext__(self) -> bytes:
        if chunk := await self.__response.read(self.__chunk_size):
            return chunk
        raise StopAsyncIteration


class S3ObjectStore(ObjectStore):
    """
    Object storage backend for object stores that follow the S3 API.
    """

    _MAX_CONCURRENT_UPLOADS = 5
    """
    Number of concurrent uploads to allow for multi-part uploads.
    """

    _BUCKET_EXISTS_ERROR_CODE = "BucketAlreadyOwnedByYou"
    """
    Error code that you get when you try to create a bucket that already exists.
    """

    def __init__(self, client: AioBaseClient, region: str = "us-east-1"):
        """
        Args:
            client: The S3 client to use.
            region: Region specifier. All data will be created under this
                region.

        """
        self.__client = client
        self.__region = region

    @staticmethod
    def __extract_error_code(error: ClientError) -> Optional[str]:
        """
        Extracts the error code from a `ClientError` exception.

        Args:
            error: The exception.

        Returns:
            The extracted error code, or None if there was none.

        """
        error_info = error.response.get("Error", {})
        return error_info.get("Code")

    @classmethod
    @asynccontextmanager
    async def from_config(
        cls: ObjectStore.ClassType, config: ConfigView
    ) -> AsyncIterator[ObjectStore.ClassType]:
        # Extract the configuration.
        region_name = config["region_name"].as_str()
        access_key = config["access_key"].as_str()
        access_key_id = config["access_key_id"].as_str()
        endpoint_url = config["endpoint_url"].as_str()

        logger.info(
            "Connecting to S3-compatible object store at {}.", endpoint_url
        )

        # Create the S3 client.
        session = get_session()
        async with session.create_client(
            "s3",
            region_name=region_name,
            aws_secret_access_key=access_key,
            aws_access_key_id=access_key_id,
            endpoint_url=endpoint_url,
        ) as client:
            yield cls(client, region=region_name)

    async def create_bucket(self, name: str, exists_ok: bool = False) -> None:
        logger.debug("Creating new bucket {}.", name)
        try:
            await self.__client.create_bucket(
                Bucket=name,
                CreateBucketConfiguration=dict(
                    LocationConstraint=self.__region
                ),
            )

        except ClientError as error:
            if (
                self.__extract_error_code(error)
                == self._BUCKET_EXISTS_ERROR_CODE
                and exists_ok
            ):
                # This bucket already exists.
                logger.debug(
                    "Bucket '{}' already exists, but we are ignoring that.",
                    name,
                )
                return

            raise BucketOperationError(str(error))

    async def bucket_exists(self, name: str) -> bool:
        try:
            await self.__client.head_bucket(Bucket=name)
            return True

        except ClientError as error:
            if self.__extract_error_code(error) == "404":
                # Bucket does not exist.
                return False
            # Some other error occurred.
            raise BucketOperationError(str(error))

    async def delete_bucket(self, name: str) -> None:
        if not await self.bucket_exists(name):
            raise KeyError(f"Bucket '{name}' does not exist.")

        logger.debug("Deleting bucket {}.", name)
        await self.__client.delete_bucket(Bucket=name)

    async def list_bucket_contents(self, name: str) -> AsyncIterable[str]:
        has_more_results = True
        continuation_token = None
        while has_more_results:
            logger.debug("Listing objects in bucket {}...", name)

            list_kwargs = dict(Bucket=name)
            if continuation_token is not None:
                # We have a continuation token from a previous request.
                list_kwargs["ContinuationToken"] = continuation_token

            response = await self.__client.list_objects_v2(**list_kwargs)

            # Yield all the results so far.
            for result in response["Contents"]:
                yield _key_to_name(result["Key"])

            # Check for additional results.
            has_more_results = response["IsTruncated"]
            if has_more_results:
                continuation_token = response["NextContinuationToken"]

    async def create_object(
        self,
        object_id: ObjectRef,
        *,
        data: bytes | BytesIO | UploadFile | AsyncIterable[bytes],
    ) -> None:
        if not await self.bucket_exists(object_id.bucket):
            raise KeyError(f"Bucket '{object_id.bucket}' does not exist.")
        logger.info("Requesting creation of new object {}.", object_id)

        @singledispatch
        async def _do_upload(data_: AsyncIterable[bytes]) -> None:
            # For async iterables, we do a multi-part upload.
            data_iter = aiter(data_)
            # Wait to create the MultiPartUploadHelper until the first chunk
            # is available in order to avoid sitting on a pool connection
            # while we're just waiting for someone to send us data.
            first_chunk = await anext(data_iter)
            logger.debug("Got first chunk for {}.", object_id)

            async with _MultiPartUploadHelper.create(
                client=self.__client, object_id=object_id
            ) as uploader:
                uploader.add_data(first_chunk)
                async for chunk in data_:
                    if uploader.num_pending >= self._MAX_CONCURRENT_UPLOADS:
                        # Wait for some uploads to finish.
                        await uploader.wait_for_upload()
                    uploader.add_data(chunk)

        @_do_upload.register
        async def _(data_: bytes | BytesIO) -> None:
            # For in-memory data, we just do a normal upload.
            await self.__client.put_object(
                Body=data_,
                Bucket=object_id.bucket,
                Key=_name_to_key(object_id.name),
            )

        @_do_upload.register
        async def _(data_: UploadFile) -> None:
            await _do_upload(
                read_file_chunks(data_, chunk_size=self.UPLOAD_CHUNK_SIZE)
            )

        await _do_upload(data)

    async def object_exists(self, object_id: ObjectRef) -> bool:
        try:
            await self.__client.head_object(
                Bucket=object_id.bucket, Key=_name_to_key(object_id.name)
            )
            return True

        except ClientError as error:
            if self.__extract_error_code(error) == "404":
                # Bucket does not exist.
                return False
            # Some other error occurred.
            raise ObjectOperationError(str(error))

    async def delete_object(self, object_id: ObjectRef) -> None:
        if not await self.object_exists(object_id):
            raise KeyError(f"Object '{object_id}' does not exist.")

        logger.info("Requesting deletion of object {}.", object_id)

        await self.__client.delete_object(
            Bucket=object_id.bucket, Key=_name_to_key(object_id.name)
        )

    async def get_object(self, object_id: ObjectRef) -> AsyncIterable[bytes]:
        try:
            data_object = await self.__client.get_object(
                Bucket=object_id.bucket, Key=_name_to_key(object_id.name)
            )
        except ClientError as error:
            if self.__extract_error_code(error) == "NoSuchKey":
                raise KeyError(f"Object '{object_id}' does not exist.")
            raise ObjectOperationError(str(error))

        body = data_object["Body"]
        return _SafeObjectIter(body)

    async def copy_object(
        self, source_id: ObjectRef, dest_id: ObjectRef
    ) -> None:
        """
        Copies an object.

        Args:
            source_id: The ID of the source object.
            dest_id: The ID of the destination object.

        """
        try:
            await self.__client.copy_object(
                Bucket=dest_id.bucket,
                Key=_name_to_key(dest_id.name),
                CopySource=f"{source_id.bucket}/{source_id.name}",
            )
        except ClientError as error:
            if self.__extract_error_code(error) == "NoSuchKey":
                raise KeyError(f"Object '{source_id}' does not exist.")
            raise ObjectOperationError(str(error))

    async def copy_bucket(self, bucket: str) -> None:
        """
        Copies the contents of an entire bucket.

        Args:
            bucket: The bucket to copy.

        """
        async for name in self.list_bucket_contents(bucket):
            if _name_to_key(name) == name:
                # This already has the correct key.
                continue

            logger.debug("Copying {}/{}...", bucket, name)
            await self.copy_object(
                ObjectRef(bucket=bucket, name=name),
                ObjectRef(bucket=bucket, name=name),
            )
