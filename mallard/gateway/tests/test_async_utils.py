"""
Tests for the `async_utils` module.
"""


import enum
import time
from typing import Iterable

import pytest
from faker import Faker

from mallard.gateway import async_utils


def test_get_process_pool() -> None:
    """
    Tests that `get_process_pool` works.

    """
    # Arrange.
    # Make sure the cache is cleared.
    async_utils.get_process_pool.cache_clear()

    # Act.
    first_pool = async_utils.get_process_pool()
    second_pool = async_utils.get_process_pool()

    # Assert.
    # It should have memoized.
    assert first_pool == second_pool


@enum.unique
class ConditionForTest(enum.IntEnum):
    """
    Identifiers for conditions that we want to test.
    """

    NO_DELAY = enum.auto()
    """
    Underlying iterator gets results immediately.
    """
    CONSTANT_DELAY = enum.auto()
    """
    Underlying iteration incurs a small but consistent delay.
    """
    RANDOM_DELAY = enum.auto()
    """
    Underlying iteration incurs arbitrary delays.
    """


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "condition", ConditionForTest, ids=[m.name for m in ConditionForTest]
)
async def test_make_async_iter(condition: ConditionForTest) -> None:
    """
    Tests that `make_async_iter` works.

    Args:
        condition: The condition to test.

    """
    # Arrange.
    test_items = list(range(10))

    if condition == ConditionForTest.NO_DELAY:
        # Delays are all zero.
        delays = [0] * 10
    if condition == ConditionForTest.CONSTANT_DELAY:
        # Delays are constant.
        delays = [0.01] * 10
    if condition == ConditionForTest.RANDOM_DELAY:
        # Delays are arbitrary.
        delays = [0.01, 0.1, 0.05, 0.0, 0.15] * 2

    # Create the fake synchronous iterable.
    def sync_iter() -> Iterable[int]:
        for item, delay in zip(test_items, delays):
            time.sleep(delay)
            yield item

    # Act.
    got_items = [i async for i in async_utils.make_async_iter(sync_iter())]

    # Assert.
    # It should have gotten the correct items.
    assert got_items == test_items


@pytest.mark.asyncio
async def test_make_async_iter_empty() -> None:
    """
    Tests that `make_async_iter` works with an empty iterable.

    """
    # Act.
    got_items = [i async for i in async_utils.make_async_iter([])]

    # Assert.
    assert got_items == []


@pytest.mark.asyncio
async def test_make_async_iter_exception() -> None:
    """
    Tests that `make_async_iter` properly handles it when the underlying
    synchronous iteration raises an exception.

    """

    # Arrange.
    # This will raise an exception when iterated.
    def failing_iterable() -> Iterable[int]:
        yield from [0, 1, 2]
        raise ValueError("Hark! An Error!")

    # Act and assert.
    with pytest.raises(ValueError, match="Hark"):
        async for _ in async_utils.make_async_iter(failing_iterable()):
            pass


@pytest.mark.asyncio
@pytest.mark.parametrize("max_length", [None, 512], ids=["no_limit", "limit"])
async def test_read_file_chunks(faker: Faker, max_length: int | None) -> None:
    """
    Tests that `read_file` works.

    Args:
        faker: The fixture to use for generating fake data.
        max_length: The maximum length of the data to read from the file.

    """
    # Arrange.
    contents = faker.binary(length=1024)
    upload_file = faker.upload_file(contents=contents)

    # Act.
    chunk_iter = async_utils.read_file_chunks(
        upload_file, max_length=max_length, chunk_size=32
    )
    got_chunks = [chunk async for chunk in chunk_iter]

    # Assert.
    # It should have read the same content.
    combined = b"".join(got_chunks)
    if max_length is None:
        assert combined == contents
    else:
        # It should have truncated the content (to the nearest chunk).
        expected_size = max_length + (max_length % 32)
        assert combined == contents[:expected_size]
