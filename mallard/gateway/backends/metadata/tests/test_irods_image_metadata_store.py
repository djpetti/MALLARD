"""
Tests for the `irods_image_metadata_store` module.
"""

import unittest.mock as mock
from pathlib import Path
from typing import AsyncIterable, Type

import pytest
from faker import Faker
from irods.data_object import iRODSDataObject
from irods.exception import CollectionDoesNotExist, DataObjectDoesNotExist
from irods.manager.collection_manager import CollectionManager
from irods.manager.data_object_manager import DataObjectManager
from irods.meta import iRODSMeta
from irods.models import Collection, DataObject, DataObjectMeta
from irods.session import iRODSSession
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.gateway.backends.metadata import (
    irods_image_metadata_store,
    irods_metadata_store,
)
from mallard.gateway.backends.metadata.schemas import (
    ImageMetadata,
    ImageQuery,
    UavImageMetadata,
)
from mallard.type_helpers import ArbitraryTypesConfig, Request


class TestIrodsImageMetadataStore:
    """
    Tests for the `IrodsImageMetadataStore` class.
    """

    @dataclass(frozen=True, config=ArbitraryTypesConfig)
    class ClassSpecificConfig:
        """
        Encapsulates configuration that is specific to each
        `IrodsImageMetadataStore` subclass.

        Attributes:
            subclass: The `IrodsImageMetadataStore` subclass we are testing.
            metadata_type: The underlying `Metadata` subclass that we store
                and produce.

        """

        subclass: Type[irods_image_metadata_store.IrodsImageMetadataStore]
        metadata_type: Type[ImageMetadata]

    @dataclass(frozen=True, config=ArbitraryTypesConfig)
    class ConfigForTests:
        """
        Encapsulates standard configuration for most tests.

        Attributes:
            store: The `IrodsImageMetadataStore` under test.
            mock_session: The mocked `iRODSSession`.
            mock_to_irods_string: The mocked `to_irods_string` function.
            mock_make_async_iter: The mocked `make_async_iter` function.

            root_collection: The root collection path that we use for the store.
            metadata: Fake metadata to use for testing.

        """

        store: irods_image_metadata_store.IrodsImageMetadataStore
        mock_session: iRODSSession
        mock_to_irods_string: mock.Mock
        mock_make_async_iter: mock.Mock

        root_collection: Path
        metadata: ImageMetadata

    @classmethod
    @pytest.fixture(
        params=[
            ClassSpecificConfig(
                subclass=irods_image_metadata_store.IrodsImageMetadataStore,
                metadata_type=ImageMetadata,
            ),
            ClassSpecificConfig(
                subclass=irods_image_metadata_store.IrodsUavImageMetadataStore,
                metadata_type=UavImageMetadata,
            ),
        ],
        ids=["image_metadata", "uav_image_metadata"],
    )
    def class_specific_config(cls, request: Request) -> ClassSpecificConfig:
        """
        Generates subclass-specific configuration for each test.

        Args:
            request: The PyTest `Request` object.

        Returns:
            The subclass-specific configuration.

        """
        return request.param

    @classmethod
    @pytest.fixture
    def config(
        cls,
        mocker: MockFixture,
        faker: Faker,
        class_specific_config: ClassSpecificConfig,
    ) -> ConfigForTests:
        """
        Generates standard configuration for most tests.

        Args:
            mocker: The fixture to use for mocking.
            faker: The fixture to use for generating fake data.
            class_specific_config: Subclass-specific configuration for testing.

        Returns:
            The configuration that it generated.

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

        # Mock out the `make_async_iter` function.
        mock_make_async_iter = mocker.patch(
            irods_image_metadata_store.__name__ + ".make_async_iter"
        )

        # By default, we produce an empty iterable.
        class EmptyIter:
            def __aiter__(self):
                return self

            async def __anext__(self):
                raise StopAsyncIteration

        mock_make_async_iter.return_value = EmptyIter()

        # Mock out the serialization functions so they are simply passthroughs.
        mock_to_irods_string = mocker.patch(
            irods_metadata_store.__name__ + ".to_irods_string"
        )
        mock_to_irods_string.side_effect = lambda x: x

        # Mock out the retry decorator so it does nothing.
        mock_retry = mocker.patch(irods_metadata_store.__name__ + ".retry")
        mock_retry.side_effect = lambda x: x

        root_path = Path(faker.file_path(depth=2)).parent

        store = class_specific_config.subclass(
            session=mock_session, root_collection=root_path
        )

        # Create fake metadata.
        types_to_faker_functions = {
            UavImageMetadata: faker.uav_image_metadata,
            ImageMetadata: faker.image_metadata,
        }
        metadata = types_to_faker_functions[
            class_specific_config.metadata_type
        ]()

        return cls.ConfigForTests(
            store=store,
            mock_session=mock_session,
            root_collection=root_path,
            mock_to_irods_string=mock_to_irods_string,
            mock_make_async_iter=mock_make_async_iter,
            metadata=metadata,
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "already_exists",
        [False, True],
        ids=("new_file", "existing_file"),
    )
    @pytest.mark.parametrize(
        "overwrite", [False, True], ids=("no_overwrite", "overwrite")
    )
    async def test_add(
        self,
        config: ConfigForTests,
        faker: Faker,
        mocker: MockFixture,
        already_exists: bool,
        overwrite: bool,
    ) -> None:
        """
        Tests that `add` works.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            mocker: The fixture to use for mocking.
            already_exists: If false, test the case where the object doesn't
                exist yet. Otherwise, assume the object exists.
            overwrite: If true, test the case where we enable overwriting
                existing metadata.

        """
        # Arrange.
        # Create the fake data object we are setting metadata on.
        mock_data_object = mocker.create_autospec(iRODSDataObject)
        config.mock_session.data_objects.get.return_value = mock_data_object
        config.mock_session.data_objects.create.return_value = mock_data_object

        # Make it look like we have actual metadata items.
        mock_metadata_items = [
            mocker.create_autospec(iRODSMeta, instance=True)
        ] * 2
        mock_data_object.metadata.items.return_value = mock_metadata_items

        if not already_exists:
            # Make sure it looks like the object initially doesn't exist.
            config.mock_session.data_objects.get.side_effect = (
                DataObjectDoesNotExist
            )

        # Create a fake object to add metadata for.
        object_id = faker.object_ref()

        # Act.
        await config.store.add(
            object_id=object_id, metadata=config.metadata, overwrite=overwrite
        )

        # Assert.
        config.mock_session.data_objects.get.assert_called_once()
        if not already_exists:
            # It should have created the data object.
            config.mock_session.data_objects.create.assert_called_once()

        if overwrite:
            # It should have deleted existing metadata.
            mock_data_object.metadata.remove.assert_has_calls(
                [mocker.call(i) for i in mock_metadata_items]
            )

        # It should have applied the metadata.
        mock_data_object.metadata.add.assert_called()
        # One of them should contain the full JSON data.
        mock_data_object.metadata.add.assert_any_call(
            "json", config.metadata.json()
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "new_metadata_type",
        [ImageMetadata, UavImageMetadata],
        ids=["image_metadata", "uav_image_metadata"],
    )
    @pytest.mark.parametrize(
        "merge", [True, False], ids=("merge", "overwrite")
    )
    async def test_update(
        self,
        config: ConfigForTests,
        class_specific_config: ClassSpecificConfig,
        faker: Faker,
        new_metadata_type: Type[ImageMetadata],
        merge: bool,
    ) -> None:
        """
        Tests that `update` works.

        Args:
            config: The configuration to use for testing.
            class_specific_config: The subclass-specific configuration.
            faker: The fixture to use for generating fake data.
            new_metadata_type: The type of new metadata to pass in.
            merge: Whether to test merging or overwriting.

        """
        # Arrange.
        # Make it look like we have some existing metadata.
        old_metadata = config.metadata
        mock_data_object = config.mock_session.data_objects.get.return_value
        metadata_avus = iRODSMeta(name="json", value=old_metadata.json())
        mock_data_object.metadata.get_one.return_value = metadata_avus

        # Create some new metadata.
        if new_metadata_type == ImageMetadata:
            new_metadata = faker.image_metadata()
        else:
            new_metadata = faker.uav_image_metadata()
        # Don't fill some of the attributes.
        new_metadata = new_metadata.copy(update=dict(name=None, camera=None))

        # Make sure we can successfully update the metadata.
        mock_data_object.metadata.items.return_value = []

        object_id = faker.object_ref()

        # Act.
        # Try updating the object.
        await config.store.update(
            object_id=object_id, metadata=new_metadata, merge=merge
        )

        # Assert.
        if merge:
            # It should have gotten the original metadata.
            config.mock_session.data_objects.get.assert_called()
            mock_data_object.metadata.get_one.assert_called_once_with("json")

        # It should have set the new metadata.
        mock_data_object.metadata.add.assert_called()
        # Check that the proper new metadata was set.
        expected_call = mock.call("json", mock.ANY)
        all_calls = mock_data_object.metadata.add.mock_calls
        assert expected_call in all_calls
        actual_call = all_calls[all_calls.index(expected_call)]
        _, args, _ = actual_call
        got_new_metadata_json = args[1]
        got_new_metadata = class_specific_config.metadata_type.parse_raw(
            got_new_metadata_json
        )

        modified_fields = set()
        if merge:
            # It should not have overwritten the fields we wanted to keep.
            assert got_new_metadata.name == old_metadata.name
            assert got_new_metadata.camera == old_metadata.camera

            # Everything else should be updated.
            modified_fields = {"name", "camera"}

        got_unmodified = got_new_metadata.dict(exclude=modified_fields)
        expected_unmodified = new_metadata.dict(exclude=modified_fields)
        # There might be some differences in the fields between the two
        # of them, because they could be different subclasses of
        # ImageMetadata.
        for key in got_unmodified.keys() & expected_unmodified.keys():
            assert got_unmodified[key] == expected_unmodified[key]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "object_exists", [True, False], ids=("exists", "already_deleted")
    )
    async def test_delete(
        self,
        config: ConfigForTests,
        faker: Faker,
        mocker: MockFixture,
        object_exists: bool,
    ) -> None:
        """
        Tests that `delete` works.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            mocker: The fixture to use for mocking.
            object_exists: If false, test the case where the object has been
                deleted concurrently. Otherwise, test the case where the object
                still exists.

        """
        # Arrange.
        # Create a fake object to delete.
        object_id = faker.object_ref()

        mock_metadata_items = []
        mock_data_object = None
        if not object_exists:
            # Make it look like the object does not exist.
            config.mock_session.data_objects.get.side_effect = (
                DataObjectDoesNotExist
            )
        else:
            mock_data_object = (
                config.mock_session.data_objects.get.return_value
            )

            # Make it look like we have actual metadata items.
            mock_metadata_items = [
                mocker.create_autospec(iRODSMeta, instance=True)
            ] * 2
            mock_data_object.metadata.items.return_value = mock_metadata_items

        # Act.
        await config.store.delete(object_id)

        # Assert.
        # It should have gotten the object.
        config.mock_session.data_objects.get.assert_called_once()

        if object_exists:
            # It should have deleted the metadata.
            mock_data_object.metadata.remove.assert_has_calls(
                [mocker.call(i) for i in mock_metadata_items]
            )

    @pytest.mark.asyncio
    async def test_get(self, config: ConfigForTests, faker: Faker) -> None:
        """
        Tests that `get` works.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Create a fake object to get.
        object_id = faker.object_ref()

        # Make it look like there is some metadata.
        metadata_avus = iRODSMeta(name="json", value=config.metadata.json())
        mock_data_object = config.mock_session.data_objects.get.return_value
        mock_data_object.metadata.get_one.return_value = metadata_avus

        # Act.
        got_metadata = await config.store.get(object_id)

        # Assert.
        # It should have gotten the underlying object.
        config.mock_session.data_objects.get.assert_called_once()
        # It should have read the correct AVU.
        mock_data_object.metadata.get_one.assert_called_once_with("json")

        # It should have read the correct metadata.
        assert got_metadata == config.metadata

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "exception",
        [DataObjectDoesNotExist, CollectionDoesNotExist],
        ids=["missing_object", "missing_collection"],
    )
    async def test_get_nonexistent(
        self, config: ConfigForTests, faker: Faker, exception: Type[Exception]
    ) -> None:
        """
        Tests that `get` fails when the object does not exist.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            exception: The exception to raise internally.

        """
        # Arrange.
        # Create a fake object to get.
        object_id = faker.object_ref()

        # Make it look like the object does not exist.
        config.mock_session.data_objects.get.side_effect = exception

        # Act and assert.
        with pytest.raises(KeyError, match="does not exist"):
            await config.store.get(object_id)

    @pytest.mark.asyncio
    @pytest.mark.parametrize
    async def test_query(self, config: ConfigForTests, faker: Faker) -> None:
        """
        Tests that `query` works.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Create a fake query to perform.
        query = faker.image_query()

        # Make it return some reasonable-looking data.
        fake_bucket = faker.word()
        fake_bucket_path = config.root_collection / fake_bucket
        result1, result2 = [
            {Collection.name: fake_bucket_path, DataObject.name: faker.word()}
            for _ in range(2)
        ]

        # In order to make it easier to unravel the chain of mocked filter()
        # calls, we make filter, offset, and limit return the same query.
        mock_query = config.mock_session.query.return_value
        mock_query.filter.return_value = mock_query
        mock_query.offset.return_value = mock_query
        mock_query.limit.return_value = mock_query

        async def results() -> AsyncIterable[dict]:
            yield result1
            yield result2

        config.mock_make_async_iter.return_value = results()

        # Generate values to use for skip_first and max_num_results.
        skip_first = faker.random_int()
        max_num_results = faker.random_int()

        # Act.
        got_results = [
            r
            async for r in config.store.query(
                [query], skip_first=skip_first, max_num_results=max_num_results
            )
        ]

        # Assert.
        # It should have gotten the expected results.
        for got_result, result in zip(got_results, (result1, result2)):
            assert fake_bucket == got_result.bucket
            assert result[DataObject.name] == got_result.name

        # It should have built the query.
        config.mock_session.query.assert_called_once()
        # It should have added the offset and limit.
        mock_query.offset.assert_called_once_with(skip_first)
        mock_query.limit.assert_called_once_with(max_num_results)
        # It should have converted to an async iterator.
        config.mock_make_async_iter.assert_called_once_with(mock_query)

        # It should have added an initial filter to limit data to this
        # application.
        args, _ = mock_query.filter.call_args_list[0]
        assert len(args) == 1
        assert args[0].query_key == Collection.name

        # It should have added another initial filter to exclude thumbnails.
        args, _ = mock_query.filter.call_args_list[1]
        assert len(args) == 1
        assert args[0].query_key == DataObject.name

        # It should have added filters to the query.
        for call in mock_query.filter.call_args_list[2:]:
            args, _ = call
            name_criterion, value_criterion = args

            # It should be searching the correct columns.
            assert name_criterion.query_key == DataObjectMeta.name
            assert value_criterion.query_key == DataObjectMeta.value

            # It should be matching a name exactly.
            assert name_criterion.op == "="

    @pytest.mark.asyncio
    async def test_query_empty(self, config: ConfigForTests) -> None:
        """
        Tests that `query` works when we pass it the default empty query.

        Args:
            config: The configuration to use for testing.

        """
        # Arrange.
        # Create an empty query.
        query = ImageQuery()

        # Act.
        got_results = [r async for r in config.store.query(query)]

        # Assert.
        # No results should have been produced.
        assert len(got_results) == 0

        # It should have built the query.
        config.mock_session.query.assert_called_once()
        # It should have added only the filter for MALLARD data.
        config.mock_session.query.return_value.filter.assert_called_once()
