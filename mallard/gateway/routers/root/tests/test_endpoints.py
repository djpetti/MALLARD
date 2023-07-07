"""
Unit tests for the `endpoints` module.
"""
from typing import AsyncIterable

import pytest
from faker import Faker
from fastapi import HTTPException
from pytest_mock import MockFixture

from mallard.gateway.backends.metadata.schemas import ImageQuery
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
        object_store=config.mock_object_store,
    )

    # Assert.
    # It should have gotten the thumbnail.
    config.mock_object_store.get_object.assert_called_once()
    args, _ = config.mock_object_store.get_object.call_args
    thumbnail_id = args[0]
    assert thumbnail_id.bucket == bucket
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
    with pytest.raises(HTTPException):
        await root.endpoints.get_thumbnail(
            bucket=bucket,
            name=image_name,
            object_store=config.mock_object_store,
        )


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
