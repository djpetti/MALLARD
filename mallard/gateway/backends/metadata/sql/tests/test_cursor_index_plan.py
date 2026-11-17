"""Validate real cursor plans; opt in with MALLARD_TEST_MARIADB_URL.

The MariaDB URL must use an async driver and an account with CREATE/DROP DATABASE
privileges. Its database is never modified: each test owns a new UUID database.
No index hints or timing thresholds are used. Run with pytest -s to see plans.
"""

import os
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
import pytest_asyncio
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from faker import Faker
from loguru import logger
from sqlalchemy.engine import Connection, make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    async_sessionmaker,
    create_async_engine,
)

from mallard.gateway.backends.metadata.schemas import (
    ImageQuery,
    Ordering,
    PlatformType,
)
from mallard.gateway.backends.metadata.sql.models import Artifact, Base, Raster
from mallard.gateway.backends.metadata.sql.sql_artifact_metadata_store import (
    SqlArtifactMetadataStore,
)
from mallard.gateway.backends.objects.models import ObjectType

FIELDS = ("capture_date", "session_name", "name")
RANKS = tuple(f"{field}_is_null" for field in FIELDS)
CURSOR_INDEX = "ix_artifacts_cursor_sort"
REVISION = "8c2f6a9d104e"
ROW_COUNT = 20_000
PAGE_SIZE = 257
# Keep the oracle independent of generated columns and production seek builders.
OLD_ORDER = (
    "CASE WHEN a.capture_date IS NULL THEN 1 ELSE 0 END, a.capture_date DESC, "
    "CASE WHEN a.session_name IS NULL THEN 1 ELSE 0 END, a.session_name, "
    "CASE WHEN a.name IS NULL THEN 1 ELSE 0 END, a.name, a.bucket, a.`key`"
)
OLD_QUERY = (
    "SELECT a.bucket, a.`key`, a.capture_date, a.session_name, a.name "
    "FROM artifacts AS a JOIN rasters AS r "
    "ON a.bucket = r.bucket AND a.`key` = r.`key` "
    f"ORDER BY {OLD_ORDER}"
)


@pytest_asyncio.fixture(params=["sqlite", "mariadb"])
async def plan_engine(
    request: pytest.FixtureRequest,
) -> AsyncIterator[AsyncEngine]:
    """Yield an isolated database, never reusing the URL's existing database.

    Args:
        request: Backend parameter selected by pytest.

    Yields:
        Engine connected exclusively to this test's owned database.
    """
    if request.param == "sqlite":
        engine = create_async_engine("sqlite+aiosqlite://")
        try:
            yield engine
        finally:
            await engine.dispose()
        return

    configured_url = os.environ.get("MALLARD_TEST_MARIADB_URL")
    if not configured_url:
        pytest.skip(
            "Set MALLARD_TEST_MARIADB_URL to enable MariaDB plan tests."
        )
    url = make_url(configured_url)
    if url.drivername not in (
        "mysql+aiomysql",
        "mariadb+asyncmy",
        "mysql+asyncmy",
    ):
        pytest.fail(
            "MALLARD_TEST_MARIADB_URL must use an async MariaDB driver."
        )
    # Connect at server scope; neither USE nor DROP targets the supplied schema.
    admin = create_async_engine(
        url.set(database=""), isolation_level="AUTOCOMMIT"
    )
    database = f"mallard_cursor_plan_{uuid4().hex}"
    created = False
    engine = create_async_engine(url.set(database=database))
    try:
        async with admin.connect() as connection:
            version = (
                await connection.execute(sa.text("SELECT VERSION()"))
            ).scalar_one()
            assert (
                "MariaDB" in version
            ), f"Expected MariaDB, received {version}"
            logger.info(f"Cursor plan validation on MariaDB {version}")
            # No IF NOT EXISTS: a collision must fail rather than assume ownership.
            await connection.execute(sa.text(f"CREATE DATABASE `{database}`"))
            created = True
        yield engine
    finally:
        await engine.dispose()
        try:
            if created:
                async with admin.connect() as connection:
                    # This literal name was generated here and successfully created here.
                    await connection.execute(
                        sa.text(f"DROP DATABASE `{database}`")
                    )
        finally:
            await admin.dispose()


def _migrate(
    connection: Connection, *, target: str, downgrade: bool = False
) -> None:
    """Execute actual revision functions on the caller's test connection.

    Args:
        connection: Connection to the owned database.
        target: Revision whose functions should run.
        downgrade: Whether to undo only the selected revision.
    """
    scripts = ScriptDirectory(str(Path(__file__).parents[1] / "alembic"))
    revision = scripts.get_revision(target)
    assert revision is not None
    with Operations.context(MigrationContext.configure(connection)):
        if downgrade:
            revision.module.downgrade()
        else:
            revision.module.upgrade()


def _legacy_schema(connection: Connection) -> None:
    """Build the actual migration chain immediately preceding the cursor fix.

    Args:
        connection: Connection to an empty owned MariaDB database.
    """
    scripts = ScriptDirectory(str(Path(__file__).parents[1] / "alembic"))
    cursor_revision = scripts.get_revision(REVISION)
    assert cursor_revision is not None
    revisions = list(
        scripts.walk_revisions(base="base", head=cursor_revision.down_revision)
    )
    with Operations.context(MigrationContext.configure(connection)):
        for revision in reversed(revisions):
            revision.module.upgrade()


async def _seed(engine: AsyncEngine, faker: Faker) -> None:
    """Bulk insert realistic cardinality with ties and all NULL combinations.

    Args:
        engine: Engine containing either legacy or current tables.
        faker: Seeded fake data provider.
    """
    base_date = faker.date_object()
    stem = faker.lexify("????????").lower()
    rows = []
    for index in range(ROW_COUNT):
        # Small ASCII domains avoid collation surprises while forcing many ties.
        rows.append(
            {
                "bucket": f"{stem}-{index % 4}",
                "key": f"{index:08d}",
                "platform_type": PlatformType.AERIAL,
                "capture_date": (
                    None
                    if index & 1
                    else base_date + timedelta(days=(index // 8) % 11)
                ),
                "session_name": (
                    None if index & 2 else f"session-{(index // 88) % 7}"
                ),
                "name": None if index & 4 else f"name-{(index // 616) % 5}",
            }
        )
    async with engine.begin() as connection:
        for start in range(0, ROW_COUNT, 1000):
            chunk = rows[start : start + 1000]
            await connection.execute(Artifact.__table__.insert(), chunk)
            # Orphan artifacts exercise the public query's inner raster join.
            rasters = [
                {"bucket": row["bucket"], "key": row["key"]}
                for row in chunk
                if int(row["key"]) % 101
            ]
            await connection.execute(Raster.__table__.insert(), rasters)
        if engine.dialect.name in ("mysql", "mariadb"):
            await connection.execute(
                sa.text("ANALYZE TABLE artifacts, rasters")
            )
        else:
            await connection.execute(sa.text("ANALYZE"))


async def _assert_schema(engine: AsyncEngine) -> None:
    """Check generated rank values and the installed mixed-direction index.

    Args:
        engine: Engine containing the current ORM or migrated schema.
    """
    async with engine.connect() as connection:
        columns = await connection.run_sync(
            lambda sync: sa.inspect(sync).get_columns("artifacts")
        )
        by_name = {column["name"]: column for column in columns}
        for rank in RANKS:
            expected = Artifact.__table__.c[rank].computed
            assert expected is not None
            assert by_name[rank]["computed"]["persisted"] == expected.persisted
        if engine.dialect.name != "sqlite":
            indexes = (
                (
                    await connection.execute(
                        sa.text("SHOW INDEX FROM artifacts")
                    )
                )
                .mappings()
                .all()
            )
            cursor_index = sorted(
                (row for row in indexes if row["Key_name"] == CURSOR_INDEX),
                key=lambda row: row["Seq_in_index"],
            )
            installed = [
                (row["Column_name"], row["Collation"]) for row in cursor_index
            ]
            assert installed == [
                ("capture_date_is_null", "A"),
                ("capture_date", "D"),
                ("session_name_is_null", "A"),
                ("session_name", "A"),
                ("name_is_null", "A"),
                ("name", "A"),
                ("bucket", "A"),
                ("key", "A"),
            ], installed
            logger.info(f"Installed cursor index: {installed}")
        mismatched = sa.or_(
            *(
                Artifact.__table__.c[rank]
                != sa.case((Artifact.__table__.c[field].is_(None), 1), else_=0)
                for rank, field in zip(RANKS, FIELDS)
            )
        )
        count = await connection.execute(
            sa.select(sa.func.count()).select_from(Artifact).where(mismatched)
        )
        assert count.scalar_one() == 0


async def _explain(
    engine: AsyncEngine, statement: str, parameters: Any, *, label: str
) -> list[dict[str, Any]]:
    """Explain an unmodified DBAPI statement and report optimizer row estimates.

    Args:
        engine: Database whose optimizer is under test.
        statement: SQL captured from a real public query or the independent oracle.
        parameters: Original DBAPI bound parameters.
        label: Human-readable page or oracle identifier.

    Returns:
        Plan rows suitable for backend-specific assertions.
    """
    prefix = (
        "EXPLAIN QUERY PLAN "
        if engine.dialect.name == "sqlite"
        else "EXPLAIN "
    )
    async with engine.connect() as connection:
        result = await connection.exec_driver_sql(
            prefix + statement, parameters
        )
        plan = [dict(row) for row in result.mappings()]
    logger.info(f"{label}: {plan}")
    return plan


def _assert_index_plan(
    engine: AsyncEngine, plan: list[dict[str, Any]], *, later: bool
) -> None:
    """Require index-ordered access rather than a filesort or temporary sort.

    Args:
        engine: Engine identifying the optimizer's EXPLAIN format.
        plan: Rows returned by EXPLAIN.
        later: Whether the query includes a continuation predicate.
    """
    if engine.dialect.name == "sqlite":
        details = " ".join(str(row["detail"]) for row in plan)
        assert CURSOR_INDEX in details, plan
        assert "TEMP B-TREE" not in details.upper(), plan
    else:
        assert not any(
            "filesort" in str(row["Extra"]).lower() for row in plan
        ), plan
        artifact = next(row for row in plan if row["table"] == "artifacts")
        assert artifact["key"] == CURSOR_INDEX, plan
        assert artifact["type"] in (
            {"range", "ref"} if later else {"index", "range"}
        ), plan
        assert plan[0]["table"] == "artifacts", plan


async def _validate_pages(engine: AsyncEngine) -> list[str]:
    """Compare every public page to a raw legacy CASE oracle and inspect plans.

    Args:
        engine: Seeded database with the current schema.

    Returns:
        Plan failures deferred until correctness and migration checks finish.
    """
    await _assert_schema(engine)
    async with engine.connect() as connection:
        expected = (
            (await connection.execute(sa.text(OLD_QUERY))).mappings().all()
        )
    assert len(expected) == ROW_COUNT - len(range(0, ROW_COUNT, 101))
    old_plan = await _explain(
        engine, f"{OLD_QUERY} LIMIT {PAGE_SIZE + 1}", (), label="old CASE"
    )
    if engine.dialect.name == "sqlite":
        assert any(
            "TEMP B-TREE" in row["detail"].upper() for row in old_plan
        ), old_plan
    else:
        assert any(
            "filesort" in str(row["Extra"]).lower() for row in old_plan
        ), old_plan

    # Explain the exact ORM statement, including its projection, join, and bindings.
    captured: list[tuple[str, Any]] = []

    def capture(
        connection: Connection,
        cursor: Any,
        statement: str,
        parameters: Any,
        context: Any,
        executemany: bool,
    ) -> None:
        """Capture only the main ordered selection, not relationship loaders.

        Args:
            connection: Synchronous facade used by SQLAlchemy's event system.
            cursor: Driver cursor about to execute.
            statement: Compiled SQL sent to the driver.
            parameters: Bound driver parameters.
            context: SQLAlchemy execution context.
            executemany: Whether this is a bulk execution.
        """
        if "ORDER BY" in statement and "JOIN rasters ON" in statement:
            captured.append((statement, parameters))

    orderings = [
        Ordering(field=Ordering.Field.CAPTURE_DATE, ascending=False),
        Ordering(field=Ordering.Field.SESSION, ascending=True),
        Ordering(field=Ordering.Field.NAME, ascending=True),
    ]
    store = SqlArtifactMetadataStore(
        async_sessionmaker(engine), enable_match=False
    )
    continuation = None
    seen_cursors: set[str] = set()
    seen_ranks: set[tuple[bool, ...]] = set()
    visited: list[tuple[str, str]] = []
    page_number = 0
    plan_failures: list[str] = []
    sa.event.listen(engine.sync_engine, "before_cursor_execute", capture)
    try:
        while True:
            captured.clear()
            page = await store.query_page(
                [ImageQuery()],
                orderings,
                cursor=continuation,
                max_num_results=PAGE_SIZE,
            )
            start = len(visited)
            identities = [
                (item.id.bucket, item.id.name) for item in page.image_ids
            ]
            oracle_page = expected[start : start + PAGE_SIZE]
            assert identities == [
                (row["bucket"], row["key"]) for row in oracle_page
            ], f"Ordering mismatch on page {page_number}, offset {start}"
            assert all(
                item.type == ObjectType.RASTER for item in page.image_ids
            )
            assert len(captured) == 1, captured
            ranks = tuple(oracle_page[0][field] is None for field in FIELDS)
            # Include deep pages and every new leading NULL-rank combination.
            if (
                page_number in (0, 1, 20, 50)
                or ranks not in seen_ranks
                or page.next_cursor is None
            ):
                plan = await _explain(
                    engine,
                    *captured[0],
                    label=f"page {page_number}, ranks={ranks}",
                )
                # SQLite may prefer MULTI-INDEX OR plus sorting on later pages.
                if engine.dialect.name != "sqlite" or continuation is None:
                    try:
                        _assert_index_plan(
                            engine, plan, later=continuation is not None
                        )
                    except AssertionError:
                        plan_failures.append(f"Page {page_number}: {plan!r}")
            seen_ranks.add(ranks)
            visited.extend(identities)
            page_number += 1
            if page.next_cursor is None:
                break
            assert len(identities) == PAGE_SIZE
            assert page.next_cursor not in seen_cursors
            seen_cursors.add(page.next_cursor)
            continuation = page.next_cursor
            assert page_number <= ROW_COUNT // PAGE_SIZE + 1
    finally:
        sa.event.remove(engine.sync_engine, "before_cursor_execute", capture)
    assert len(visited) == len(expected)
    assert len(set(visited)) == len(expected)
    assert len(seen_ranks) == 8
    assert page_number > 70
    logger.info(
        f"Validated {len(visited)} references across {page_number} pages; "
        f"all 8 NULL combinations match the independent CASE oracle."
    )
    return plan_failures


class TestCursorIndexPlan:
    """Check optimizer behavior for ORM schema and populated migration round trips."""

    @pytest.mark.asyncio
    async def test_orm_schema_and_public_pages(
        self, plan_engine: AsyncEngine, faker: Faker
    ) -> None:
        """ORM VIRTUAL ranks and mixed DESC indexes support sort-free cursor seeks.

        Args:
            plan_engine: Isolated SQLite or opt-in MariaDB engine.
            faker: Seeded fake data provider.
        """
        async with plan_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        await _seed(plan_engine, faker)
        failures = await _validate_pages(plan_engine)
        assert not failures, "\n".join(failures)

    @pytest.mark.asyncio
    async def test_seeded_migration_round_trip(
        self, plan_engine: AsyncEngine, faker: Faker
    ) -> None:
        """Upgrade, downgrade, and re-upgrade preserve data and usable MariaDB plans.

        Args:
            plan_engine: Isolated opt-in MariaDB engine.
            faker: Seeded fake data provider.
        """
        if plan_engine.dialect.name == "sqlite":
            pytest.skip(
                "Historical revisions contain MariaDB-specific ALTER operations."
            )
        async with plan_engine.begin() as connection:
            await connection.run_sync(_legacy_schema)
        await _seed(plan_engine, faker)
        # Snapshot all ordinary artifact fields and joined ordering before any DDL.
        columns = [
            column
            for column in Artifact.__table__.c
            if column.name not in RANKS
        ]
        snapshot = sa.select(*columns).order_by(Artifact.bucket, Artifact.key)
        async with plan_engine.connect() as connection:
            original = (await connection.execute(snapshot)).all()
            oracle = (await connection.execute(sa.text(OLD_QUERY))).all()
            indexes = await connection.run_sync(
                lambda sync: sa.inspect(sync).get_indexes("artifacts")
            )
        async with plan_engine.begin() as connection:
            await connection.run_sync(
                lambda sync: _migrate(sync, target=REVISION)
            )
        failures = await _validate_pages(plan_engine)
        async with plan_engine.begin() as connection:
            ranks = await connection.execute(
                sa.select(
                    *(Artifact.__table__.c[rank] for rank in RANKS),
                    *(Artifact.__table__.c[field] for field in FIELDS),
                )
            )
            for row in ranks:
                assert tuple(row[:3]) == tuple(
                    int(value is None) for value in row[3:]
                )
            await connection.run_sync(
                lambda sync: _migrate(sync, target=REVISION, downgrade=True)
            )
            assert (await connection.execute(snapshot)).all() == original
            assert (
                await connection.execute(sa.text(OLD_QUERY))
            ).all() == oracle
            restored_columns = await connection.run_sync(
                lambda sync: sa.inspect(sync).get_columns("artifacts")
            )
            assert not set(RANKS) & {
                column["name"] for column in restored_columns
            }
            restored_indexes = await connection.run_sync(
                lambda sync: sa.inspect(sync).get_indexes("artifacts")
            )
            assert restored_indexes == indexes
            await connection.run_sync(
                lambda sync: _migrate(sync, target=REVISION)
            )
            assert (await connection.execute(snapshot)).all() == original
        failures.extend(await _validate_pages(plan_engine))
        logger.info(
            "Seeded migration upgrade/downgrade/re-upgrade preserved all rows and legacy indexes."
        )
        assert not failures, "\n".join(failures)
