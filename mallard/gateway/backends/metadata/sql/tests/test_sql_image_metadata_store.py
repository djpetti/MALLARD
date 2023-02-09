"""
Tests for the `sql_image_metadata_store` module.
"""


import unittest.mock as mock
from pathlib import Path
from typing import List, Type

import pytest
from faker import Faker
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture
from sqlalchemy.engine import ScalarResult
from sqlalchemy.exc import NoResultFound
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from mallard.config_view_mock import ConfigViewMock
from mallard.gateway.backends.metadata.schemas import (
    ImageMetadata,
    ImageQuery,
    Ordering,
    UavImageMetadata,
)
from mallard.gateway.backends.metadata.sql import sql_image_metadata_store
from mallard.gateway.backends.metadata.sql.models import Base
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
            mock_delete: The mocked `delete` function to use.
        """

        store: sql_image_metadata_store.SqlImageMetadataStore

        mock_session: AsyncSession
        mock_select: mock.Mock
        mock_delete: mock.Mock

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
        mock_delete = mocker.patch(f"{module_name}.delete")
        # create_autospec is a little overzealous about making these
        # coroutines when in fact they aren't.
        mock_results = mock_session.execute.return_value
        mock_results.all = mocker.Mock()

        # In order to make assertions easier, we force it to apply chained
        # query operators to the same underlying mock.
        mock_query = mock_select.return_value
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.offset.return_value = mock_query
        mock_query.union.return_value = mock_query

        store = sql_image_metadata_store.SqlImageMetadataStore(mock_session)

        return cls.ConfigForTests(
            store=store,
            mock_session=mock_session,
            mock_select=mock_select,
            mock_delete=mock_delete,
        )

    @pytest.fixture
    async def sqlite_session(self, tmp_path: Path) -> AsyncSession:
        """
        Creates a new SQL session backed by a SQLite DB.

        Args:
            tmp_path: The root path for temporary files.

        Returns:
            The session that it created.

        """
        db_path = tmp_path / "test_metadata.db"
        db_url = f"sqlite+aiosqlite:///{db_path.as_posix()}"
        engine = create_async_engine(db_url, echo=True)

        # Create the table.
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        # Create the session.
        session_maker = sessionmaker(
            engine, expire_on_commit=False, class_=AsyncSession
        )
        async with session_maker() as session:
            yield session

    @pytest.mark.asyncio
    @pytest.mark.parametrize("uav", [True, False], ids=["uav", "ground"])
    @pytest.mark.parametrize(
        "overwrite", [False, True], ids=["merge", "overwrite"]
    )
    async def test_add(
        self, config: ConfigForTests, faker: Faker, uav: bool, overwrite: bool
    ) -> None:
        """
        Tests that we can add metadata.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            uav: If true, simulate UAV metadata.
            overwrite: If true, test overwriting existing data.

        """
        # Arrange.
        # Create some fake metadata.
        if uav:
            metadata = faker.uav_image_metadata()
        else:
            metadata = faker.image_metadata()

        object_id = faker.object_ref()

        # Act.
        await config.store.add(
            object_id=object_id, metadata=metadata, overwrite=overwrite
        )

        # Assert.
        # It should have added a new row to the database.
        if overwrite:
            config.mock_session.merge.assert_called_once()
            args, _ = config.mock_session.merge.call_args
        else:
            config.mock_session.add.assert_called_once()
            args, _ = config.mock_session.add.call_args

        # Make sure the parameters got copied over correctly.
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
        faker: Faker,
        mocker: MockFixture,
        new_metadata_type: Type[ImageMetadata],
        merge: bool,
    ) -> None:
        """
        Tests that `update` works.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            mocker: The fixture to use for mocking.
            new_metadata_type: The type of new metadata to pass in.
            merge: Whether to test merging or overwriting.

        """
        # Arrange.
        object_id = faker.object_ref()

        # Make it look like we have some existing metadata.
        mock_results = config.mock_session.execute.return_value
        mock_scalars = mocker.create_autospec(ScalarResult, instance=True)
        mock_results.scalars.return_value = mock_scalars

        old_model = faker.image_model(object_id=object_id)
        mock_scalars.one.return_value = old_model

        # Create some new metadata.
        if new_metadata_type == ImageMetadata:
            new_metadata = faker.image_metadata()
        else:
            new_metadata = faker.uav_image_metadata()
        # Don't fill some of the attributes.
        new_metadata = new_metadata.copy(update=dict(name=None, camera=None))

        # Act.
        # Try updating the object.
        await config.store.update(
            object_id=object_id, metadata=new_metadata, merge=merge
        )

        # Assert.
        # It should have set the new metadata.
        config.mock_session.merge.assert_called_once()
        added_model = config.mock_session.merge.call_args[0][0]

        # Check that the proper new metadata was set.
        if merge:
            # It should not have overwritten the fields we wanted to keep.
            assert added_model.name == old_model.name
            assert added_model.camera == old_model.camera

            # Everything else should be updated.
            ignore_fields = {"name", "camera", "location"}
        else:
            ignore_fields = {"location"}

        added_metadata = UavImageMetadata.from_orm(added_model)
        got_unmodified = added_metadata.dict(exclude=ignore_fields)
        expected_unmodified = new_metadata.dict(exclude=ignore_fields)
        # There might be some differences in the fields between the two
        # of them, because they could be different subclasses of
        # ImageMetadata.
        for key in got_unmodified.keys() & expected_unmodified.keys():
            assert got_unmodified[key] == expected_unmodified[key]

        # Location must be compared manually.
        assert added_model.location_lat == new_metadata.location.latitude_deg
        assert added_model.location_lon == new_metadata.location.longitude_deg

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
        # It should have performed a deletion.
        config.mock_delete.assert_called_once()
        mock_deletion = config.mock_delete.return_value
        mock_deletion.where.assert_called_once()
        mock_deletion = mock_deletion.where.return_value

        config.mock_session.execute.assert_called_once_with(mock_deletion)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "orderings",
        [
            [Ordering(field=Ordering.Field.NAME)],
            [
                Ordering(field=Ordering.Field.SESSION),
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
    @pytest.mark.parametrize(
        "multiple", [True, False], ids=["multiple_queries", "single_query"]
    )
    async def test_query(
        self,
        config: ConfigForTests,
        faker: Faker,
        orderings: List[Ordering],
        offset: int,
        limit: int,
        include_location: bool,
        multiple: bool,
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
            multiple: If true, test multiple ORed queries, instead of just a
                single one.

        """
        # Arrange.
        # Create a fake query to perform.
        query = faker.image_query()
        if not include_location:
            query = query.copy(update=dict(bounding_box=None))

        # Produce some fake results for the query.
        object_id_1 = faker.object_ref()
        object_id_2 = faker.object_ref()
        result_1 = faker.image_model(object_id=object_id_1)
        result_2 = faker.image_model(object_id=object_id_2)
        mock_results = config.mock_session.execute.return_value
        mock_results.all.return_value = [result_1, result_2]

        # Act.
        got_results = [
            r
            async for r in config.store.query(
                [query],
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
        assert got_results == [object_id_1, object_id_2]

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
        object_id = faker.object_ref()
        result = faker.image_model(object_id=object_id)
        mock_results = config.mock_session.execute.return_value
        mock_results.scalars.return_value = [result]

        # Act.
        got_results = [r async for r in config.store.query(query)]

        # Assert.
        # It should have produced the results.
        assert got_results == [object_id]

        # It should not have applied any filters.
        mock_query = config.mock_select.return_value
        mock_query.where.assert_not_called()

    @pytest.mark.asyncio
    async def test_from_config(self, mocker: MockFixture) -> None:
        """
        Tests that `from_config` works.

        Args:
            mocker: The fixture to use for mocking.

        """
        # Arrange.
        # Create the fake config data.
        mock_config = ConfigViewMock()

        # Mock the SQLAlchemy functions.
        mock_create_async_engine = mocker.patch(
            f"{sql_image_metadata_store.__name__}.create_async_engine"
        )
        mock_session_maker = mocker.patch(
            f"{sql_image_metadata_store.__name__}.sessionmaker"
        )

        # Act.
        async with sql_image_metadata_store.SqlImageMetadataStore.from_config(
            mock_config
        ):
            # Assert.
            # It should have created the session.
            mock_create_async_engine.assert_called_once_with(
                mock_config["endpoint_url"].as_str.return_value,
                echo_pool=mocker.ANY,
            )
            mock_session_maker.assert_called_once()

            # It should have entered the session context.
            mock_session_factory = mock_session_maker.return_value
            mock_session_factory.assert_called_once_with()
            mock_session_factory.return_value.__aenter__.assert_called_once()

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_add_get(
        self, sqlite_session: AsyncSession, faker: Faker
    ) -> None:
        """
        Tests that we can add and get metadata to and from an actual database.

        Args:
            sqlite_session: The SQLite session to use for testing.
            faker: Fixture to use for generating fake data.

        """
        # Arrange.
        store = sql_image_metadata_store.SqlImageMetadataStore(sqlite_session)

        metadata = faker.uav_image_metadata()
        object_id = faker.object_ref()

        # Act.
        await store.add(object_id=object_id, metadata=metadata)
        # Force a session close here to simulate two separate sessions, which
        # is how we would typically use this.
        await sqlite_session.close()
        got_metadata = await store.get(object_id)

        # Assert.
        assert got_metadata == metadata

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_add_delete(
        self, sqlite_session: AsyncSession, faker: Faker
    ) -> None:
        """
        Tests that we can add metadata and then delete it.

        Args:
            sqlite_session: The SQLite session to use for testing.
            faker: Fixture to use for generating fake data.

        """
        # Arrange.
        store = sql_image_metadata_store.SqlImageMetadataStore(sqlite_session)

        metadata = faker.uav_image_metadata()
        object_id = faker.object_ref()

        # Act.
        await store.add(object_id=object_id, metadata=metadata)
        # Force a session close here to simulate two separate sessions, which
        # is how we would typically use this.
        await sqlite_session.close()
        # Delete the metadata.
        await store.delete(object_id)
        await sqlite_session.close()

        # Assert.
        # Now trying to get this metadata should fail.
        with pytest.raises(KeyError, match="No metadata"):
            await store.get(object_id)

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_standard_queries(
        self, sqlite_session: AsyncSession, faker: Faker
    ) -> None:
        """
        Tests that we can perform some pretty standard queries.

        Args:
            sqlite_session: The SQLite session to use for testing.
            faker: Fixture to use for generating fake data.

        """
        # Arrange.
        store = sql_image_metadata_store.SqlImageMetadataStore(sqlite_session)

        # Add various records.
        metadata1 = faker.uav_image_metadata()
        metadata1 = metadata1.copy(
            update=dict(
                name="first image", sequence_number=0, session_name="a"
            )
        )
        object_id1 = faker.object_ref()

        metadata2 = faker.uav_image_metadata()
        metadata2 = metadata2.copy(
            update=dict(
                name="second image", sequence_number=1, session_name="a"
            )
        )
        object_id2 = faker.object_ref()

        metadata3 = faker.uav_image_metadata()
        metadata3 = metadata3.copy(
            update=dict(
                name="first image", sequence_number=0, session_name="b"
            )
        )
        object_id3 = faker.object_ref()

        await store.add(object_id=object_id1, metadata=metadata1)
        await store.add(object_id=object_id2, metadata=metadata2)
        await store.add(object_id=object_id3, metadata=metadata3)
        # Simulate a fresh session.
        await sqlite_session.close()

        # Act.
        # Perform some queries.
        everything = [r async for r in store.query(ImageQuery())]
        session_0 = [
            r
            async for r in store.query(
                ImageQuery(sessions={"a"}),
                orderings=(Ordering(field=Ordering.Field.SEQUENCE_NUM),),
            )
        ]
        session_0_frame_0 = [
            r
            async for r in store.query(
                ImageQuery(
                    sessions={"a"},
                    sequence_numbers=ImageQuery.Range(
                        min_value=0, max_value=0
                    ),
                )
            )
        ]
        first_images = [
            r
            async for r in store.query(
                ImageQuery(name="first"),
                orderings=(Ordering(field=Ordering.Field.SESSION),),
            )
        ]

        # Assert.
        # Check that we got the correct results.
        assert everything == [object_id1, object_id2, object_id3]
        assert session_0 == [object_id1, object_id2]
        assert session_0_frame_0 == [object_id1]
        assert first_images == [object_id1, object_id3]
