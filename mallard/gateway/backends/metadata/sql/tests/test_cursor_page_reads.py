"""Regressions for bounded cursor subtype reads and disappearing page rows."""

import sqlite3
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from faker import Faker
from sqlalchemy import Result, event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from mallard.gateway.backends.metadata.schemas import ImageQuery, PlatformType
from mallard.gateway.backends.metadata.sql.models import (
    Artifact,
    Base,
    Image,
    Raster,
    Video,
)
from mallard.gateway.backends.metadata.sql.sql_artifact_metadata_store import (
    SqlArtifactMetadataStore,
)
from mallard.gateway.backends.objects.models import (
    ObjectRef,
    ObjectType,
    TypedObjectRef,
)

SQL_VARIABLE_LIMIT = 999


class _LimitedConnection(sqlite3.Connection):
    """Enforce a portable SQLite bind limit on every pooled connection."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """Open a connection and constrain its SQL variable count.

        Args:
            *args: Positional SQLite connection arguments.
            **kwargs: Keyword SQLite connection arguments.
        """
        super().__init__(*args, **kwargs)
        self.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, SQL_VARIABLE_LIMIT)


@pytest_asyncio.fixture
async def page_engine(tmp_path: Path) -> AsyncIterator[AsyncEngine]:
    """Create an isolated SQLite database with a deliberately low bind limit.

    Args:
        tmp_path: Directory owned by this test.

    Yields:
        Engine shared by independent reader and writer sessions.
    """
    database = tmp_path / "cursor_page_reads.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database}",
        connect_args={"factory": _LimitedConnection},
    )
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture
def page_factory(
    page_engine: AsyncEngine,
) -> async_sessionmaker[AsyncSession]:
    """Build independent transactional sessions for the test database.

    Args:
        page_engine: Engine containing the isolated metadata schema.

    Returns:
        Session factory used by public metadata store operations.
    """
    return async_sessionmaker(page_engine, expire_on_commit=False)


@pytest.fixture
def type_read_sizes(page_engine: AsyncEngine) -> Iterator[list[int]]:
    """Observe subtype query bind counts without fixing their exact batch size.

    Args:
        page_engine: Engine whose actual DBAPI statements should be observed.

    Yields:
        Bind counts for subtype reads executed during the test.
    """
    sizes: list[int] = []

    def capture(
        connection: Any,
        cursor: Any,
        statement: str,
        parameters: Any,
        context: Any,
        executemany: bool,
    ) -> None:
        """Record only subtype reads, excluding seeding and main page queries.

        Args:
            connection: SQLAlchemy connection executing the statement.
            cursor: Driver cursor receiving the statement.
            statement: SQL sent to SQLite.
            parameters: Bound driver parameters.
            context: SQLAlchemy execution context.
            executemany: Whether the statement executes a batch of writes.
        """
        if (
            "FROM rasters" in statement
            and "JOIN images" in statement
            and "JOIN videos" in statement
        ):
            sizes.append(len(parameters))

    event.listen(page_engine.sync_engine, "before_cursor_execute", capture)
    try:
        yield sizes
    finally:
        event.remove(page_engine.sync_engine, "before_cursor_execute", capture)


async def _seed(
    factory: async_sessionmaker[AsyncSession], count: int, faker: Faker
) -> list[TypedObjectRef]:
    """Seed mixed subtypes with repeated keys across distinct buckets.

    Args:
        factory: Session factory for the isolated database.
        count: Number of artifact identities to create.
        faker: Seeded fake data generator.

    Returns:
        Expected typed references in the public default identity order.
    """
    stem = faker.uuid4()
    platform = faker.random_element(list(PlatformType))
    types = (ObjectType.IMAGE, ObjectType.VIDEO, ObjectType.RASTER)
    expected = [
        TypedObjectRef(
            id=ObjectRef(
                bucket=f"{stem}-{index % 3}", name=f"{index // 3:08d}"
            ),
            type=types[(index // 3 + index % 3) % len(types)],
        )
        for index in range(count)
    ]
    async with factory.begin() as session:
        # Core inserts keep the 17,000-row regression inexpensive to construct.
        for start in range(0, count, 1000):
            chunk = expected[start : start + 1000]
            identities = [
                {"bucket": item.id.bucket, "key": item.id.name}
                for item in chunk
            ]
            await session.execute(
                Artifact.__table__.insert(),
                [
                    dict(identity, platform_type=platform)
                    for identity in identities
                ],
            )
            await session.execute(Raster.__table__.insert(), identities)
            for table, object_type in (
                (Image.__table__, ObjectType.IMAGE),
                (Video.__table__, ObjectType.VIDEO),
            ):
                rows = [
                    identity
                    for identity, item in zip(identities, chunk)
                    if item.type == object_type
                ]
                if rows:
                    await session.execute(table.insert(), rows)
    return sorted(expected, key=lambda item: (item.id.bucket, item.id.name))


class TestCursorPageReads:
    """Exercise public cursor behavior across its two database read phases."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("count", [0, 399, 400, 401, 800, 801, 17_000])
    async def test_bounded_mixed_subtype_reads(
        self,
        page_factory: async_sessionmaker[AsyncSession],
        type_read_sizes: list[int],
        faker: Faker,
        count: int,
    ) -> None:
        """Large pages preserve order and types without exceeding bind limits.

        Args:
            page_factory: Factory for independent metadata sessions.
            type_read_sizes: Observed subtype query bind counts.
            faker: Seeded fake data generator.
            count: Page cardinality, including empty and batch boundaries.
        """
        expected = await _seed(page_factory, count, faker)
        store = SqlArtifactMetadataStore(page_factory, enable_match=False)

        page = await store.query_page(
            [ImageQuery()], max_num_results=max(1, count)
        )

        assert page.image_ids == expected
        assert page.next_cursor is None
        if count:
            assert type_read_sizes
            assert all(
                0 < size <= SQL_VARIABLE_LIMIT for size in type_read_sizes
            )
            assert sum(type_read_sizes) == 2 * count
            if 2 * count > SQL_VARIABLE_LIMIT:
                assert len(type_read_sizes) > 1
        else:
            # An empty selection must not issue an empty tuple-IN subtype query.
            assert type_read_sizes == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("count", [3, 8], ids=["final", "continuation"])
    @pytest.mark.parametrize(
        "deleted_indexes",
        [(0,), (2,), (0, 1, 2)],
        ids=["first-row", "anchor", "whole-page"],
    )
    async def test_deleted_rows_between_page_and_type_reads(
        self,
        page_engine: AsyncEngine,
        page_factory: async_sessionmaker[AsyncSession],
        faker: Faker,
        count: int,
        deleted_indexes: tuple[int, ...],
    ) -> None:
        """Committed deletions may shorten a page but never lose its continuation.

        Args:
            page_engine: Engine shared by independent reader and writer sessions.
            page_factory: Normal session factory used by the deleting writer.
            faker: Seeded fake data generator.
            count: Total number of matching artifacts before deletion.
            deleted_indexes: Positions to delete from the three-row raw page.
        """
        expected = await _seed(page_factory, count, faker)
        writer = SqlArtifactMetadataStore(page_factory, enable_match=False)
        baseline = await writer.query_page([ImageQuery()], max_num_results=3)
        deleted: list[ObjectRef] = []

        class DeletingSession(AsyncSession):
            """Commit independent deletes after the page result is buffered."""

            async def execute(
                self, statement: Any, *args: Any, **kwargs: Any
            ) -> Result[Any]:
                """Interleave public writer operations before returning the result.

                Args:
                    statement: Statement executed by the page reader.
                    *args: Forwarded SQLAlchemy execution arguments.
                    **kwargs: Forwarded SQLAlchemy execution options.

                Returns:
                    The original, buffered reader result.
                """
                result = await super().execute(statement, *args, **kwargs)
                if not deleted:
                    # SQLAlchemy has buffered the page, but subtype reads have not run.
                    for index in deleted_indexes:
                        object_id = expected[index].id
                        await writer.delete(object_id)
                        deleted.append(object_id)
                return result

        reader = SqlArtifactMetadataStore(
            async_sessionmaker(page_engine, class_=DeletingSession),
            enable_match=False,
        )
        first = await reader.query_page([ImageQuery()], max_num_results=3)

        assert deleted == [expected[index].id for index in deleted_indexes]
        assert first.image_ids == [
            item
            for index, item in enumerate(expected[:3])
            if index not in deleted_indexes
        ]
        # The raw selected anchor controls progression even if no references survive.
        assert first.next_cursor == baseline.next_cursor
        if count == 3:
            assert first.next_cursor is None
            return

        assert first.next_cursor is not None
        continuation = first.next_cursor
        remaining: list[TypedObjectRef] = []
        seen_cursors = {continuation}
        for _ in range(count):
            page = await writer.query_page(
                [ImageQuery()], cursor=continuation, max_num_results=3
            )
            remaining.extend(page.image_ids)
            if page.next_cursor is None:
                break
            assert page.next_cursor not in seen_cursors
            seen_cursors.add(page.next_cursor)
            continuation = page.next_cursor
        else:
            pytest.fail("Cursor traversal did not terminate after deletion.")
        assert remaining == expected[3:]
        assert len(set(first.image_ids + remaining)) == len(
            first.image_ids + remaining
        )
