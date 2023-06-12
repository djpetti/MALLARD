"""
Utilities for interacting with CLI applications.
"""


import subprocess
from functools import cache
from pathlib import Path
from subprocess import CalledProcessError

from loguru import logger


@cache
def find_exe(tool_name: str) -> Path:
    """
    Finds a particular command-line tool.

    Args:
        tool_name: The name of the tool.

    Returns:
        The path to the tool.

    """
    which_output = ""
    try:
        which_result = subprocess.run(
            ["/usr/bin/which", tool_name], check=True, capture_output=True
        )
        which_output = which_result.stdout.decode("utf8")
    except CalledProcessError as err:
        if err.returncode != 1:  # pragma: no cover
            # If it returns 1, it's probably because the executable does not
            # exist. Otherwise, something weird happened.
            raise err
        pass
    if not which_output:
        raise OSError(f"Could not find '{tool_name}'. Is it installed?")

    tool_path = Path(which_output.rstrip("\n"))
    logger.debug("Using {} executable: {}", tool_name, tool_path)
    return tool_path
