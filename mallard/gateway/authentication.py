"""
Encapsulates boilerplate code for handling authentication.
"""


from functools import cache
from urllib.parse import urljoin

from fastapi.security import OAuth2AuthorizationCodeBearer
from fief_client import FiefAsync
from fief_client.integrations.fastapi import FiefAuth

from ..config import config


@cache
def get_auth() -> FiefAuth:
    """
    Returns:
        The `FiefAuth` instance to use.

    """
    fief_config = config["security"]["fief"]
    base_url = fief_config["base_url"].as_str()

    fief = FiefAsync(
        base_url,
        fief_config["client_id"].as_str(),
        verify=fief_config["verify_ssl"].get(bool),
    )
    scheme = OAuth2AuthorizationCodeBearer(
        urljoin(base_url, "authorize"),
        urljoin(base_url, "api/token"),
        scopes={"openid": "openid", "offline_access": "offline_access"},
        auto_error=False,
    )

    return FiefAuth(fief, scheme)
