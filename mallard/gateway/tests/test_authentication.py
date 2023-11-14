"""
Tests for the `authentication` module.
"""


import unittest.mock as mock
from typing import Type

import pytest
from faker import Faker
from fastapi import HTTPException
from fief_client import FiefAccessTokenExpired, FiefAccessTokenInvalid
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from ...config_view_mock import ConfigViewMock
from ...type_helpers import ArbitraryTypesConfig
from .. import authentication


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class ConfigForTests:
    """
    Encapsulates standard configuration for most tests.

    Attributes:
        mock_fief_async_class: The mocked `FiefAsync` class.
        mock_fief_auth_class: The mocked `FiefAuth` class.
        mock_config: The mocked `ConfigurationView`.

    """

    mock_fief_async_class: mock.Mock
    mock_fief_auth_class: mock.Mock
    mock_config: ConfigViewMock


@pytest.fixture()
def config(mocker: MockFixture, faker: Faker) -> ConfigForTests:
    """
    Encapsulates standard configuration for most tests.

    Args:
        mocker: The fixture to use for mocking.
        faker: The fixture to use for generating fake data.

    Returns:
        The configuration that it created.

    """
    mock_fief_async_class = mocker.patch(
        f"{authentication.__name__}.FiefAsync"
    )
    mock_fief_auth_class = mocker.patch(f"{authentication.__name__}.FiefAuth")

    # Clear these caches to force it to reload and use the mocked versions.
    authentication._get_client.cache_clear()
    authentication._get_auth.cache_clear()

    # The mocker does not understand that these methods are async,
    # so we have to mock them manually.
    mock_fief_async_class.return_value.validate_access_token = (
        mocker.AsyncMock()
    )

    # Mock the configuration.
    mock_config = mocker.patch(
        authentication.__name__ + ".config", new_callable=ConfigViewMock
    )
    # Make it look like we have an authentication URL configured.
    mock_fief_config = mock_config["security"]["fief"]
    mock_fief_config["client_id"].as_str.return_value = faker.pystr()
    mock_fief_config["base_url"].as_str.return_value = faker.url()
    mock_fief_config["verify_ssl"].get.return_value = faker.pybool()

    return ConfigForTests(
        mock_config=mock_config,
        mock_fief_async_class=mock_fief_async_class,
        mock_fief_auth_class=mock_fief_auth_class,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "in_query", [True, False], ids=["in_query", "in_headers"]
)
async def test_flexible_token(
    config: ConfigForTests, faker: Faker, in_query: bool
) -> None:
    """
    Tests that `flexible_token` works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        in_query: Whether the token should be passed in the query string or
            the headers.

    """
    # Arrange.
    # Create a fake token.
    token = faker.pystr()

    # Make it look like the token is valid.
    mock_fief_client = config.mock_fief_async_class.return_value
    token = faker.fief_access_token_info()
    mock_fief_client.validate_access_token.return_value = token

    # Act.
    if in_query:
        got_token_info = await authentication.flexible_token(
            None, auth_token=token["access_token"]
        )
    else:
        got_token_info = await authentication.flexible_token(token_info=token)

    # Assert.
    assert got_token_info == token

    if in_query:
        # It should have verified the token.
        mock_fief_client.validate_access_token.assert_called_once_with(
            token["access_token"]
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [FiefAccessTokenInvalid, FiefAccessTokenExpired],
    ids=["invalid", "expired"],
)
async def test_flexible_token_invalid(
    config: ConfigForTests, faker: Faker, error: Type[Exception]
) -> None:
    """
    Tests that `check_auth_token` works when the token is rejected.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        error: The error to simulate.

    """
    # Arrange.
    # Make it look like the token is invalid.
    mock_fief_client = config.mock_fief_async_class.return_value
    mock_fief_client.validate_access_token.side_effect = error

    # Generate a fake token.
    token = faker.pystr()

    # Act and assert.
    with pytest.raises(HTTPException):
        await authentication.flexible_token(None, auth_token=token)


@pytest.mark.asyncio
async def test_flexible_token_not_provided(config: ConfigForTests) -> None:
    """
    Tests that `check_auth_token` restricts access when no token is provided.

    Args:
        config: The configuration to use for testing.

    """
    # Act and assert.
    with pytest.raises(HTTPException):
        await authentication.flexible_token(None)
