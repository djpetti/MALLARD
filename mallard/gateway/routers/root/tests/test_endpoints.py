"""
Unit tests for the `endpoints` module.
"""

import io
from typing import AsyncIterable, Iterator

import pytest
from faker import Faker
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from pytest_mock import MockFixture
from starlette.responses import StreamingResponse

from mallard.gateway.backends.metadata.schemas import ImageQuery
from mallard.gateway.backends.objects import ObjectStore
from mallard.gateway.backends.objects.models import ObjectRef, derived_id
from mallard.gateway.routers import root

from ...conftest import ConfigForTests


@pytest.mark.asyncio
async def test_get_thumbnail(config: ConfigForTests, faker: Faker) -> None:
    """
    Tests that the `get_thumbnail` endpoint works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and image names.
    bucket = faker.pystr()
    image_name = faker.pystr()

    # Act.
    response = await root.endpoints.get_thumbnail(
        bucket=bucket,
        name=image_name,
        scale=128,
        object_store=config.mock_object_store,
    )

    # Assert.
    # It should have gotten the thumbnail.
    config.mock_object_store.get_object.assert_called_once()
    args, _ = config.mock_object_store.get_object.call_args
    thumbnail_id = args[0]
    assert thumbnail_id == derived_id(
        ObjectRef(bucket=bucket, name=image_name), "thumbnail", scale=128
    )
    # The name for this object should be distinct from that of the raw image.
    assert thumbnail_id.name != image_name
    image_stream = config.mock_object_store.get_object.return_value

    # It should have used a StreamingResponse object.
    config.mock_streaming_response_class.assert_called_once_with(
        image_stream, media_type="image/jpeg"
    )
    assert response == config.mock_streaming_response_class.return_value


@pytest.mark.asyncio
async def test_get_thumbnail_nonexistent(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that the `get_thumbnail` endpoint handles the case where the image
    does not exist.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and image names.
    bucket = faker.pystr()
    image_name = faker.pystr()

    # Make it look like the image doesn't exist.
    config.mock_object_store.get_object.side_effect = KeyError

    # Act and assert.
    with pytest.raises(HTTPException) as error:
        await root.endpoints.get_thumbnail(
            bucket=bucket,
            name=image_name,
            scale=128,
            object_store=config.mock_object_store,
        )
    assert error.value.status_code == 404
    object_id = ObjectRef(bucket=bucket, name=image_name)
    assert config.mock_object_store.get_object.await_args_list == [
        ((derived_id(object_id, "thumbnail", scale=128),), {}),
        ((derived_id(object_id, "thumbnail"),), {}),
    ]


async def _image_chunks(image: bytes) -> AsyncIterable[bytes]:
    """Streams an encoded image in chunks that do not align with JPEG records.

    Args:
        image: The encoded image to stream.

    Yields:
        The next chunk of the image.
    """
    # Splitting the JPEG header catches accidental per-chunk image decoding.
    for offset in range(0, len(image), 113):
        yield image[offset : offset + 113]


@pytest.fixture
def thumbnail_client(
    config: ConfigForTests, mocker: MockFixture
) -> Iterator[TestClient]:
    """Creates a client using real responses and the mocked object store.

    Args:
        config: The configuration to use for testing.
        mocker: The fixture to use for mocking.

    Yields:
        A client for the root router without application authentication.
    """
    # The shared fixture mocks responses, but these tests decode actual JPEGs.
    mocker.patch.object(root.endpoints, "StreamingResponse", StreamingResponse)
    app = FastAPI()
    app.include_router(root.router)

    async def object_store() -> ObjectStore:
        """Returns the object store configured for this test."""
        return config.mock_object_store

    app.dependency_overrides[root.endpoints.backends.object_store] = (
        object_store
    )
    with TestClient(app) as client:
        yield client


class TestGetThumbnail:
    """Tests thumbnail selection, legacy conversion, and HTTP validation."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("scale", (128, 256, 384, 73))
    async def test_variant_preferred(
        self,
        config: ConfigForTests,
        mocker: MockFixture,
        faker: Faker,
        scale: int,
    ) -> None:
        """Streams the requested variant unchanged without resizing.

        Args:
            config: The configuration to use for testing.
            mocker: The fixture to use for mocking.
            faker: The fixture to use for generating fake data.
            scale: The requested horizontal thumbnail size.
        """
        object_id = faker.object_ref()
        image = faker.image(formats={"jpeg"}).getvalue()
        config.mock_object_store.get_object.return_value = _image_chunks(image)
        mocker.patch.object(
            root.endpoints, "StreamingResponse", StreamingResponse
        )
        process_pool = mocker.patch.object(root.endpoints, "get_process_pool")

        response = await root.endpoints.get_thumbnail(
            bucket=object_id.bucket,
            name=object_id.name,
            object_store=config.mock_object_store,
            scale=scale,
        )
        body = b"".join([chunk async for chunk in response.body_iterator])

        assert body == image
        with Image.open(io.BytesIO(body)) as thumbnail:
            assert thumbnail.format == "JPEG"
            thumbnail.load()
        assert response.media_type == "image/jpeg"
        config.mock_object_store.get_object.assert_awaited_once_with(
            derived_id(object_id, "thumbnail", scale=scale)
        )
        process_pool.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "size", ((512, 256), (256, 512), (64, 32), (32, 64))
    )
    @pytest.mark.parametrize("scale", (128, 256, 384))
    async def test_legacy_resized(
        self,
        config: ConfigForTests,
        mocker: MockFixture,
        faker: Faker,
        size: tuple[int, int],
        scale: int,
    ) -> None:
        """Resizes streamed legacy images to exact width, including upscaling.

        Args:
            config: The configuration to use for testing.
            mocker: The fixture to use for mocking.
            faker: The fixture to use for generating fake data.
            size: The landscape or portrait legacy image dimensions.
            scale: The requested horizontal thumbnail size.
        """
        object_id = faker.object_ref()
        image = Image.frombytes(
            "RGB", size, faker.binary(size[0] * size[1] * 3)
        )
        legacy = io.BytesIO()
        image.save(legacy, format="JPEG")
        config.mock_object_store.get_object.side_effect = [
            KeyError,
            _image_chunks(legacy.getvalue()),
        ]
        mocker.patch.object(
            root.endpoints, "StreamingResponse", StreamingResponse
        )
        # Use the real process pool and image helper to test encoded output.
        process_pool = mocker.spy(root.endpoints, "get_process_pool")

        response = await root.endpoints.get_thumbnail(
            bucket=object_id.bucket,
            name=object_id.name,
            object_store=config.mock_object_store,
            scale=scale,
        )
        body = b"".join([chunk async for chunk in response.body_iterator])

        with Image.open(io.BytesIO(body)) as thumbnail:
            assert thumbnail.format == "JPEG"
            assert thumbnail.size == (scale, round(size[1] * scale / size[0]))
            thumbnail.load()
        assert response.media_type == "image/jpeg"
        assert config.mock_object_store.get_object.await_args_list == [
            mocker.call(derived_id(object_id, "thumbnail", scale=scale)),
            mocker.call(derived_id(object_id, "thumbnail")),
        ]
        process_pool.assert_called_once_with()

    @pytest.mark.parametrize(
        ("scale_path", "expected_scale"),
        (("/128", 128), ("/256", 256), ("/384", 384), ("/73", 73)),
    )
    def test_routes(
        self,
        thumbnail_client: TestClient,
        config: ConfigForTests,
        faker: Faker,
        scale_path: str,
        expected_scale: int,
    ) -> None:
        """Serves explicit positive-width URLs as JPEGs.

        Args:
            thumbnail_client: The client for the root router.
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            scale_path: The required width path component.
            expected_scale: The width used to select the stored variant.
        """
        object_id = faker.object_ref()
        image = faker.image(formats={"jpeg"}).getvalue()
        config.mock_object_store.get_object.return_value = _image_chunks(image)

        response = thumbnail_client.get(
            f"/thumbnail/{object_id.bucket}/{object_id.name}{scale_path}"
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        assert response.content == image
        with Image.open(io.BytesIO(response.content)) as thumbnail:
            assert thumbnail.format == "JPEG"
            thumbnail.load()
        config.mock_object_store.get_object.assert_awaited_once_with(
            derived_id(object_id, "thumbnail", scale=expected_scale)
        )

    @pytest.mark.parametrize("query", ("", "?scale=256"))
    def test_route_requires_scale(
        self,
        thumbnail_client: TestClient,
        config: ConfigForTests,
        faker: Faker,
        query: str,
    ) -> None:
        """Require a width in the path even when a query width is supplied.

        Args:
            thumbnail_client: The client for the root router.
            config: The configuration to use for testing.
            faker: The fixture for generating object references.
            query: The optional query string that must not replace the path.
        """
        object_id = faker.object_ref()
        response = thumbnail_client.get(
            f"/thumbnail/{object_id.bucket}/{object_id.name}{query}"
        )
        assert response.status_code == 404
        config.mock_object_store.get_object.assert_not_awaited()

    @pytest.mark.parametrize("scale", ("0", "-1", "1.5", "wide"))
    def test_route_rejects_invalid_scale(
        self,
        thumbnail_client: TestClient,
        config: ConfigForTests,
        faker: Faker,
        scale: str,
    ) -> None:
        """Rejects nonpositive or noninteger path widths before storage access.

        Args:
            thumbnail_client: The client for the root router.
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            scale: An invalid width path component.
        """
        object_id = faker.object_ref()

        response = thumbnail_client.get(
            f"/thumbnail/{object_id.bucket}/{object_id.name}/{scale}"
        )

        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["path", "scale"]
        config.mock_object_store.get_object.assert_not_awaited()

    @pytest.mark.parametrize("scale_path", ("/128", "/256"))
    def test_routes_missing(
        self,
        thumbnail_client: TestClient,
        config: ConfigForTests,
        faker: Faker,
        scale_path: str,
    ) -> None:
        """Returns HTTP 404 when neither a variant nor a legacy image exists.

        Args:
            thumbnail_client: The client for the root router.
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.
            scale_path: The required width path component.
        """
        object_id = faker.object_ref()
        config.mock_object_store.get_object.side_effect = KeyError

        response = thumbnail_client.get(
            f"/thumbnail/{object_id.bucket}/{object_id.name}{scale_path}"
        )

        assert response.status_code == 404
        assert config.mock_object_store.get_object.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    (
        "results_per_page",
        "page_num",
        "total_results",
        "is_last",
        "multiple_queries",
    ),
    (
        (10, 1, 5, True, False),
        (20, 2, 40, False, False),
        (20, 3, 40, True, False),
        (5, 2, 16, False, False),
        (10, 5, 5, True, False),
        (10, 1, 5, True, True),
    ),
    ids=(
        "fits_on_one_page",
        "exact_page_division",
        "empty_last_page",
        "truncated_results",
        "out_of_bounds",
        "multiple_queries",
    ),
)
async def test_query_images(
    config: ConfigForTests,
    faker: Faker,
    mocker: MockFixture,
    results_per_page: int,
    page_num: int,
    total_results: int,
    is_last: bool,
    multiple_queries: bool,
) -> None:
    """
    Tests that the `query_image` endpoint works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        mocker: The fixture to use for mocking.
        results_per_page: Max number of query results per page.
        page_num: Page number to retrieve.
        total_results: Total number of results that will be produced.
        is_last: True if we expect it to report that this is the last page.
        multiple_queries: Whether to simulate running more than one query at
            once.

    """
    # Arrange.
    # Generate a fake query.
    mock_queries = [mocker.create_autospec(ImageQuery, instance=True)]
    if multiple_queries:
        mock_queries.append(mocker.create_autospec(ImageQuery, instance=True))

    # Fake the query results.
    async def query_results() -> AsyncIterable:
        # Simulate the query skipping the first N results.
        num_results = total_results - (page_num - 1) * results_per_page
        # Simulate the query limiting to the page size.
        num_results = min(num_results, results_per_page)
        for _ in range(num_results):
            yield faker.typed_object_ref()

    config.mock_metadata_store.query.return_value = query_results()

    # Act.
    response = await root.endpoints.query_artifacts(
        queries=mock_queries,
        orderings=[],
        results_per_page=results_per_page,
        page_num=page_num,
        metadata_store=config.mock_metadata_store,
    )

    # Assert.
    # It should have queried the backend.
    config.mock_metadata_store.query.assert_called_once_with(
        mock_queries,
        skip_first=(page_num - 1) * results_per_page,
        max_num_results=results_per_page,
        orderings=[],
    )

    # It should have gotten the number of images that it asked for.
    assert len(response.image_ids) <= results_per_page
    assert response.page_num == page_num
    assert response.is_last_page == is_last
