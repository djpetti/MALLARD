"""
Tests for the `authentication` module.
"""


import unittest.mock as mock

import pytest
from faker import Faker
from fastapi import HTTPException
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.type_helpers import ArbitraryTypesConfig

from .. import authentication
from ..config_view_mock import ConfigViewMock


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class ConfigForTests:
    """
    Encapsulates standard configuration for most tests.

    Attributes:
        mock_session: The mocked `aiohttp` session.
        mock_config: The mocked `ConfigurationView`.

    """

    mock_session: mock.Mock
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
    mock_session = mocker.patch(authentication.__name__ + ".session")

    # Mock the configuration.
    mock_config = mocker.patch(
        authentication.__name__ + ".config", new_callable=ConfigViewMock
    )
    # Make it look like we have an authentication URL configured.
    mock_config["security"]["auth_url"].return_value = faker.url()

    return ConfigForTests(mock_session=mock_session, mock_config=mock_config)


@pytest.mark.asyncio
async def test_check_auth_token(config: ConfigForTests, faker: Faker) -> None:
    """
    Tests that `check_auth_token` works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Make it look like we get a valid response.
    mock_response = (
        config.mock_session.post.return_value.__aenter__.return_value
    )
    mock_response.json.return_value = {"token_valid": True}

    # Generate a fake token.
    token = faker.pystr()

    # Act.
    await authentication.check_auth_token(token)

    # Assert.
    # It should have checked the token.
    config.mock_session.post.assert_called_once_with(
        mock.ANY, data={"token": token}
    )


@pytest.mark.asyncio
async def test_check_auth_token_invalid(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that `check_auth_token` works when the token is rejected.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Make it look like we get an invalid response.
    mock_response = (
        config.mock_session.post.return_value.__aenter__.return_value
    )
    mock_response.json.return_value = {"token_valid": False}

    # Generate a fake token.
    token = faker.pystr()

    # Act and assert.
    with pytest.raises(HTTPException):
        await authentication.check_auth_token(token)
