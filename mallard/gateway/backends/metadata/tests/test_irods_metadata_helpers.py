"""
Tests for the `irods_metadata_helpers` module.
"""


from datetime import date, datetime
from typing import Any

import pytest

from mallard.gateway.backends.metadata import irods_metadata_helpers


@pytest.mark.parametrize(
    "test_value",
    (
        "abra cadabra",
        15485863,
        3.14159265,
        datetime(1997, 7, 25, 14, 23, 15),
        date(1941, 12, 7),
        None,
    ),
    ids=("string", "int", "float", "datetime", "date", "none"),
)
def test_irods_conversion_round_trip(test_value: Any) -> None:
    """
    Tests that we can convert a value into a string suitable for storage as
    iRODS metadata, and then convert it back again.

    Args:
        test_value: The test value that we are converting.

    """
    # Act.
    # Serialize and deserialize.
    irods_string = irods_metadata_helpers.to_irods_string(test_value)
    got_value = irods_metadata_helpers.from_irods_string(irods_string)

    # Assert.
    # It should actually be a valid string.
    assert type(irods_string) == str

    # It should not have been mutated.
    if type(test_value) == float:
        # For floats, use approximate comparison.
        assert pytest.approx(got_value) == test_value
    else:
        assert got_value == test_value
