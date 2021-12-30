"""
Tests for the `endpoints` module.
"""


import pytest
from faker import Faker

from mallard.edge.routers.root import endpoints


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
