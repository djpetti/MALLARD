"""Integration regressions for operation-scoped SQL metadata transactions.

MariaDB tests require MALLARD_TEST_MARIADB_URL pointing to an empty, disposable
async-driver database named mallard_test_*. Never point it at a deployed database.
Run these tests with pytest -n 0 because MariaDB schema setup is not worker-safe.
"""

import asyncio
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from faker import Faker
from sqlalchemy import Connection, event, inspect, select
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from mallard.gateway.backends.metadata.schemas import (
    GeoPoint,
    ImageFormat,
    ImageQuery,
    PlatformType,
    UavImageMetadata,
    UavVideoMetadata,
    VideoFormat,
)
from mallard.gateway.backends.metadata.sql.models import (
    Artifact,
    Base,
    Image,
    Raster,
    Video,
)
from mallard.gateway.backends.metadata.sql.sql_artifact_metadata_store import (
    SqlArtifactMetadataStore,
    SqlImageMetadataStore,
    SqlVideoMetadataStore,
)
from mallard.gateway.backends.objects.models import ObjectRef, ObjectType

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


@pytest_asyncio.fixture(params=["sqlite", "mariadb"])
async def sql_engine(
    request: pytest.FixtureRequest, tmp_path: Path
) -> AsyncIterator[AsyncEngine]:
    """Create tables only in a fresh SQLite file or explicitly disposable DB.

    Args:
        request: The database backend parameter.
        tmp_path: The per-test SQLite directory.

    Yields:
        An engine whose test-owned schema is removed on exit.
    """
    if request.param == "mariadb":
        db_url = os.getenv("MALLARD_TEST_MARIADB_URL")
        if not db_url:
            pytest.skip(
                "Set MALLARD_TEST_MARIADB_URL to a dedicated disposable DB"
            )
        url = make_url(db_url)
        if url.get_backend_name() not in {"mysql", "mariadb"} or not (
            url.database and url.database.startswith("mallard_test_")
        ):
            pytest.fail(
                "MariaDB requires a dedicated database named mallard_test_*"
            )
        if os.getenv("PYTEST_XDIST_WORKER"):
            pytest.fail(
                "Run optional MariaDB tests with -n 0 to isolate schema setup"
            )
    else:
        db_path = tmp_path / "metadata.db"
        db_url = f"sqlite+aiosqlite:///{db_path}"

    engine = create_async_engine(db_url)
    owns_schema = False
    try:
        async with engine.begin() as connection:
            existing = await connection.run_sync(
                lambda sync_connection: inspect(
                    sync_connection
                ).get_table_names()
            )
            # Refuse existing tables rather than dropping somebody else's data.
            if existing:
                pytest.fail(
                    "Refusing to use a nonempty metadata test database"
                )
            await connection.run_sync(Base.metadata.create_all)
            owns_schema = True
        yield engine
    finally:
        try:
            if owns_schema:
                async with engine.begin() as connection:
                    await connection.run_sync(Base.metadata.drop_all)
        finally:
            await engine.dispose()


@pytest.fixture
def sql_factory(sql_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Build the real session factory used by both independent stores.

    Args:
        sql_engine: The isolated database engine.

    Returns:
        A factory that retains values after committing.
    """
    return async_sessionmaker(sql_engine, expire_on_commit=False)


@pytest.fixture(params=["image", "video"])
def artifact_kind(request: pytest.FixtureRequest) -> str:
    """Select the child-table graph to exercise.

    Args:
        request: The artifact type parameter.

    Returns:
        The requested artifact kind.
    """
    return request.param


@pytest.fixture
def metadata(
    artifact_kind: str, faker: Faker
) -> UavImageMetadata | UavVideoMetadata:
    """Generate full metadata with exactly representable database floats.

    Args:
        artifact_kind: The graph to generate.
        faker: The project's registered metadata provider.

    Returns:
        Metadata suitable for SQLite and MariaDB round-trip comparisons.
    """
    value = (
        faker.image_metadata(uav=True)
        if artifact_kind == "image"
        else faker.video_metadata(uav=True)
    )
    # MariaDB FLOAT columns have less precision than Python's native floats.
    updates = dict(
        location=GeoPoint(latitude_deg=12.5, longitude_deg=25.25),
        altitude_meters=40.0,
        gsd_cm_px=2.0,
        camera=faker.word(),
        name=faker.word(),
        session_name=faker.word(),
    )
    if artifact_kind == "video":
        updates.update(frame_rate=24.0, num_frames=120)
    return value.model_copy(update=updates)


@pytest.fixture
def stores(
    sql_factory: async_sessionmaker[AsyncSession], artifact_kind: str
) -> tuple[SqlArtifactMetadataStore, SqlArtifactMetadataStore]:
    """Create separate stores sharing only a factory and database.

    Args:
        sql_factory: The common connection pool and session factory.
        artifact_kind: The subclass to instantiate.

    Returns:
        Two stores, so instance-local locks cannot serialize their updates.
    """
    store_class = (
        SqlImageMetadataStore
        if artifact_kind == "image"
        else SqlVideoMetadataStore
    )
    return (
        store_class(sql_factory, enable_match=False),
        store_class(sql_factory, enable_match=False),
    )


async def _assert_parent_write_locked(
    sql_engine: AsyncEngine, object_id: ObjectRef
) -> None:
    """Require a separate no-wait transaction to encounter the parent's lock.

    Args:
        sql_engine: The database where the writer is paused.
        object_id: The parent artifact whose lock should already be held.
    """
    # NOWAIT proves a database lock exists, rather than an instance lock.
    is_sqlite = sql_engine.dialect.name == "sqlite"
    probe_engine = create_async_engine(
        sql_engine.url,
        connect_args={"timeout": 0} if is_sqlite else {},
    )
    try:
        async with probe_engine.connect() as connection:
            with pytest.raises(OperationalError) as blocked:
                if is_sqlite:
                    await connection.exec_driver_sql("BEGIN IMMEDIATE")
                else:
                    await connection.execute(
                        select(Artifact.bucket)
                        .where(
                            Artifact.bucket == object_id.bucket,
                            Artifact.key == object_id.name,
                        )
                        .with_for_update(nowait=True)
                    )
            # Do not mistake an unsupported NOWAIT clause for contention.
            if is_sqlite:
                assert blocked.value.orig.sqlite_errorcode == 5
            else:
                assert blocked.value.orig.args[0] in {1205, 3572}
    finally:
        await probe_engine.dispose()


class TestSqlSessionFactory:
    """Exercise public operations against real, operation-scoped sessions."""

    async def test_overlapping_reads_use_independent_sessions(
        self,
        stores: tuple[SqlArtifactMetadataStore, SqlArtifactMetadataStore],
        metadata: UavImageMetadata | UavVideoMetadata,
        faker: Faker,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Require two reads on one store to enter SQL before either can finish.

        Args:
            stores: The stores sharing a factory.
            metadata: The full graph to read.
            faker: The object-reference provider.
            monkeypatch: The scoped SQL execution instrumentation.
        """
        store, _ = stores
        object_id = faker.object_ref()
        await store.add(object_id=object_id, metadata=metadata)
        original_execute = AsyncSession.execute
        sessions: list[AsyncSession] = []
        both_entered = asyncio.Event()
        release = asyncio.Event()

        async def overlapping_execute(
            session: AsyncSession, statement: Any, *args: Any, **kwargs: Any
        ) -> Any:
            """Hold real queries at a barrier without replacing their results."""
            sessions.append(session)
            if len(sessions) == 2:
                both_entered.set()
            await release.wait()
            return await original_execute(session, statement, *args, **kwargs)

        monkeypatch.setattr(AsyncSession, "execute", overlapping_execute)
        # A shared-session lock deadlocks at this barrier instead of passing slowly.
        async with asyncio.timeout(10):
            async with asyncio.TaskGroup() as tasks:
                first = tasks.create_task(store.get(object_id))
                second = tasks.create_task(store.get(object_id))
                try:
                    await both_entered.wait()
                    assert sessions[0] is not sessions[1]
                finally:
                    release.set()
        assert first.result() == second.result() == metadata

    async def test_results_are_detached_before_returning_to_consumer(
        self,
        sql_engine: AsyncEngine,
        artifact_kind: str,
        metadata: UavImageMetadata | UavVideoMetadata,
        faker: Faker,
    ) -> None:
        """Read values inside the transaction and release it before query yields.

        Args:
            sql_engine: The real isolated database.
            artifact_kind: The expected child-table type.
            metadata: The graph to read.
            faker: The object-reference provider.
        """
        # Expiration makes out-of-context ORM reads fail rather than appear safe.
        factory = async_sessionmaker(sql_engine, expire_on_commit=True)
        store_class = (
            SqlImageMetadataStore
            if artifact_kind == "image"
            else SqlVideoMetadataStore
        )
        store = store_class(factory, enable_match=False)
        object_ids = [faker.object_ref(), faker.object_ref()]
        for object_id in object_ids:
            await store.add(object_id=object_id, metadata=metadata)
        assert await store.get(object_ids[0]) == metadata
        results = store.query([ImageQuery()])
        try:
            first = await anext(results)
            # A suspended query consumer must not keep its transaction checked out.
            assert sql_engine.sync_engine.pool.checkedout() == 0
            await store.delete(first.id)
            remaining = [result async for result in results]
        finally:
            await results.aclose()
        expected_type = (
            ObjectType.IMAGE if artifact_kind == "image" else ObjectType.VIDEO
        )
        assert {first.id, *(result.id for result in remaining)} == set(
            object_ids
        )
        assert all(
            result.type == expected_type for result in [first, *remaining]
        )

    async def test_merge_preserves_none_and_updates_all_graph_levels(
        self,
        stores: tuple[SqlArtifactMetadataStore, SqlArtifactMetadataStore],
        artifact_kind: str,
        metadata: UavImageMetadata | UavVideoMetadata,
        faker: Faker,
    ) -> None:
        """Preserve optional fields while overriding non-None defaults and children.

        Args:
            stores: Independent writers and readers.
            artifact_kind: The leaf table to update.
            metadata: The initial complete graph.
            faker: The object-reference provider.
        """
        writer, reader = stores
        object_id = faker.object_ref()
        original = metadata.model_copy(update=dict(notes=faker.sentence()))
        await writer.add(object_id=object_id, metadata=original)
        formats = list(
            ImageFormat if artifact_kind == "image" else VideoFormat
        )
        new_format = next(
            value for value in formats if value != original.format
        )
        updates = dict(
            camera=faker.word(), altitude_meters=80.0, format=new_format
        )
        if artifact_kind == "video":
            updates.update(frame_rate=30.0, num_frames=240)
        # Constructing a patch retains the established non-None-default semantics.
        patch = type(metadata)(**updates)
        await reader.update(object_id=object_id, metadata=patch, merge=True)
        result = await writer.get(object_id)
        expected = original.model_dump()
        expected.update(patch.model_dump(exclude_none=True))
        assert result == type(metadata)(**expected)
        assert result.name == original.name
        assert result.notes == ""
        assert result.platform_type == PlatformType.GROUND
        assert result.location == GeoPoint()
        assert result.camera == patch.camera
        assert result.format == new_format

    async def test_merged_missing_raises_and_does_not_poison_next_operation(
        self,
        stores: tuple[SqlArtifactMetadataStore, SqlArtifactMetadataStore],
        metadata: UavImageMetadata | UavVideoMetadata,
        faker: Faker,
    ) -> None:
        """Reject a missing merged update without inserting or leaking a lock.

        Args:
            stores: Independent stores sharing a factory.
            metadata: The metadata to update and subsequently add.
            faker: The object-reference provider.
        """
        writer, reader = stores
        object_id = faker.object_ref()
        with pytest.raises(KeyError):
            await writer.update(
                object_id=object_id, metadata=metadata, merge=True
            )
        with pytest.raises(KeyError):
            await reader.get(object_id)
        await reader.add(object_id=object_id, metadata=metadata)
        assert await writer.get(object_id) == metadata

    @pytest.mark.parametrize("already_exists", [False, True])
    async def test_unmerged_update_is_an_upsert(
        self,
        stores: tuple[SqlArtifactMetadataStore, SqlArtifactMetadataStore],
        metadata: UavImageMetadata | UavVideoMetadata,
        faker: Faker,
        already_exists: bool,
    ) -> None:
        """Keep merge=False replacement semantics for present and missing graphs.

        Args:
            stores: Independent writer and reader stores.
            metadata: The original graph.
            faker: The object-reference provider.
            already_exists: Whether the upsert replaces an existing graph.
        """
        writer, reader = stores
        object_id = faker.object_ref()
        if already_exists:
            await writer.add(object_id=object_id, metadata=metadata)
        replacement = metadata.model_copy(update=dict(name=None, camera=None))
        await reader.update(
            object_id=object_id, metadata=replacement, merge=False
        )
        assert await writer.get(object_id) == replacement

    @pytest.mark.parametrize("merge", [False, True])
    async def test_leaf_write_failure_rolls_back_entire_graph(
        self,
        stores: tuple[SqlArtifactMetadataStore, SqlArtifactMetadataStore],
        artifact_kind: str,
        metadata: UavImageMetadata | UavVideoMetadata,
        faker: Faker,
        merge: bool,
    ) -> None:
        """Fail after parent writes and verify atomic rollback and later recovery.

        Args:
            stores: Independent writer and reader stores.
            artifact_kind: The leaf table where the failure is injected.
            metadata: The existing full graph.
            faker: The object-reference provider.
            merge: Whether to exercise merged or replacement update rollback.
        """
        writer, reader = stores
        object_id = faker.object_ref()
        await writer.add(object_id=object_id, metadata=metadata)
        formats = list(
            ImageFormat if artifact_kind == "image" else VideoFormat
        )
        replacement = metadata.model_copy(
            update=dict(
                name=f"updated-{metadata.name}",
                camera=f"updated-{metadata.camera}",
                format=next(
                    value for value in formats if value != metadata.format
                ),
            )
        )
        leaf = Image if artifact_kind == "image" else Video
        partial_writes: list[tuple[str, str]] = []

        def fail_leaf_write(
            mapper: Any, connection: Connection, target: Any
        ) -> None:
            """Check earlier writes on the transaction's connection, then fail."""
            name = connection.execute(
                select(Artifact.name).where(
                    Artifact.bucket == object_id.bucket,
                    Artifact.key == object_id.name,
                )
            ).scalar_one()
            camera = connection.execute(
                select(Raster.camera).where(
                    Raster.bucket == object_id.bucket,
                    Raster.key == object_id.name,
                )
            ).scalar_one()
            partial_writes.append((name, camera))
            raise RuntimeError("Injected leaf-table failure")

        event.listen(leaf, "before_update", fail_leaf_write)
        try:
            with pytest.raises(
                RuntimeError, match="Injected leaf-table failure"
            ):
                await writer.update(
                    object_id=object_id, metadata=replacement, merge=merge
                )
        finally:
            event.remove(leaf, "before_update", fail_leaf_write)
        # Prove this was a partial SQL write, not merely a pre-validation failure.
        assert partial_writes == [(replacement.name, replacement.camera)]
        assert await reader.get(object_id) == metadata
        await reader.update(
            object_id=object_id, metadata=replacement, merge=merge
        )
        assert await writer.get(object_id) == replacement

    @pytest.mark.parametrize("operation", ["overwrite", "delete"])
    async def test_writer_locks_parent_before_mutating_graph(
        self,
        stores: tuple[SqlArtifactMetadataStore, SqlArtifactMetadataStore],
        sql_engine: AsyncEngine,
        metadata: UavImageMetadata | UavVideoMetadata,
        faker: Faker,
        monkeypatch: pytest.MonkeyPatch,
        operation: str,
    ) -> None:
        """Lock the parent before overwrite merging or child-first deletion.

        Args:
            stores: Independent writer and reader stores sharing a factory.
            sql_engine: The database for the independent no-wait lock probe.
            metadata: The original image or video graph.
            faker: The object-reference provider.
            monkeypatch: The scoped pre-mutation pause instrumentation.
            operation: Whether to replace metadata or delete the graph.
        """
        writer, reader = stores
        object_id = faker.object_ref()
        await writer.add(object_id=object_id, metadata=metadata)
        # Only a child field changes, so a dirty parent cannot supply the lock.
        replacement = metadata.model_copy(
            update=dict(camera=f"updated-{metadata.camera}")
        )
        before_mutation = asyncio.Event()
        release = asyncio.Event()
        method_name = "merge" if operation == "overwrite" else "delete"
        original_method = getattr(AsyncSession, method_name)

        async def pause_before_mutation(
            session: AsyncSession, instance: Any, *args: Any, **kwargs: Any
        ) -> Any:
            """Pause before SQLAlchemy can load, modify, or flush the graph."""
            before_mutation.set()
            await release.wait()
            return await original_method(session, instance, *args, **kwargs)

        monkeypatch.setattr(AsyncSession, method_name, pause_before_mutation)
        async with asyncio.timeout(15):
            async with asyncio.TaskGroup() as tasks:
                if operation == "overwrite":
                    tasks.create_task(
                        writer.add(
                            object_id=object_id,
                            metadata=replacement,
                            overwrite=True,
                        )
                    )
                else:
                    tasks.create_task(writer.delete(object_id))
                try:
                    await before_mutation.wait()
                    await _assert_parent_write_locked(sql_engine, object_id)
                finally:
                    # Even a failed lock probe must let the writer clean up.
                    release.set()

        if operation == "overwrite":
            assert await reader.get(object_id) == replacement
        else:
            with pytest.raises(KeyError):
                await reader.get(object_id)

    async def test_concurrent_disjoint_patches_across_store_instances(
        self,
        stores: tuple[SqlArtifactMetadataStore, SqlArtifactMetadataStore],
        sql_engine: AsyncEngine,
        metadata: UavImageMetadata | UavVideoMetadata,
        faker: Faker,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Overlap read-modify-write operations without losing disjoint patches.

        Args:
            stores: Two separate stores sharing the same session factory.
            sql_engine: The database whose write lock is probed independently.
            metadata: The initial graph and consistent unrelated field values.
            faker: The object-reference provider.
            monkeypatch: The scoped transaction scheduling instrumentation.
        """
        first_store, second_store = stores
        object_id = faker.object_ref()
        await first_store.add(object_id=object_id, metadata=metadata)
        first_at_write = asyncio.Event()
        second_attempting_sql = asyncio.Event()
        original_merge = AsyncSession.merge
        original_execute = AsyncSession.execute
        first_session: AsyncSession | None = None
        second_sessions: list[AsyncSession] = []

        async def hold_first_write(
            session: AsyncSession, instance: Any, *args: Any, **kwargs: Any
        ) -> Any:
            """Pause the first writer after it has read the complete old graph."""
            nonlocal first_session
            if first_session is None:
                first_session = session
                first_at_write.set()
                await second_attempting_sql.wait()
            return await original_merge(session, instance, *args, **kwargs)

        async def observe_second_attempt(
            session: AsyncSession, statement: Any, *args: Any, **kwargs: Any
        ) -> Any:
            """Release the first writer only once the other transaction enters SQL."""
            if first_at_write.is_set() and session is not first_session:
                second_sessions.append(session)
                second_attempting_sql.set()
            return await original_execute(session, statement, *args, **kwargs)

        monkeypatch.setattr(AsyncSession, "merge", hold_first_write)
        monkeypatch.setattr(AsyncSession, "execute", observe_second_attempt)
        # Full copies keep unrelated non-None defaults identical in both patches.
        first_patch = metadata.model_copy(
            update=dict(name=f"renamed-{metadata.name}", camera=None)
        )
        second_patch = metadata.model_copy(
            update=dict(name=None, camera=f"camera-{metadata.camera}")
        )
        async with asyncio.timeout(15):
            async with asyncio.TaskGroup() as tasks:
                tasks.create_task(
                    first_store.update(
                        object_id=object_id, metadata=first_patch
                    )
                )
                await first_at_write.wait()
                await _assert_parent_write_locked(sql_engine, object_id)
                tasks.create_task(
                    second_store.update(
                        object_id=object_id, metadata=second_patch
                    )
                )
        assert second_attempting_sql.is_set()
        assert second_sessions and first_session not in second_sessions
        result = await second_store.get(object_id)
        assert result == metadata.model_copy(
            update=dict(name=first_patch.name, camera=second_patch.camera)
        )
