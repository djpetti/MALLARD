"""HTTP regression tests for opt-in cursor queries and legacy pagination."""

from typing import AsyncIterator

import pytest
import pytest_asyncio
from faker import Faker
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from mallard.gateway.backends.metadata import ArtifactMetadataStore
from mallard.gateway.backends.metadata.irods_artifact_metadata_store import (
    IrodsArtifactMetadataStore,
)
from mallard.gateway.backends.metadata.schemas import ImageQuery
from mallard.gateway.backends.metadata.sql.models import Base
from mallard.gateway.backends.metadata.sql.sql_artifact_metadata_store import (
    SqlArtifactMetadataStore,
)
from mallard.gateway.backends.objects.models import ObjectType
from mallard.gateway.routers import root

from ...conftest import ConfigForTests


@pytest_asyncio.fixture
async def query_client(faker: Faker) -> AsyncIterator[AsyncClient]:
    """Creates a real HTTP query client backed by a populated SQLite database.

    Args:
        faker: Generator for artifact metadata and identities.

    Yields:
        A client with six artifacts sharing a sort value.
    """
    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory.begin() as session:
            for _ in range(6):
                model = faker.artifact_model(
                    object_id=faker.object_ref(),
                    artifact_type=ObjectType.IMAGE,
                )
                # Ties force continuation to use the unique identity as well.
                model.sequence_number = 1
                session.add(model)
        store = SqlArtifactMetadataStore(factory, enable_match=False)
        app = FastAPI()
        app.include_router(root.router)

        async def metadata_store() -> ArtifactMetadataStore:
            """Returns the real SQL store used by this isolated application."""
            return store

        app.dependency_overrides[
            root.endpoints.backends.artifact_metadata_store
        ] = metadata_store
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client
    finally:
        await engine.dispose()


@pytest.mark.asyncio
class TestQueryCursors:
    """Checks cursor and legacy contracts at the HTTP boundary."""

    @pytest.mark.parametrize("page_size", (1, 2, 3, 6, 7))
    async def test_traversal(
        self, query_client: AsyncClient, page_size: int
    ) -> None:
        """Traverses tied results without an extra empty final page.

        Args:
            query_client: SQLite-backed HTTP client.
            page_size: Requested maximum number of results.
        """
        body = {
            "queries": [{}],
            "orderings": [{"field": "sequence_num", "ascending": False}],
        }
        cursor = ""
        identities = []
        pages = 0
        while True:
            response = await query_client.post(
                "/query",
                params={"cursor": cursor, "results_per_page": page_size},
                json=body,
            )
            assert response.status_code == 200
            page = response.json()
            assert set(page) == {
                "imageIds",
                "pageNum",
                "isLastPage",
                "nextCursor",
            }
            assert page["pageNum"] is None
            assert 0 < len(page["imageIds"]) <= page_size
            identities.extend(item["id"] for item in page["imageIds"])
            pages += 1
            assert pages <= 6
            if page["isLastPage"]:
                assert page["nextCursor"] is None
                break
            assert page["nextCursor"]
            assert page["nextCursor"] != cursor
            cursor = page["nextCursor"]
        assert len(identities) == 6
        assert (
            len({(item["bucket"], item["name"]) for item in identities}) == 6
        )
        assert pages == (6 + page_size - 1) // page_size

    async def test_legacy_shape_and_boundary(
        self, query_client: AsyncClient
    ) -> None:
        """Preserves legacy page numbers, JSON fields, and empty last pages.

        Args:
            query_client: SQLite-backed HTTP client.
        """
        for page_num, count, last in (
            (1, 3, False),
            (2, 3, False),
            (3, 0, True),
        ):
            response = await query_client.post(
                "/query",
                params={"results_per_page": 3, "page_num": page_num},
                json={"queries": [{}], "orderings": []},
            )
            assert response.status_code == 200
            page = response.json()
            assert set(page) == {"imageIds", "pageNum", "isLastPage"}
            assert page["pageNum"] == page_num
            assert len(page["imageIds"]) == count
            assert page["isLastPage"] is last

    @pytest.mark.parametrize("cursor_mode", (False, True))
    async def test_empty_results(
        self, query_client: AsyncClient, faker: Faker, cursor_mode: bool
    ) -> None:
        """Returns an empty final page for a filter with no matching artifacts.

        Args:
            query_client: SQLite-backed HTTP client.
            faker: Generator for a nonexistent metadata value.
            cursor_mode: Whether to request cursor pagination.
        """
        response = await query_client.post(
            "/query",
            params={"cursor": ""} if cursor_mode else {},
            json={"queries": [{"name": faker.uuid4()}]},
        )
        assert response.status_code == 200
        page = response.json()
        assert page["imageIds"] == []
        assert page["isLastPage"] is True
        if cursor_mode:
            assert page["nextCursor"] is None

    @pytest.mark.parametrize(
        "params",
        (
            {"cursor": "", "page_num": 2},
            {"cursor": "not-a-cursor"},
            {"cursor": "!"},
            {"cursor": "a" * 16_385},
            {"cursor": "", "results_per_page": 0},
            {"cursor": "", "page_num": 0},
        ),
    )
    async def test_invalid_parameters(
        self, query_client: AsyncClient, params: dict[str, str | int]
    ) -> None:
        """Rejects invalid tokens, limits, and mixed pagination modes.

        Args:
            query_client: SQLite-backed HTTP client.
            params: Invalid query parameters to reject.
        """
        response = await query_client.post(
            "/query", params=params, json={"queries": [{}]}
        )
        assert response.status_code == 422

    @pytest.mark.parametrize(
        "body",
        (
            {"queries": [{"name": "different"}]},
            {"queries": [{}], "orderings": [{"field": "name"}]},
        ),
    )
    async def test_changed_query(
        self, query_client: AsyncClient, body: dict[str, list[dict[str, str]]]
    ) -> None:
        """Rejects continuation tokens reused with different filters or orders.

        Args:
            query_client: SQLite-backed HTTP client.
            body: Changed filter or ordering request.
        """
        response = await query_client.post(
            "/query?cursor=&results_per_page=2", json={"queries": [{}]}
        )
        cursor = response.json()["nextCursor"]
        response = await query_client.post(
            "/query", params={"cursor": cursor}, json=body
        )
        assert response.status_code == 422

    async def test_unsupported_backend(self, config: ConfigForTests) -> None:
        """Reports unsupported cursor backends instead of using an offset.

        Args:
            config: Mocked backend dependencies.
        """
        config.mock_metadata_store.query_page.side_effect = (
            NotImplementedError("Cursor pagination is unsupported.")
        )
        app = FastAPI()
        app.include_router(root.router)

        async def metadata_store() -> ArtifactMetadataStore:
            """Returns a backend that explicitly rejects cursor pagination."""
            return config.mock_metadata_store

        app.dependency_overrides[
            root.endpoints.backends.artifact_metadata_store
        ] = metadata_store
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/query?cursor=", json={"queries": [{}]}
            )
        assert response.status_code == 501
        config.mock_metadata_store.query.assert_not_called()

    async def test_irods_does_not_emulate_cursors(self) -> None:
        """Rejects iRODS cursor requests before touching a database session."""
        # The inherited capability check needs no initialized iRODS connection.
        store = object.__new__(IrodsArtifactMetadataStore)
        with pytest.raises(NotImplementedError):
            await store.query_page([ImageQuery()])
