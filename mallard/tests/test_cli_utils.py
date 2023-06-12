"""
Tests for the `cli_utils` module.
"""


import pytest

from mallard import cli_utils


def test_find_exe():
    """
    Tests that `find_exe` works.

    """
    # Act.
    ls_exe = cli_utils.find_exe("ls")

    # Assert.
    assert ls_exe.exists()


def test_find_exe_nonexistent():
    """
    Tests that `find_exe` raises an exception when the executable is not found.

    """
    # Act.
    with pytest.raises(OSError):
        cli_utils.find_exe("nonexistent")
