"""
Encapsulates boilerplate code for handling authentication.
"""


from functools import cache
from urllib.parse import urljoin

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2AuthorizationCodeBearer
from fief_client import (
    FiefAccessTokenExpired,
    FiefAccessTokenInfo,
    FiefAccessTokenInvalid,
    FiefAsync,
)
from fief_client.integrations.fastapi import FiefAuth

from ..config import config


@cache
def _get_client() -> FiefAsync:
    """
    Returns:
        The `FiefAsync` client instance.

    """
    fief_config = config["security"]["fief"]
    base_url = fief_config["base_url"].as_str()

    return FiefAsync(
        base_url,
        fief_config["client_id"].as_str(),
        verify=fief_config["verify_ssl"].get(bool),
    )


@cache
def _get_auth() -> FiefAuth:
    """
    Returns:
        The `FiefAuth` instance to use.

    """
    fief_config = config["security"]["fief"]
    base_url = fief_config["base_url"].as_str()

    scheme = OAuth2AuthorizationCodeBearer(
        urljoin(base_url, "authorize"),
        urljoin(base_url, "api/token"),
        scopes={"openid": "openid", "offline_access": "offline_access"},
        auto_error=False,
    )

    return FiefAuth(_get_client(), scheme)


async def flexible_token(
    token_info: FiefAccessTokenInfo = Depends(
        _get_auth().authenticated(optional=True)
    ),
    auth_token: str | None = None,
) -> FiefAccessTokenInfo:
    """
    Gets the access token information from either the header, or from a query parameter.

    Args:
        token_info: The access token information from the header.
        auth_token: Optional authentication token passed via a query parameter.

    Returns:
        The access token information.

    """
    if token_info is not None:
        # We got it from the header.
        return token_info
    if auth_token is None:
        # No token provided.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    # Check the query token.
    client = _get_client()
    try:
        token_info = await client.validate_access_token(auth_token)
    except (FiefAccessTokenInvalid, FiefAccessTokenExpired):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    return token_info
