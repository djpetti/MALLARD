"""SQL-backed regression coverage for cursor pagination."""

import base64
import json
from datetime import date, timedelta
from typing import Any

import pytest
import pytest_asyncio
from faker import Faker
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from mallard.gateway.backends.metadata.pagination import QueryPage
from mallard.gateway.backends.metadata.schemas import ImageQuery, Ordering
from mallard.gateway.backends.metadata.sql.models import Artifact
from mallard.gateway.backends.metadata.sql.sql_artifact_metadata_store import (
    SqlArtifactMetadataStore,
    SqlRasterMetadataStore,
)
from mallard.gateway.backends.objects.models import (
    ObjectRef,
    ObjectType,
    TypedObjectRef,
)

from .test_sql_artifact_metadata_store import (
    TestSqlArtifactMetadataStore as _ExistingSqlTests,
)


def _token(payload: Any) -> str:
    """Encodes arbitrary JSON for adversarial cursor tests.

    Args:
        payload: Deliberately untrusted token contents.

    Returns:
        The unpadded base64url representation.
    """
    return (
        base64.urlsafe_b64encode(json.dumps(payload).encode())
        .decode()
        .rstrip("=")
    )


def _payload(cursor: str) -> dict[str, Any]:
    """Inspects a token to mutate one property independently.

    Args:
        cursor: A token emitted by the store.

    Returns:
        Its decoded JSON object.
    """
    return json.loads(
        base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
    )


def _expected(
    models: list[Artifact], orderings: list[Ordering]
) -> list[TypedObjectRef]:
    """Builds an independent Python ordering oracle with NULL values last.

    Args:
        models: Seeded database rows.
        orderings: Requested ordering specifications.

    Returns:
        Expected typed references in deterministic order.
    """
    attributes = {
        Ordering.Field.NAME: "name",
        Ordering.Field.SESSION: "session_name",
        Ordering.Field.SEQUENCE_NUM: "sequence_number",
        Ordering.Field.CAPTURE_DATE: "capture_date",
        Ordering.Field.CAMERA: "camera",
    }
    rows = sorted(models, key=lambda model: (model.bucket, model.key))
    for order in reversed(orderings):
        attribute = attributes[order.field]
        # Stable passes implement mixed directions without reversing NULL ranks.
        nonnull = []
        nulls = []
        for row in rows:
            value = getattr(
                row.raster if attribute == "camera" else row, attribute
            )
            if value is None:
                nulls.append(row)
            else:
                nonnull.append((value, row))
        rows = [
            row
            for _, row in sorted(
                nonnull, key=lambda item: item[0], reverse=not order.ascending
            )
        ] + nulls
    return [
        TypedObjectRef(
            id=ObjectRef(bucket=row.bucket, name=row.key),
            type=(
                ObjectType.IMAGE
                if row.raster.image is not None
                else (
                    ObjectType.VIDEO
                    if row.raster.video is not None
                    else ObjectType.RASTER
                )
            ),
        )
        for row in rows
    ]


async def _traverse(
    store: SqlArtifactMetadataStore,
    orderings: list[Ordering],
    page_size: int,
    queries: list[ImageQuery] | None = None,
) -> list[TypedObjectRef]:
    """Traverses all pages while guarding against nonprogressing cursors.

    Args:
        store: Store under test.
        orderings: Requested ordering specifications.
        page_size: Maximum references per page.
        queries: Optional disjunctive filters.

    Returns:
        All references encountered in order.
    """
    cursor = None
    results = []
    seen_cursors = set()
    while True:
        page = await store.query_page(
            iter(queries if queries is not None else [ImageQuery()]),
            iter(orderings),
            cursor=cursor,
            max_num_results=page_size,
        )
        assert isinstance(page, QueryPage)
        assert len(page.image_ids) <= page_size
        results.extend(page.image_ids)
        if page.next_cursor is None:
            break
        assert len(page.image_ids) == page_size
        assert page.next_cursor not in seen_cursors
        seen_cursors.add(page.next_cursor)
        assert len(seen_cursors) < 100
        cursor = page.next_cursor
    assert len(set(results)) == len(results)
    return results


class TestCursorPagination:
    """Exercises real SQL selection, ordering, and continuation boundaries."""

    # Reuse the existing SQL fixture without inheriting its unrelated tests.
    sqlite_session_factory = _ExistingSqlTests.sqlite_session_factory

    @pytest_asyncio.fixture
    async def populated(
        self,
        sqlite_session_factory: async_sessionmaker[AsyncSession],
        faker: Faker,
    ) -> tuple[SqlArtifactMetadataStore, list[Artifact]]:
        """Seeds ties, NULLs, repeated keys across buckets, and mixed types.

        Args:
            sqlite_session_factory: Existing SQLite transaction fixture.
            faker: Project-configured fake metadata generator.

        Returns:
            The store and independent source models for ordering assertions.
        """
        words = sorted(faker.words(nb=3, unique=True))
        buckets = sorted(faker.words(nb=2, unique=True))
        keys = sorted(faker.words(nb=6, unique=True))
        start = faker.date_object()
        ranks = [None, 2, 1, 1, 0, None, 2, 0, 1, None, 0, 2]
        models = []
        for index, rank in enumerate(ranks):
            object_type = [
                ObjectType.IMAGE,
                ObjectType.VIDEO,
                ObjectType.RASTER,
            ][index % 3]
            model = faker.artifact_model(
                object_id=ObjectRef(
                    bucket=buckets[index % 2], name=keys[index // 2]
                ),
                artifact_type=object_type,
            )
            # Initialize absent subtypes so the detached oracle needs no IO.
            if object_type != ObjectType.IMAGE:
                model.raster.image = None
            if object_type != ObjectType.VIDEO:
                model.raster.video = None
            model.name = None if rank is None else words[rank]
            session_rank = ranks[(index + 3) % len(ranks)]
            model.session_name = (
                None if session_rank is None else words[session_rank]
            )
            model.sequence_number = rank
            model.capture_date = (
                None if rank is None else start + timedelta(days=rank)
            )
            camera_rank = ranks[(index + 7) % len(ranks)]
            model.raster.camera = (
                None if camera_rank is None else words[camera_rank]
            )
            models.append(model)
        async with sqlite_session_factory.begin() as session:
            # Scramble insertion order so row insertion cannot mask missing ties.
            session.add_all(list(reversed(models)))
        return (
            SqlArtifactMetadataStore(
                sqlite_session_factory, enable_match=False
            ),
            models,
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("field", list(Ordering.Field))
    @pytest.mark.parametrize("ascending", [True, False])
    @pytest.mark.parametrize("page_size", [1, 2, 5, 12, 20])
    async def test_all_fields(
        self,
        populated: tuple[SqlArtifactMetadataStore, list[Artifact]],
        field: Ordering.Field,
        ascending: bool,
        page_size: int,
    ) -> None:
        """Traverses every supported field and direction across page sizes.

        Args:
            populated: Seeded store and source rows.
            field: Field being ordered.
            ascending: Requested direction.
            page_size: Maximum page size.
        """
        store, models = populated
        orderings = [Ordering(field=field, ascending=ascending)]
        assert await _traverse(store, orderings, page_size) == _expected(
            models, orderings
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "orderings",
        [
            [],
            [
                Ordering(field=Ordering.Field.SESSION),
                Ordering(field=Ordering.Field.SEQUENCE_NUM, ascending=False),
            ],
            [
                Ordering(field=Ordering.Field.CAMERA, ascending=False),
                Ordering(field=Ordering.Field.CAPTURE_DATE),
                Ordering(field=Ordering.Field.NAME, ascending=False),
            ],
            [
                Ordering(field=field, ascending=index % 2 == 0)
                for index, field in enumerate(Ordering.Field)
            ],
            [
                Ordering(field=Ordering.Field.NAME),
                Ordering(field=Ordering.Field.NAME, ascending=False),
            ],
        ],
        ids=[
            "identity",
            "mixed",
            "three_fields",
            "all_fields",
            "repeated_field",
        ],
    )
    async def test_multi_order(
        self,
        populated: tuple[SqlArtifactMetadataStore, list[Artifact]],
        orderings: list[Ordering],
    ) -> None:
        """Checks mixed directions and unique bucket/key tie breakers.

        Args:
            populated: Seeded store and source rows.
            orderings: Requested ordering specifications.
        """
        store, models = populated
        assert await _traverse(store, orderings, 1) == _expected(
            models, orderings
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "field",
        [
            None,
            Ordering.Field.NAME,
            Ordering.Field.SESSION,
            Ordering.Field.CAMERA,
            Ordering.Field.SEQUENCE_NUM,
        ],
    )
    @pytest.mark.parametrize("ascending", [True, False])
    async def test_public_add_sqlite_storage_widths(
        self,
        sqlite_session_factory: async_sessionmaker[AsyncSession],
        faker: Faker,
        field: Ordering.Field | None,
        ascending: bool,
    ) -> None:
        """Self-issued cursors accept widths stored by SQLite through add().

        Args:
            sqlite_session_factory: Existing SQLite transaction fixture.
            faker: Project-configured fake metadata generator.
            field: Optional ordering field beyond its declared SQL width.
            ascending: Requested ordering direction.
        """
        store = SqlRasterMetadataStore(sqlite_session_factory)
        prefix = faker.pystr(min_chars=120, max_chars=120)
        sequence_numbers = [-(2**63), -(2**40), 0, 2**40, 2**63 - 1]
        references = []
        for index, sequence_number in enumerate(sequence_numbers):
            # SQLite ignores VARCHAR widths, including on composite identity keys.
            object_id = ObjectRef(
                bucket=f"{prefix}-{index // 2}",
                name=f"{prefix}-{index % 2}",
            )
            metadata = faker.raster_metadata().model_copy(
                update={
                    "name": f"{prefix}-{index}",
                    "session_name": f"{prefix}-{index}",
                    "camera": f"{prefix}-{index}",
                    "sequence_number": sequence_number,
                }
            )
            await store.add(object_id=object_id, metadata=metadata)
            stored = await store.get(object_id)
            assert stored.name == metadata.name
            assert stored.sequence_number == sequence_number
            references.append(
                TypedObjectRef(id=object_id, type=ObjectType.RASTER)
            )
        orderings = (
            []
            if field is None
            else [Ordering(field=field, ascending=ascending)]
        )
        expected = (
            list(reversed(references))
            if field is not None and not ascending
            else references
        )
        assert await _traverse(store, orderings, 1) == expected

    @pytest.mark.asyncio
    @pytest.mark.parametrize("count", [0, 1, 2, 3, 4])
    @pytest.mark.parametrize("page_size", [1, 2])
    async def test_boundaries(
        self,
        sqlite_session_factory: async_sessionmaker[AsyncSession],
        faker: Faker,
        count: int,
        page_size: int,
    ) -> None:
        """Checks empty, singleton, exact-limit, and limit-plus-one pages.

        Args:
            sqlite_session_factory: Existing SQLite transaction fixture.
            faker: Project-configured fake metadata generator.
            count: Number of matching rows.
            page_size: Maximum page size.
        """
        models = [
            faker.artifact_model(object_id=faker.object_ref())
            for _ in range(count)
        ]
        async with sqlite_session_factory.begin() as session:
            session.add_all(models)
        store = SqlArtifactMetadataStore(sqlite_session_factory)
        cursor = None
        got = []
        while True:
            page = await store.query_page(
                [ImageQuery()], cursor=cursor, max_num_results=page_size
            )
            got.extend(page.image_ids)
            assert (page.next_cursor is not None) == (len(got) < count)
            if page.next_cursor is None:
                break
            cursor = page.next_cursor
        assert got == _expected(models, [])

    @pytest.mark.asyncio
    async def test_deleted_anchor_and_insertions(
        self,
        populated: tuple[SqlArtifactMetadataStore, list[Artifact]],
        sqlite_session_factory: async_sessionmaker[AsyncSession],
        faker: Faker,
    ) -> None:
        """Continuation survives deletion and skips newly inserted earlier rows.

        Args:
            populated: Seeded store and source rows.
            sqlite_session_factory: Existing SQLite transaction fixture.
            faker: Project-configured fake metadata generator.
        """
        store, models = populated
        orderings = [Ordering(field=Ordering.Field.SEQUENCE_NUM)]
        expected = _expected(models, orderings)
        first = await store.query_page(
            [ImageQuery()], orderings, max_num_results=3
        )
        assert first.image_ids == expected[:3]
        await store.delete(first.image_ids[-1].id)
        earlier = faker.raster_metadata().model_copy(
            update={"sequence_number": -1}
        )
        later = faker.raster_metadata().model_copy(
            update={"sequence_number": 10}
        )
        earlier_id, later_id = faker.object_ref(), faker.object_ref()
        writer = SqlRasterMetadataStore(sqlite_session_factory)
        await writer.add(object_id=earlier_id, metadata=earlier)
        await writer.add(object_id=later_id, metadata=later)
        remaining = await store.query_page(
            [ImageQuery()], orderings, cursor=first.next_cursor
        )
        # The late non-NULL value belongs before the existing NULL tail.
        assert (
            remaining.image_ids
            == expected[3:9]
            + [TypedObjectRef(id=later_id, type=ObjectType.RASTER)]
            + expected[9:]
        )
        assert earlier_id not in [
            reference.id for reference in remaining.image_ids
        ]

    @pytest.mark.asyncio
    async def test_disjunction_filters(
        self,
        populated: tuple[SqlArtifactMetadataStore, list[Artifact]],
    ) -> None:
        """Overlapping disjunctions preserve filtering without duplicate rows.

        Args:
            populated: Seeded store and source rows.
        """
        store, models = populated
        queries = [
            ImageQuery(
                sequence_numbers=ImageQuery.Range[int](
                    min_value=0, max_value=1
                )
            ),
            ImageQuery(
                sequence_numbers=ImageQuery.Range[int](
                    min_value=1, max_value=2
                )
            ),
        ]
        orderings = [Ordering(field=Ordering.Field.CAMERA, ascending=False)]
        matching = [row for row in models if row.sequence_number is not None]
        assert await _traverse(store, orderings, 2, queries) == _expected(
            matching, orderings
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "cursor",
        [
            "",
            "!",
            "a",
            "null",
            "a=",
            "a b",
            "é",
            "a" * 16385,
            _token(None),
            _token([]),
            _token({}),
            _token({"version": 1}),
        ],
    )
    async def test_invalid_encoding(
        self,
        populated: tuple[SqlArtifactMetadataStore, list[Artifact]],
        cursor: str,
    ) -> None:
        """Rejects malformed, oversized, and structurally invalid tokens.

        Args:
            populated: Seeded store and source rows.
            cursor: Untrusted continuation token.
        """
        store, _ = populated
        with pytest.raises(ValueError):
            await store.query_page([ImageQuery()], cursor=cursor)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("version", 2),
            ("version", True),
            ("version", "1"),
            ("fingerprint", "bad"),
            ("extra", "unexpected"),
            ("values", []),
            ("values", [None] * 4),
            ("values", [True, "bucket", "key"]),
            ("values", [1.5, "bucket", "key"]),
            ("values", ["1", "bucket", "key"]),
            ("values", [2**100, "bucket", "key"]),
            ("values", [2**63, "bucket", "key"]),
            ("values", [-(2**63) - 1, "bucket", "key"]),
            ("values", [1, None, "key"]),
            ("values", [1, "b" * 16385, "key"]),
            ("values", [1, "bucket", 3]),
            ("values", [{"sql": "injection"}, "bucket", "key"]),
        ],
    )
    async def test_invalid_payload(
        self,
        populated: tuple[SqlArtifactMetadataStore, list[Artifact]],
        field: str,
        value: Any,
    ) -> None:
        """Rejects token type, arity, version, and SQL-bound violations.

        Args:
            populated: Seeded store and source rows.
            field: Payload property to replace.
            value: Invalid replacement value.
        """
        store, _ = populated
        orderings = [Ordering(field=Ordering.Field.SEQUENCE_NUM)]
        first = await store.query_page(
            [ImageQuery()], orderings, max_num_results=1
        )
        assert first.next_cursor is not None
        payload = _payload(first.next_cursor)
        payload[field] = value
        with pytest.raises(ValueError):
            await store.query_page(
                [ImageQuery()], orderings, cursor=_token(payload)
            )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "value",
        [
            "yesterday",
            "2026-02-30",
            "20260101",
            "2026-01-01T12:00:00",
            20260101,
        ],
    )
    async def test_invalid_dates(
        self,
        populated: tuple[SqlArtifactMetadataStore, list[Artifact]],
        value: Any,
    ) -> None:
        """Date anchors must round trip as actual SQL dates.

        Args:
            populated: Seeded store and source rows.
            value: Invalid date anchor.
        """
        store, _ = populated
        orderings = [Ordering(field=Ordering.Field.CAPTURE_DATE)]
        first = await store.query_page(
            [ImageQuery()], orderings, max_num_results=1
        )
        assert first.next_cursor is not None
        payload = _payload(first.next_cursor)
        assert (
            date.fromisoformat(payload["values"][0]).isoformat()
            == payload["values"][0]
        )
        payload["values"][0] = value
        with pytest.raises(ValueError):
            await store.query_page(
                [ImageQuery()], orderings, cursor=_token(payload)
            )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "change", ["query", "field", "direction", "order", "additional"]
    )
    async def test_query_binding(
        self,
        populated: tuple[SqlArtifactMetadataStore, list[Artifact]],
        change: str,
    ) -> None:
        """A valid cursor cannot be reused with different filtering or sorting.

        Args:
            populated: Seeded store and source rows.
            change: Query characteristic to alter.
        """
        store, _ = populated
        queries = [ImageQuery()]
        orderings = [
            Ordering(field=Ordering.Field.NAME),
            Ordering(field=Ordering.Field.SESSION),
        ]
        first = await store.query_page(queries, orderings, max_num_results=1)
        if change == "query":
            queries = [ImageQuery(name="different")]
        elif change == "field":
            orderings[0] = Ordering(field=Ordering.Field.CAMERA)
        elif change == "direction":
            orderings[0] = Ordering(field=Ordering.Field.NAME, ascending=False)
        elif change == "order":
            orderings.reverse()
        else:
            orderings.append(Ordering(field=Ordering.Field.SEQUENCE_NUM))
        with pytest.raises(ValueError):
            await store.query_page(
                queries, orderings, cursor=first.next_cursor
            )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("page_size", [0, -1, True, 1.5, 2**63])
    async def test_invalid_page_size(
        self,
        populated: tuple[SqlArtifactMetadataStore, list[Artifact]],
        page_size: Any,
    ) -> None:
        """Rejects invalid SQL limits before executing a query.

        Args:
            populated: Seeded store and source rows.
            page_size: Invalid maximum result count.
        """
        store, _ = populated
        with pytest.raises(ValueError):
            await store.query_page([ImageQuery()], max_num_results=page_size)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "orderings",
        [
            [],
            [Ordering(field=Ordering.Field.NAME)],
            [Ordering(field=Ordering.Field.NAME, ascending=False)],
        ],
        ids=["identity", "nullable_ascending", "nullable_descending"],
    )
    async def test_no_offset(
        self,
        populated: tuple[SqlArtifactMetadataStore, list[Artifact]],
        sqlite_session_factory: async_sessionmaker[AsyncSession],
        orderings: list[Ordering],
    ) -> None:
        """SQL omits offsets and redundant NULL handling on identity columns.

        Args:
            populated: Seeded store and source rows.
            sqlite_session_factory: Existing SQLite transaction fixture.
            orderings: Identity-only or nullable-field ordering to inspect.
        """
        store, models = populated
        engine = sqlite_session_factory.kw["bind"].sync_engine
        statements = []

        def capture(
            connection: Any,
            cursor: Any,
            statement: str,
            parameters: Any,
            context: Any,
            executemany: bool,
        ) -> None:
            """Captures SQL and parameters without changing execution.

            Args:
                connection: SQLAlchemy connection.
                cursor: DBAPI cursor.
                statement: Rendered SQL.
                parameters: Bound SQL values.
                context: SQLAlchemy execution context.
                executemany: Whether this is a batch operation.
            """
            if "LIMIT" in statement.upper():
                statements.append((statement, parameters))

        event.listen(engine, "before_cursor_execute", capture)
        try:
            assert await _traverse(store, orderings, 2) == _expected(
                models, orderings
            )
        finally:
            event.remove(engine, "before_cursor_execute", capture)
        assert len(statements) == 6
        for statement, parameters in statements:
            # Only nullable fields need a rank; identity indexes need raw columns.
            assert statement.upper().count("CASE WHEN") == len(orderings)
            normalized = statement.replace('"', "")
            assert "artifacts.bucket IS NULL" not in normalized
            assert "artifacts.key IS NULL" not in normalized
            if "OFFSET" in statement.upper():
                # SQLite emits OFFSET 0 automatically for LIMIT-only selects.
                assert parameters[-1] == 0
                assert parameters[-2] == 3
            else:
                assert parameters[-1] == 3
        assert all(
            "WHERE" in sql and " > " in sql for sql, _ in statements[1:]
        )
