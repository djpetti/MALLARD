"""Regression tests for generated cursor ranks and reversible schema changes."""

from collections.abc import Iterator
from importlib import import_module
from io import StringIO
from itertools import product
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from faker import Faker
from sqlalchemy.dialects import mysql, sqlite
from sqlalchemy.dialects.mysql.mariadb import MariaDBDialect
from sqlalchemy.engine import Connection, Dialect
from sqlalchemy.schema import CreateColumn, CreateIndex

from mallard.gateway.backends.metadata.schemas import PlatformType
from mallard.gateway.backends.metadata.sql.models import Artifact

MIGRATIONS = "mallard.gateway.backends.metadata.sql.alembic.versions"
MIGRATION = import_module(f"{MIGRATIONS}.8c2f6a9d104e_index_cursor_sort")
LEGACY_MIGRATION = import_module(
    f"{MIGRATIONS}.c264529fbdb9_add_index_for_sort"
)
FIELDS = ("capture_date", "session_name", "name")
RANKS = tuple(f"{field}_is_null" for field in FIELDS)


def _upgrade(connection: Connection, migration: ModuleType) -> None:
    """Run a migration against an existing connection.

    Args:
        connection: Connection containing the schema to upgrade.
        migration: Imported Alembic revision module.
    """
    with Operations.context(MigrationContext.configure(connection)):
        migration.upgrade()


@pytest.fixture
def connection() -> Iterator[Connection]:
    """Yield an isolated SQLite connection for schema operations."""
    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            yield connection
    finally:
        engine.dispose()


@pytest.fixture
def legacy_table(connection: Connection, faker: Faker) -> sa.Table:
    """Create and seed the pre-cursor artifact schema.

    Args:
        connection: Isolated SQLite connection.
        faker: Fake data generator.

    Returns:
        Artifact table without generated rank columns.
    """
    # Copy public column attributes without inheriting the new computed fields.
    table = sa.Table(
        "artifacts",
        sa.MetaData(),
        *(
            sa.Column(
                column.name,
                column.type,
                primary_key=column.primary_key,
                nullable=column.nullable,
            )
            for column in Artifact.__table__.columns
            if column.name not in RANKS
        ),
    )
    table.create(connection)
    _upgrade(connection, LEGACY_MIGRATION)
    rows = []
    for nulls in product((False, True), repeat=len(FIELDS)):
        values = (faker.date_object(), faker.word(), faker.word())
        rows.append(
            {
                "bucket": faker.uuid4(),
                "key": faker.uuid4(),
                "platform_type": PlatformType.AERIAL,
                **{
                    field: None if is_null else value
                    for field, value, is_null in zip(FIELDS, values, nulls)
                },
            }
        )
    connection.execute(table.insert(), rows)
    return table


class TestCursorSortSchema:
    """Check model and migration behavior without changing cursor tokens."""

    @pytest.mark.parametrize("schema_source", ["migration", "model"])
    def test_generated_ranks(
        self,
        connection: Connection,
        legacy_table: sa.Table,
        faker: Faker,
        schema_source: str,
    ) -> None:
        """Ranks track inserts and updates for every NULL combination.

        Args:
            connection: Seeded SQLite connection.
            legacy_table: Pre-cursor artifact table.
            faker: Fake data generator.
            schema_source: Whether to build from migrations or ORM metadata.
        """
        original = connection.execute(sa.select(legacy_table)).mappings().all()
        if schema_source == "migration":
            _upgrade(connection, MIGRATION)
        else:
            legacy_table.drop(connection)
            Artifact.__table__.create(connection)
            connection.execute(
                Artifact.__table__.insert(), list(map(dict, original))
            )
        table = sa.Table("artifacts", sa.MetaData(), autoload_with=connection)
        for row in connection.execute(sa.select(table)).mappings().all():
            assert tuple(row[rank] for rank in RANKS) == tuple(
                int(row[field] is None) for field in FIELDS
            )
            replacements = (faker.date_object(), faker.word(), faker.word())
            updates = {
                field: value if row[field] is None else None
                for field, value in zip(FIELDS, replacements)
            }
            identity = sa.and_(
                table.c.bucket == row["bucket"], table.c.key == row["key"]
            )
            connection.execute(
                table.update().where(identity).values(**updates)
            )
            updated = (
                connection.execute(sa.select(table).where(identity))
                .mappings()
                .one()
            )
            assert tuple(updated[rank] for rank in RANKS) == tuple(
                int(updates[field] is None) for field in FIELDS
            )

    def test_upgrade_downgrade(
        self, connection: Connection, legacy_table: sa.Table
    ) -> None:
        """Upgrades and downgrades preserve seeded rows and the legacy index.

        Args:
            connection: Seeded SQLite connection.
            legacy_table: Pre-cursor artifact table.
        """
        original = connection.execute(sa.select(legacy_table)).all()
        original_indexes = sa.inspect(connection).get_indexes("artifacts")
        assert MIGRATION.down_revision == "5721871e3437"
        _upgrade(connection, MIGRATION)
        columns = sa.inspect(connection).get_columns("artifacts")
        for rank in RANKS:
            column = next(
                column for column in columns if column["name"] == rank
            )
            assert isinstance(column["type"], sa.Integer)
            assert column["nullable"]
            assert column["computed"]["persisted"] is False
        with Operations.context(MigrationContext.configure(connection)):
            MIGRATION.downgrade()
        assert {
            column["name"]
            for column in sa.inspect(connection).get_columns("artifacts")
        } == set(legacy_table.c.keys())
        assert (
            sa.inspect(connection).get_indexes("artifacts") == original_indexes
        )
        assert connection.execute(sa.select(legacy_table)).all() == original
        # A second upgrade also checks that downgrade removed dependent objects.
        _upgrade(connection, MIGRATION)
        assert connection.execute(sa.select(legacy_table)).all() == original

    @pytest.mark.parametrize(
        "dialect",
        [sqlite.dialect(), mysql.dialect(), MariaDBDialect()],
        ids=["sqlite", "mysql", "mariadb"],
    )
    def test_model_matches_migration_ddl(self, dialect: Dialect) -> None:
        """Both schema paths emit identical composite indexes and VIRTUAL ranks.

        Args:
            dialect: SQL dialect used to compile schema operations.
        """
        output = StringIO()
        context = MigrationContext.configure(
            dialect=dialect, opts={"as_sql": True, "output_buffer": output}
        )
        with Operations.context(context):
            LEGACY_MIGRATION.upgrade()
            MIGRATION.upgrade()
        statements = output.getvalue()
        for index_name, expected_order in (
            (
                "ix_name_session_capture_date",
                "capture_date DESC, session_name, name",
            ),
            (
                "ix_artifacts_cursor_sort",
                "capture_date_is_null, capture_date DESC, "
                "session_name_is_null, session_name, name_is_null, "
                "name, bucket, {key}",
            ),
        ):
            index = next(
                index
                for index in Artifact.__table__.indexes
                if index.name == index_name
            )
            ddl = str(CreateIndex(index).compile(dialect=dialect))
            assert ddl in statements
            key = dialect.identifier_preparer.quote("key")
            assert ddl == (
                f"CREATE INDEX {index_name} ON artifacts "
                f"({expected_order.format(key=key)})"
            )
        for field, rank in zip(FIELDS, RANKS):
            column = Artifact.__table__.c[rank]
            ddl = str(CreateColumn(column).compile(dialect=dialect))
            assert ddl in statements
            assert f"GENERATED ALWAYS AS ({field} IS NULL) VIRTUAL" in ddl
            assert "NOT NULL" not in ddl
            assert rank not in Artifact.pydantic_fields()
