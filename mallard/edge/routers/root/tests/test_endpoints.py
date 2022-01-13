"""
Tests for the `endpoints` module.
"""


from collections.abc import Coroutine
from functools import partial
from typing import Callable

import pytest
from faker import Faker

from mallard.edge.routers.root import endpoints


@pytest.mark.parametrize(
    "endpoint",
    [endpoints.get_index, partial(endpoints.get_details, "bucket", "name")],
    ids=["get_index", "get_details"],
)
@pytest.mark.parametrize("fragment", [False, True], ids=["normal", "fragment"])
@pytest.mark.asyncio
async def test_fragment(
    endpoint: Callable[..., Coroutine[str, None, None]], fragment: bool
) -> None:
    """
    Tests that we can get fragment versions of each page.

    Args:
        endpoint: The endpoint function to test.
        fragment: Whether to get the page as a fragment or not.

    """
    # Act.
    got_response = await endpoint(fragment=fragment)

    # Assert.
    if not fragment:
        # It should have gotten a complete page.
        assert "</html>" in got_response
    else:
        # It should have gotten a fragment.
        assert "</html>" not in got_response


@pytest.mark.asyncio
async def test_get_index() -> None:
    """
    Tests that the `get_index` endpoint works.

    """
    # Act.
    got_response = await endpoints.get_index()

    # Assert.
    # It should have made the response.
    assert "</html>" in got_response


@pytest.mark.asyncio
async def test_get_details(faker: Faker) -> None:
    """
    Tests that the `get_details` endpoint works.

    Args:
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    bucket = faker.pystr()
    name = faker.pystr()

    # Act.
    got_response = await endpoints.get_details(bucket, name)

    # Assert.
    # It should have filled in the template.
    assert "</html>" in got_response
    assert "</large-image-display>" in got_response
    assert bucket in got_response
    assert name in got_response
