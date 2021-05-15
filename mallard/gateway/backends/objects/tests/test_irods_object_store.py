"""
Tests for the `irods_object_store` module.
"""


import enum
import io
from pathlib import Path
from typing import Type, Union

import pytest
from faker import Faker
from fastapi import UploadFile
from irods.data_object import DataObject
from irods.exception import (
    OVERWRITE_WITHOUT_FORCE_FLAG,
    CollectionDoesNotExist,
    DataObjectDoesNotExist,
)
from irods.manager.collection_manager import CollectionManager
from irods.manager.data_object_manager import DataObjectManager
from irods.session import iRODSSession
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.gateway.backends import irods_store
from mallard.gateway.backends.objects import irods_object_store
from mallard.gateway.config_view_mock import ConfigViewMock
from mallard.type_helpers import ArbitraryTypesConfig


class TestIrodsObjectStore:
    """
    Tests for the `IrodsObjectStore` class.
    """

    @dataclass(frozen=True, config=ArbitraryTypesConfig)
    class ConfigForTests:
        """
        Encapsulates standard configuration for most tests.

        Attributes:
            store: The `IrodsObjectStore` under test.
            mock_session: The mocked `iRODSSession` instance.
            root_collection: The root collection path that we use for the store.

        """

        store: irods_object_store.IrodsObjectStore
        mock_session: iRODSSession
        root_collection: Path

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
        mock_session = mocker.create_autospec(iRODSSession, instance=True)
        # Auto-speccing doesn't work on these properties, so we have to set
        # them manually.
        mock_session.collections = mocker.create_autospec(
            CollectionManager, instance=True
        )
        mock_session.data_objects = mocker.create_autospec(
            DataObjectManager, instance=True
        )

        root_path = Path(faker.file_path(depth=2)).parent

        store = irods_object_store.IrodsObjectStore(
            session=mock_session, root_collection=root_path
        )

        return cls.ConfigForTests(
            store=store, mock_session=mock_session, root_collection=root_path
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
        # It should have created an underlying collection.
        expected_path = config.root_collection / "test_bucket"
        config.mock_session.collections.create.assert_called_once_with(
            expected_path.as_posix()
        )

    @pytest.mark.asyncio
    async def test_bucket_exists(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `bucket_exists` works.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Make it look like the bucket either exists or doesn't.
        exists = faker.pybool()
        config.mock_session.collections.exists.return_value = exists

        # Act.
        got_exists = await config.store.bucket_exists("test_bucket")

        # Assert.
        # It should have gotten the right result.
        assert got_exists == exists

        # It should have checked for the collection.
        expected_path = config.root_collection / "test_bucket"
        config.mock_session.collections.exists.assert_called_once_with(
            expected_path.as_posix()
        )

    @pytest.mark.asyncio
    async def test_delete_bucket(self, config: ConfigForTests) -> None:
        """
        Tests that `delete_bucket` works.

        Args:
            config: The configuration to use for testing.

        """
        # Arrange.
        # Make it look like the bucket exists.
        config.mock_session.collections.exists.return_value = True

        # Act.
        await config.store.delete_bucket("test_bucket")

        # Assert.
        # It should have checked that the bucket exists.
        expected_path = config.root_collection / "test_bucket"
        config.mock_session.collections.exists.assert_called_once_with(
            expected_path.as_posix()
        )
        # It should have deleted it.
        config.mock_session.collections.remove.assert_called_once_with(
            expected_path.as_posix(), force=True
        )

    @pytest.mark.asyncio
    async def test_delete_bucket_nonexistent(
        self, config: ConfigForTests
    ) -> None:
        """
        Tests that `delete_bucket` handles it when the bucket does not exist.

        Args:
            config: The configuration to use for testing.

        """
        # Arrange.
        # Make it look like the bucket does not exist.
        config.mock_session.collections.exists.return_value = False

        # Act and assert.
        with pytest.raises(KeyError, match="does not exist"):
            await config.store.delete_bucket("test_bucket")

    @pytest.mark.asyncio
    async def test_list_bucket_contents(
        self, config: ConfigForTests, mocker: MockFixture
    ) -> None:
        """
        Tests that `list_bucket_contents` works.

        Args:
            config: The configuration to use for testing.
            mocker: The fixture to use for mocking.

        """
        # Arrange.
        # Make it look like the bucket contains some objects.
        data_objects = [
            mocker.create_autospec(DataObject, instance=True) for _ in range(3)
        ]
        mock_collection = config.mock_session.collections.get.return_value
        mock_collection.data_objects = data_objects

        # Act.
        got_names = [
            n async for n in config.store.list_bucket_contents("test_bucket")
        ]

        # Assert.
        # It should have gotten the right names.
        for data_object, name in zip(data_objects, got_names):
            assert name == data_object.name

        # It should have accessed the collection.
        collection_path = config.root_collection / "test_bucket"
        config.mock_session.collections.get.assert_called_once_with(
            collection_path.as_posix()
        )

    @pytest.mark.asyncio
    async def test_list_bucket_contents_nonexistent(
        self, config: ConfigForTests
    ) -> None:
        """
        Tests that `list_bucket_contents` handles it when the bucket does not
        exist.

        Args:
            config: The configuration to use for testing.

        """
        # Arrange.
        # Make it look like the bucket does not exist.
        config.mock_session.collections.get.side_effect = (
            CollectionDoesNotExist
        )

        # Act and assert.
        with pytest.raises(KeyError, match="does not exist"):
            async for _ in config.store.list_bucket_contents("test_bucket"):
                pass

    @enum.unique
    class CreateFileCondition(enum.IntEnum):
        """
        Specifies the circumstances under which we will test file creation.
        """

        NEW_FILE = enum.auto()
        """
        File does not exist yet.
        """
        OVERWRITE = enum.auto()
        """
        File exists, and we should overwrite.
        """
        OVERWRITE_RACE = enum.auto()
        """
        It looks like the file does not exist initially, it got created
        concurrently.
        """

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "data_type",
        (bytes, io.BytesIO, UploadFile),
        ids=("bytes", "bytes_io", "upload_file"),
    )
    @pytest.mark.parametrize(
        "file_condition",
        CreateFileCondition,
        ids=[e.name for e in CreateFileCondition],
    )
    async def test_create_object(
        self,
        config: ConfigForTests,
        faker: Faker,
        mocker: MockFixture,
        data_type: Type[Union[bytes, io.BytesIO, UploadFile]],
        file_condition: CreateFileCondition,
    ) -> None:
        """
        Tests that `create_object` works.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            mocker: The fixture to use for mocking.
            data_type: The type of data to try testing with.
            file_condition: Indicates whether there is any pre-existing file,
                and if so, what condition it's in.

        """
        # Arrange.
        if file_condition == self.CreateFileCondition.NEW_FILE:
            # It will try to get the object before creating, so make sure it
            # looks like the object initially doesn't exist.
            config.mock_session.data_objects.get.side_effect = (
                DataObjectDoesNotExist
            )
        elif file_condition == self.CreateFileCondition.OVERWRITE_RACE:
            # In this case, we want to first get operation to fail but the
            # second to succeed.
            config.mock_session.data_objects.get.side_effect = (
                DataObjectDoesNotExist,
                mocker.DEFAULT,
            )
            # We also want the create operation to fail.
            config.mock_session.data_objects.create.side_effect = (
                OVERWRITE_WITHOUT_FORCE_FLAG
            )

        # Factories for creating test data.
        test_bytes = faker.binary(length=64)
        data_factories = {
            bytes: lambda: test_bytes,
            io.BytesIO: lambda: io.BytesIO(test_bytes),
            UploadFile: lambda: faker.upload_file(contents=test_bytes),
        }
        test_data = data_factories[data_type]()

        # Create a fake file handle to use as the destination for the copy.
        irods_file = io.BytesIO()
        if file_condition == self.CreateFileCondition.NEW_FILE:
            mock_data_object = (
                config.mock_session.data_objects.create.return_value
            )
        else:
            mock_data_object = (
                config.mock_session.data_objects.get.return_value
            )
        mock_data_object.open.return_value.__enter__.return_value = irods_file

        # Make it look like the bucket exists.
        config.mock_session.collections.exists.return_value = True

        object_id = faker.object_ref()

        # Act.
        await config.store.create_object(object_id, data=test_data)

        # Assert.
        # It should have created the object.
        expected_path = (
            config.root_collection / object_id.bucket / object_id.name
        )

        if file_condition in {
            self.CreateFileCondition.NEW_FILE,
            self.CreateFileCondition.OVERWRITE_RACE,
        }:
            # It should have tried to create the file.
            config.mock_session.data_objects.create.assert_called_once_with(
                expected_path.as_posix()
            )
        if file_condition == self.CreateFileCondition.OVERWRITE_RACE:
            # It should have gotten the file twice.
            config.mock_session.data_objects.get.assert_has_calls(
                [mocker.call(expected_path.as_posix())] * 2
            )

        # It should have copied the data.
        mock_data_object.open.assert_called_once()
        assert irods_file.getvalue() == test_bytes

    @pytest.mark.asyncio
    async def test_create_object_nonexistent_bucket(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `create_object` handles it appropriately when the bucket
        does not exist.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Make it look like the bucket does not exist.
        config.mock_session.collections.exists.return_value = False

        # Act and assert.
        with pytest.raises(KeyError, match="does not exist"):
            await config.store.create_object(faker.object_ref(), data=b"")

    @pytest.mark.asyncio
    async def test_object_exists(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `object_exists` works.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Make it look like the bucket either exists or does not.
        exists = faker.pybool()
        config.mock_session.data_objects.exists.return_value = exists

        object_id = faker.object_ref()

        # Act.
        got_exists = await config.store.object_exists(object_id)

        # Assert.
        assert got_exists == exists

        # It should have checked for the object.
        expected_path = (
            config.root_collection / object_id.bucket / object_id.name
        )
        config.mock_session.data_objects.exists.assert_called_once_with(
            expected_path.as_posix()
        )

    @pytest.mark.asyncio
    async def test_delete_object(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `delete_object` works.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Make it look like the object exists.
        config.mock_session.data_objects.exists.return_value = True

        object_id = faker.object_ref()

        # Act.
        await config.store.delete_object(object_id)

        # Assert.
        # It should have deleted the object.
        expected_path = (
            config.root_collection / object_id.bucket / object_id.name
        )
        config.mock_session.data_objects.unlink.assert_called_once_with(
            expected_path.as_posix(), force=True
        )

    @pytest.mark.asyncio
    async def test_delete_object_nonexistent(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `delete_object` handles it when the object does not exist.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Make it look like the object doesn't exist.
        config.mock_session.data_objects.exists.return_value = False

        # Act and assert.
        with pytest.raises(KeyError, match="does not exist"):
            await config.store.delete_object(faker.object_ref())

    @pytest.mark.asyncio
    async def test_get_object(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `get_object` works.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        object_id = faker.object_ref()

        # Act.
        got_data = await config.store.get_object(object_id)

        # Assert.
        # It should have read the correct object.
        expected_path = (
            config.root_collection / object_id.bucket / object_id.name
        )
        config.mock_session.data_objects.get.assert_called_once_with(
            expected_path.as_posix()
        )
        mock_object = config.mock_session.data_objects.get.return_value

        mock_object.open.assert_called_once_with("r")
        assert got_data == mock_object.open.return_value

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "exception",
        [DataObjectDoesNotExist, CollectionDoesNotExist],
        ids=["missing_object", "missing_collection"],
    )
    async def test_get_object_nonexistent(
        self, config: ConfigForTests, faker: Faker, exception: Type[Exception]
    ) -> None:
        """
        Tests tht `get_object` handles it when the object does not exist.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            exception: Specific exception type to raise internally.

        """
        # Arrange.
        # Make it look like the requested object does not exist.
        config.mock_session.data_objects.get.side_effect = exception

        # Act and assert.
        with pytest.raises(KeyError, match="does not exist"):
            await config.store.get_object(faker.object_ref())

    @pytest.mark.asyncio
    async def test_from_config(
        self, config: ConfigForTests, mocker: MockFixture
    ) -> None:
        """
        Tests that `from_config` works.

        Args:
            config: The configuration to use for testing.
            mocker: The fixture to use for mocking.

        """
        # Arrange.
        # Create the fake config data.
        mock_config = ConfigViewMock()

        # Mock the iRODSSession class.
        mock_session_class = mocker.patch(
            irods_store.__name__ + ".iRODSSession"
        )

        # Act.
        async with irods_object_store.IrodsObjectStore.from_config(
            mock_config
        ):
            # Assert.
            # It should have created the session.
            mock_session_class.assert_called_once_with(
                host=mock_config["host"].as_str.return_value,
                port=mock_config["port"].get.return_value,
                user=mock_config["user"].as_str.return_value,
                password=mock_config["password"].as_str.return_value,
                zone=mock_config["zone"].as_str.return_value,
            )
