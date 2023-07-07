"""
Tests for the `dependencies` module.
"""
from collections.abc import Coroutine
from datetime import timedelta
from typing import Callable

import pytest
from faker import Faker
from pytest_mock import MockFixture

from mallard.gateway.backends.objects import ObjectStore
from mallard.gateway.routers.conftest import ConfigForTests

from .. import dependencies


@pytest.mark.asyncio
@pytest.mark.parametrize("exists", (True, False), ids=("existing", "new"))
@pytest.mark.parametrize(
    "use_bucket",
    (dependencies.use_bucket_images, dependencies.use_bucket_videos),
    ids=("images", "videos"),
)
async def test_use_bucket(
    config: ConfigForTests,
    mocker: MockFixture,
    faker: Faker,
    exists: bool,
    use_bucket: Callable[[ObjectStore], Coroutine[str]],
) -> None:
    """
    Tests that the `use_bucket` dependency function works.

    Args:
        config: The configuration to use for testing.
        mocker: The fixture to use for mocking.
        faker: The fixture to use for generating fake data.
        exists: Whether we want to simulate the bucket already existing or not.
        use_bucket: The specific variation of the use_bucket function to test.

    """
    # Arrange.
    # Make it produce a consistent date.
    mock_date_class = mocker.patch(dependencies.__name__ + ".date")
    fake_date = faker.date()
    mock_date_class.today.return_value.isoformat.return_value = fake_date

    config.mock_object_store.bucket_exists.return_value = False
    if exists:
        # Make it look like the bucket already exists.
        config.mock_object_store.bucket_exists.return_value = True

    # Act.
    got_bucket = await use_bucket(config.mock_object_store)

    # Assert.
    # It should have produced a good name.
    assert fake_date in got_bucket

    # It should have created the bucket only if necessary.
    config.mock_object_store.bucket_exists.assert_called_once_with(got_bucket)
    if not exists:
        config.mock_object_store.create_bucket.assert_called_once_with(
            got_bucket, exists_ok=True
        )
    else:
        config.mock_object_store.create_bucket.assert_not_called()

    # It should have used the proper suffix.
    if use_bucket.__name__.endswith("images"):
        assert got_bucket.endswith("images")
    elif use_bucket.__name__.endswith("videos"):
        assert got_bucket.endswith("videos")


def test_user_timezone(faker: Faker) -> None:
    """
    Tests that the `user_timezone` dependency function works.

    Args:
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    offset = faker.random_int(min=-24, max=24)

    # Act.
    got_timezone = dependencies.user_timezone(offset)

    # Assert.
    assert got_timezone.utcoffset(None) == timedelta(hours=offset)
