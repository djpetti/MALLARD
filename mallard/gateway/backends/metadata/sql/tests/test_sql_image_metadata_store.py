"""
Tests for the `sql_image_metadata_store` module.
"""


import unittest.mock as mock
from typing import List

import pytest
from faker import Faker
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture
from sqlalchemy.engine import ScalarResult
from sqlalchemy.exc import NoResultFound
from sqlalchemy.ext.asyncio import AsyncSession

from mallard.gateway.backends.metadata.schemas import ImageQuery, Ordering
from mallard.gateway.backends.metadata.sql import sql_image_metadata_store
from mallard.type_helpers import ArbitraryTypesConfig


class TestSqlImageMetadataStore:
    """
    Tests for the `SqlImageMetadataStore` class.
    """

    @dataclass(frozen=True, config=ArbitraryTypesConfig)
    class ConfigForTests:
        """
        Encapsulates standard configuration for most tests.

        Attributes:
            store: The `SqlImageMetadataStore` under test.

            mock_session: The mocked `AsyncSession` to use.
            mock_select: The mocked `select` function to use.
        """

        store: sql_image_metadata_store.SqlImageMetadataStore

        mock_session: AsyncSession
        mock_select: mock.Mock

    @classmethod
    @pytest.fixture
    def config(cls, mocker: MockFixture) -> ConfigForTests:
        """
        Generates standard configuration for most tests.

        Args:
            mocker: The fixture to use for mocking.

        Returns:
            The configuration that it generated.

        """
        # Mock the dependencies.
        module_name = sql_image_metadata_store.__name__
        mock_session = mocker.create_autospec(AsyncSession, instance=True)
        mock_select = mocker.patch(f"{module_name}.select")
        # create_autospec is a little overzealous about making these
        # coroutines when in fact they aren't.
        mock_results = mock_session.execute.return_value
        mock_results.scalars = mocker.Mock()

        # In order to make assertions easier, we force it to apply chained
        # query operators to the same underlying mock.
        mock_query = mock_select.return_value
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.offset.return_value = mock_query

        store = sql_image_metadata_store.SqlImageMetadataStore(mock_session)

        return cls.ConfigForTests(
            store=store, mock_session=mock_session, mock_select=mock_select
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("uav", [True, False], ids=["uav", "ground"])
    async def test_add(
        self, config: ConfigForTests, faker: Faker, uav: bool
    ) -> None:
        """
        Tests that we can add metadata.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            uav: If true, simulate UAV metadata.

        """
        # Arrange.
        # Create some fake metadata.
        if uav:
            metadata = faker.uav_image_metadata()
        else:
            metadata = faker.image_metadata()

        object_id = faker.object_ref()

        # Act.
        await config.store.add(object_id=object_id, metadata=metadata)

        # Assert.
        # It should have added a new row to the database.
        config.mock_session.add.assert_called_once()
        config.mock_session.commit.assert_called_once_with()

        # Make sure the parameters got copied over correctly.
        args, _ = config.mock_session.add.call_args
        orm_model = args[0]

        assert orm_model.bucket == object_id.bucket
        assert orm_model.key == object_id.name
        assert orm_model.name == metadata.name
        assert orm_model.location_lat == metadata.location.latitude_deg
        assert orm_model.location_lon == metadata.location.longitude_deg
        if uav:
            assert orm_model.altitude_meters == metadata.altitude_meters
        else:
            assert orm_model.altitude_meters is None

    @pytest.mark.asyncio
    async def test_get(
        self, config: ConfigForTests, faker: Faker, mocker: MockFixture
    ) -> None:
        """
        Tests that we can get metadata from the store.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            mocker: The fixture to use for mocking.

        """
        # Arrange.
        object_id = faker.object_ref()

        # Make sure that executing the query produces an object.
        mock_results = config.mock_session.execute.return_value
        mock_scalars = mocker.create_autospec(ScalarResult, instance=True)
        mock_results.scalars.return_value = mock_scalars

        fake_model = faker.image_model(object_id=object_id)
        mock_scalars.one.return_value = fake_model

        # Act.
        got_metadata = await config.store.get(object_id)

        # Assert.
        # It should have performed a query.
        config.mock_select.assert_called_once()
        mock_query = config.mock_select.return_value
        mock_query.where.assert_called_once()
        mock_query = mock_query.where.return_value

        config.mock_session.execute.assert_called_once_with(mock_query)

        # It should have gotten a correct result.
        assert got_metadata.name == fake_model.name
        assert got_metadata.location.longitude_deg == fake_model.location_lon
        assert got_metadata.location.latitude_deg == fake_model.location_lat

    @pytest.mark.asyncio
    async def test_get_nonexistent(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `get` handles it correctly if metadata for a particular
        object does not exist.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Make it look like the object does not exist.
        mock_results = config.mock_session.execute.return_value
        mock_results.scalars.side_effect = NoResultFound

        # Act and assert.
        with pytest.raises(KeyError, match="No metadata"):
            await config.store.get(faker.object_ref())

    @pytest.mark.asyncio
    async def test_delete(self, config: ConfigForTests, faker: Faker) -> None:
        """
        Tests that we can delete metadata.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        object_id = faker.object_ref()

        # Act.
        await config.store.delete(object_id)

        # Assert.
        # It should have performed a query.
        config.mock_select.assert_called_once()
        mock_query = config.mock_select.return_value
        mock_query.where.assert_called_once()
        mock_query = mock_query.where.return_value

        config.mock_session.execute.assert_called_once_with(mock_query)

        # It should have deleted the result.
        mock_result = config.mock_session.execute.return_value
        config.mock_session.delete.assert_called_once_with(
            mock_result.scalars.return_value.one.return_value
        )

    @pytest.mark.asyncio
    async def test_delete_nonexistent(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `delete` handles it correctly if metadata for a particular
        object does not exist.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Make it look like the object does not exist.
        mock_results = config.mock_session.execute.return_value
        mock_results.scalars.side_effect = NoResultFound

        # Act and assert.
        with pytest.raises(KeyError, match="No metadata"):
            await config.store.delete(faker.object_ref())

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "orderings",
        [
            [Ordering(field=Ordering.Field.NAME)],
            [
                Ordering(field=Ordering.Field.SESSION_NUM),
                Ordering(field=Ordering.Field.SEQUENCE_NUM, ascending=False),
            ],
        ],
        ids=["single_order", "dual_order_descending"],
    )
    @pytest.mark.parametrize(
        ("offset", "limit"),
        [(0, 500), (100, 500), (0, 10)],
        ids=["default", "with_offset", "few_results"],
    )
    @pytest.mark.parametrize(
        "include_location",
        [True, False],
        ids=["default_location", "no_location"],
    )
    async def test_query(
        self,
        config: ConfigForTests,
        faker: Faker,
        orderings: List[Ordering],
        offset: int,
        limit: int,
        include_location: bool,
    ) -> None:
        """
        Tests that we can query metadata.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            orderings: The orderings to use when testing.
            offset: The offset to use for testing.
            limit: The limit to use for testing.
            include_location: Whether to include a location in the query. This
                case is handled specially, which is why we test it.

        """
        # Arrange.
        # Create a fake query to perform.
        query = faker.image_query()
        if not include_location:
            query = query.copy(update=dict(bounding_box=None))

        # Produce some fake results for the query.
        result_1 = faker.object_ref()
        result_2 = faker.object_ref()
        mock_results = config.mock_session.execute.return_value
        mock_results.__iter__.return_value = [result_1, result_2]

        # Act.
        got_results = [
            r
            async for r in config.store.query(
                query,
                orderings=orderings,
                skip_first=offset,
                max_num_results=limit,
            )
        ]

        # Assert.
        # It should have created the query.
        config.mock_select.assert_called_once()
        # It should have run the query.
        config.mock_session.execute.assert_called_once()
        # It should have produced the results.
        assert got_results == [result_1, result_2]

        # It should have applied the orderings.
        mock_query = config.mock_select.return_value
        assert mock_query.order_by.call_count == len(orderings)

        # It should have applied the offset and limit.
        mock_query.offset.assert_called_once_with(offset)
        mock_query.limit.assert_called_once_with(limit)

    @pytest.mark.asyncio
    async def test_query_empty(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that `query` works when we pass the default empty query.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Create an empty query.
        query = ImageQuery()

        # Produce some fake results for the query.
        result = faker.object_ref()
        mock_results = config.mock_session.execute.return_value
        mock_results.__iter__.return_value = [result]

        # Act.
        got_results = [r async for r in config.store.query(query)]

        # Assert.
        # It should have produced the results.
        assert got_results == [result]

        # It should not have applied any filters.
        mock_query = config.mock_select.return_value
        mock_query.where.assert_not_called()
