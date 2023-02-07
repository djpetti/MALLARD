"""
This module exists purely to provide a global session for `aiohttp`.
"""


import aiohttp

session = None


async def init_session() -> None:
    """
    Initializes the global `aiohttp` session.

    """
    global session
    session = aiohttp.ClientSession()


async def close_session() -> None:
    """
    Closes the global `aiohttp` session.

    """
    global session
    if session is not None:
        await session.close()
