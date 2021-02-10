"""
Encapsulates code for handling authentication.
"""

from typing import TypeVar

from fastapi import Header, HTTPException
from loguru import logger

from .aiohttp_session import session
from .config import config

ResponseType = TypeVar("ResponseType")


async def check_auth_token(x_api_token: str = Header(...)) -> None:
    """
    Dependency for checking an authentication token.

    The way this works is that it will read the token from the `X-Api-Token`
    header, verify the token with an external server, and determine whether to
    proceed or not based on the server's response.

    Args:
        x_api_token: The authentication token.

    """
    # Check the validity of the token.
    logger.debug("Verifying token validity...")
    auth_url = config["security"]["auth_url"].as_str()
    async with session.post(auth_url, data={"token": x_api_token}) as response:
        await response.raise_for_status()
        json_response = await response.json()

    if not json_response["token_valid"]:
        # Authentication server rejected our token.
        logger.error("Token was rejected by authentication server.")
        raise HTTPException(
            status_code=401, detail="Authentication token is invalid."
        )

    # Otherwise, proceed as normal.
    logger.debug("Token is valid.")
