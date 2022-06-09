"""
Tests for the `time_expiring_cache` module.
"""


from datetime import datetime, timedelta

from faker import Faker
from pytest_mock import MockFixture

from mallard.gateway.backends import time_expiring_cache


def test_normal_cache(faker: Faker, mocker: MockFixture) -> None:
    """
    Tests that the basic cache functionality works.

    Args:
        faker: The fixture to use for generating fake data.
        mocker: The fixture to use for mocking.

    """
    # Arrange.
    string_1 = faker.sentence()
    string_2 = faker.sentence()

    # Create a fake function to wrap.
    unwrapped = mocker.Mock()
    wrapped = time_expiring_cache.time_expiring_cache(timedelta(weeks=1))(
        unwrapped
    )

    # Act.
    wrapped(string_1)
    wrapped(string_2)
    wrapped(string_1)

    # Assert.
    # It should have called the function only once with each input.
    assert unwrapped.call_count == 2
    unwrapped.assert_any_call(string_1)
    unwrapped.assert_any_call(string_2)


def test_expiry(faker: Faker, mocker: MockFixture) -> None:
    """
    Tests that cache items expire after the time limit.

    Args:
        faker: The fixture to use for generating fake data.
        mocker: The fixture to use for mocking.

    """
    # Arrange.
    # Mock the time.time() call, so we can make it look like it expired.
    mock_time = mocker.patch(f"{time_expiring_cache.__name__}.time.time")
    # By default, this operates as a pass-through.
    mock_time.return_value = datetime.now().timestamp()

    # Create a fake function to wrap.
    unwrapped = mocker.Mock()
    wrapped = time_expiring_cache.time_expiring_cache(timedelta(hours=1))(
        unwrapped
    )

    # Act.
    # Add something to the cache.
    string_1 = faker.sentence()
    wrapped(string_1)

    # Now make it look like it's the future.
    mock_time.return_value = (datetime.now() + timedelta(hours=2)).timestamp()
    # It should treat the value as expired on the next call.
    wrapped(string_1)

    # Assert.
    # The value should have been expired.
    assert unwrapped.call_count == 2
    unwrapped.assert_any_call(string_1)
