"""
Tests for the `endpoints` module.
"""


import pytest

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
