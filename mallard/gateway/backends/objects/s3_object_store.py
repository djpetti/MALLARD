"""
Object storage backend for object stores that follow the S3 API.
"""

from io import BytesIO
from typing import AsyncIterable, AsyncIterator, Optional, Union

from aiobotocore import get_session
from aiobotocore.client import AioBaseClient
from botocore.exceptions import ClientError
from confuse import ConfigView
from fastapi import UploadFile
from loguru import logger

from .models import ObjectRef
from .object_store import (
    BucketOperationError,
    ObjectOperationError,
    ObjectStore,
)


class S3ObjectStore(ObjectStore):
    """
    Object storage backend for object stores that follow the S3 API.
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
    async def from_config(
        cls: ObjectStore.ClassType, config: ConfigView
    ) -> AsyncIterator[ObjectStore.ClassType]:
        # Extract the configuration.
        region_name = config["region_name"].as_str()
        access_key = config["access_key"].as_str()
        access_key_id = config["access_key_id"].as_str()
        endpoint_url = config["endpoint_url"].as_str()

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

    async def create_bucket(self, name: str) -> None:
        logger.debug("Creating new bucket {}.", name)
        await self.__client.create_bucket(
            Bucket=name,
            CreateBucketConfiguration=dict(LocationConstraint=self.__region),
        )

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
                yield result["Key"]

            # Check for additional results.
            has_more_results = response["IsTruncated"]
            if has_more_results:
                continuation_token = response["NextContinuationToken"]

    async def create_object(
        self, object_id: ObjectRef, *, data: Union[bytes, BytesIO, UploadFile]
    ) -> None:
        if not await self.bucket_exists(object_id.bucket):
            raise KeyError(f"Bucket '{object_id.bucket}' does not exist.")

        logger.info("Requesting creating of new object {}.", object_id)
        await self.__client.put_object(
            Body=data, Bucket=object_id.bucket, Key=object_id.name
        )

    async def object_exists(self, object_id: ObjectRef) -> bool:
        try:
            await self.__client.head_object(
                Bucket=object_id.bucket, Key=object_id.name
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
            Bucket=object_id.bucket, Key=object_id.name
        )

    async def get_object(self, object_id: ObjectRef) -> AsyncIterable[bytes]:
        try:
            data_object = await self.__client.get_object(
                Bucket=object_id.bucket, Key=object_id.name
            )
        except ClientError as error:
            if self.__extract_error_code(error) == "NoSuchKey":
                raise KeyError(f"Object '{object_id}' does not exist.")
            raise ObjectOperationError(str(error))

        body = data_object["Body"]
        return body.iter_chunks()
