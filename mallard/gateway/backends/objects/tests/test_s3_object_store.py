"""
Tests for the `s3_object_store` module.
"""


import unittest.mock as mock
from typing import Any, Dict, List

import pytest
from aiobotocore.client import AioBaseClient
from aiobotocore.response import StreamingBody
from faker import Faker
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.gateway.backends.objects import s3_object_store
from mallard.gateway.backends.objects.object_store import (
    BucketOperationError,
    ObjectOperationError,
)
from mallard.type_helpers import ArbitraryTypesConfig


class TestS3ObjectStore:
    """
    Tests for the `S3ObjectStore` class.
    """

    @dataclass(frozen=True, config=ArbitraryTypesConfig)
    class ConfigForTests:
        """
        Encapsulates standard configuration for most tests.

        Attributes:
            store: The `S3ObjectStore` under test.
            mock_client: The mocked S3 client.
            region: Region we used when creating the store.

        """

        store: s3_object_store.S3ObjectStore
        mock_client: mock.Mock
        region: str

    @classmethod
    @pytest.fixture
    def config(cls, mocker: MockFixture, faker: Faker) -> ConfigForTests:
        """
        Generates standard configuration for most tests.

        Args:
            mocker: The fixture to use for mocking.
            faker: The fixture to use for generating fake data.

        Returns:
            The configuration that it created.

        """
        # Mock the dependencies.
        mock_client = mocker.Mock(spec=AioBaseClient, instance=True)
        # aiobotocore does some fancy dynamic class-creation stuff,
        # so we have to manually spec out the methods we want to use.
        mock_client.create_bucket = mocker.AsyncMock()
        mock_client.head_bucket = mocker.AsyncMock()
        mock_client.delete_bucket = mocker.AsyncMock()
        mock_client.list_objects_v2 = mocker.AsyncMock()
        mock_client.put_object = mocker.AsyncMock()
        mock_client.head_object = mocker.AsyncMock()
        mock_client.delete_object = mocker.AsyncMock()
        mock_client.get_object = mocker.AsyncMock()

        fake_region = faker.word()

        store = s3_object_store.S3ObjectStore(mock_client, region=fake_region)

        return cls.ConfigForTests(
            store=store, mock_client=mock_client, region=fake_region
        )

    @pytest.mark.asyncio
    async def test_create_bucket(self, config: ConfigForTests) -> None:
        """
        Tests that `create_bucket` works.

        Args:
            config: The configuration to use for testing.

        """
        # Act.
        await config.store.create_bucket("test_bucket")

        # Assert.
        # It should have created the bucket.
        config.mock_client.create_bucket.assert_called_once_with(
            Bucket="test_bucket",
            CreateBucketConfiguration=dict(LocationConstraint=config.region),
        )

    @pytest.mark.asyncio
    async def test_bucket_exists_true(self, config: ConfigForTests) -> None:
        """
        Tests that `bucket_exists` works when the bucket does exist.

        Args:
            config: The configuration to use for testing.

        """
        # Act.
        got_exists = await config.store.bucket_exists("test_bucket")

        # Assert.
        # It should have been marked as existing.
        assert got_exists
        # It should have checked with the backend.
        config.mock_client.head_bucket.assert_called_once_with(
            Bucket="test_bucket"
        )

    @pytest.mark.asyncio
    async def test_bucket_exists_false(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `bucket_exists` works when the bucket does not exist.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Make it look like getting the bucket metadata fails.
        client_error = faker.client_error("404")
        config.mock_client.head_bucket.side_effect = client_error

        # Act.
        got_exists = await config.store.bucket_exists("test_bucket")

        # Assert.
        # It should have been marked as not existing.
        assert not got_exists
        # It should have checked with the backend.
        config.mock_client.head_bucket.assert_called_once_with(
            Bucket="test_bucket"
        )

    @pytest.mark.asyncio
    async def test_bucket_exists_failure(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `bucket_exists` fails when some unexpected error occurs.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Make it look like getting the bucket metadata fails with an unknown
        # error.
        client_error = faker.client_error("unknown")
        config.mock_client.head_bucket.side_effect = client_error

        # Act and assert.
        with pytest.raises(BucketOperationError):
            await config.store.bucket_exists("test_bucket")

    @pytest.mark.asyncio
    async def test_bucket_delete(self, config: ConfigForTests) -> None:
        """
        Tests that we can delete a bucket.

        Args:
            config: The configuration to use for testing.

        """
        # Act.
        await config.store.delete_bucket("test_bucket")

        # Assert.
        # It should have done the deletion on the backend.
        config.mock_client.delete_bucket.assert_called_once_with(
            Bucket="test_bucket"
        )

    @pytest.mark.asyncio
    async def test_delete_bucket_non_existent(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that deleting a bucket fails when that bucket does not exist.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Make it look like the bucket doesn't exist.
        client_error = faker.client_error("404")
        config.mock_client.head_bucket.side_effect = client_error

        # Act and assert.
        with pytest.raises(KeyError, match="does not exist"):
            await config.store.delete_bucket("test_bucket")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "num_pages", [0, 1, 3], ids=("no_results", "single_page", "multi_page")
    )
    async def test_list_bucket_contents(
        self, config: ConfigForTests, faker: Faker, num_pages: int
    ) -> None:
        """
        Tests that `list_bucket_contents` works.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            num_pages: The number of pages of results to simulate.

        """
        # Arrange.
        def _fake_results(num_results: int) -> List[Dict[str, str]]:
            # Creates fake results.
            return [dict(Key=faker.pystr()) for _ in range(num_results)]

        def _fake_response(is_truncated: bool) -> Dict[str, Any]:
            # Creates a fake response dict.
            num_results = faker.random_int(max=100)
            response = dict(
                Contents=_fake_results(num_results), IsTruncated=is_truncated
            )
            if is_truncated:
                # Add the continuation token.
                response["NextContinuationToken"] = faker.pystr()

            return response

        # Create fake responses.
        if num_pages == 0:
            # Empty response.
            responses = [dict(Contents=[], IsTruncated=False)]
        else:
            responses = [_fake_response(True) for _ in range(num_pages - 1)]
            # Last one should not be truncated.
            responses.append(_fake_response(False))

        config.mock_client.list_objects_v2.side_effect = responses

        # Act.
        results = [
            r async for r in config.store.list_bucket_contents("test_bucket")
        ]

        # Assert.
        # It should have gotten the correct results.
        expected_keys = []
        for page in responses:
            expected_keys.extend((r["Key"] for r in page["Contents"]))
        assert results == expected_keys

        # It should have made a backend call for each page.
        assert config.mock_client.list_objects_v2.call_count == len(responses)
        # It should have used each continuation token.
        for page in responses[:-1]:
            config.mock_client.list_objects_v2.assert_any_call(
                Bucket="test_bucket",
                ContinuationToken=page["NextContinuationToken"],
            )
        # The first page should not have a continuation token.
        config.mock_client.list_objects_v2.assert_any_call(
            Bucket="test_bucket"
        )

    @pytest.mark.asyncio
    async def test_create_object(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that we can create an object.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        object_id = faker.object_ref()
        # Create some fake data.
        blob = faker.binary(1024)

        # Act.
        await config.store.create_object(object_id, data=blob)

        # Assert.
        # It should have put the object on the backend.
        config.mock_client.put_object.assert_called_once_with(
            Body=blob, Bucket=object_id.bucket, Key=object_id.name
        )

    @pytest.mark.asyncio
    async def test_object_exists_true(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `object_exists` works when the object does exist.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        object_id = faker.object_ref()

        # Act.
        got_exists = await config.store.object_exists(object_id)

        # Assert.
        # It should report that the object exists.
        assert got_exists
        # It should have checked on the backend.
        config.mock_client.head_object.assert_called_once_with(
            Bucket=object_id.bucket, Key=object_id.name
        )

    @pytest.mark.asyncio
    async def test_object_exists_false(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `object_exists` works when the object does not exist.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        object_id = faker.object_ref()

        # Make it look like the backend call fails.
        client_error = faker.client_error("404")
        config.mock_client.head_object.side_effect = client_error

        # Act.
        got_exists = await config.store.object_exists(object_id)

        # Assert.
        # It should report that the object doesn't exist.
        assert not got_exists
        # It should have checked on the backend.
        config.mock_client.head_object.assert_called_once_with(
            Bucket=object_id.bucket, Key=object_id.name
        )

    @pytest.mark.asyncio
    async def test_object_exists_failure(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `object_exists` handles it when there is an unexpected
        failure.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        object_id = faker.object_ref()

        # Make it look like the backend call fails unexpectedly.
        client_error = faker.client_error("unknown")
        config.mock_client.head_object.side_effect = client_error

        # Act and assert.
        with pytest.raises(ObjectOperationError):
            await config.store.object_exists(object_id)

    @pytest.mark.asyncio
    async def test_delete_object(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that we can delete an object.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        object_id = faker.object_ref()

        # Act.
        await config.store.delete_object(object_id)

        # Assert.
        # It should have deleted the object on the backend.
        config.mock_client.delete_object.assert_called_once_with(
            Bucket=object_id.bucket, Key=object_id.name
        )

    @pytest.mark.asyncio
    async def test_delete_object_nonexistent(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that deleting an object fails when that object does not exist.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        object_id = faker.object_ref()

        # Make it look like the object does not exist.
        client_error = faker.client_error("404")
        config.mock_client.head_object.side_effect = client_error

        # Act and assert.
        with pytest.raises(KeyError, match="does not exist"):
            await config.store.delete_object(object_id)

    @pytest.mark.asyncio
    async def test_get_object(
        self, config: ConfigForTests, faker: Faker, mocker: MockFixture
    ) -> None:
        """
        Tests that we can get an object.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            mocker: The fixture to use for mocking.

        """
        # Arrange.
        object_id = faker.object_ref()

        # Make it look like we got valid data.
        mock_body = mocker.create_autospec(StreamingBody, instace=True)
        config.mock_client.get_object.return_value = dict(Body=mock_body)

        # Act.
        got_data = await config.store.get_object(object_id)

        # Assert.
        # It should have read the data from the backend.
        config.mock_client.get_object.assert_called_once_with(
            Bucket=object_id.bucket, Key=object_id.name
        )

        mock_body.iter_chunks.assert_called_once_with()
        assert got_data == mock_body.iter_chunks.return_value

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "nonexistent", [True, False], ids=("nonexistent", "unknown")
    )
    async def test_get_object_failure(
        self, config: ConfigForTests, faker: Faker, nonexistent: bool
    ) -> None:
        """
        Tests that `get_object` handles failure conditions correctly.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            nonexistent: If true, simulate a nonexistent object. Otherwise,
                simulate a miscellaneous error.

        """
        # Arrange.
        # Make it look like getting the object failed.
        error_code = "unknown"
        if nonexistent:
            error_code = "NoSuchKey"
        client_error = faker.client_error(error_code)
        config.mock_client.get_object.side_effect = client_error

        # Act and assert.
        expected_error = ObjectOperationError
        if nonexistent:
            expected_error = KeyError

        with pytest.raises(expected_error):
            await config.store.get_object(object_id=faker.object_ref())
