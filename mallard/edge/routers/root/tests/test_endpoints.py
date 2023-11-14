"""
Tests for the `endpoints` module.
"""


from collections.abc import Coroutine
from functools import partial
from typing import Callable

import pytest
from faker import Faker
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.edge.routers.root import endpoints
from mallard.gateway.backends.objects.models import ObjectType

from .....config_view_mock import ConfigViewMock
from .....type_helpers import ArbitraryTypesConfig


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class ConfigForTests:
    """
    Ecapsulates standard configuration for most tests.

    Attributes:
        mock_config: The mocked `ConfigurationView`.
        api_base_url: The API base URL to use for testing.
        auth_base_url: The authentication base URL to use for testing.
        auth_client_id: The authentication client ID to use for testing.

    """

    mock_config: ConfigViewMock
    api_base_url: str
    auth_base_url: str
    auth_client_id: str


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
    # Mock the configuration.
    mock_config = mocker.patch(
        endpoints.__name__ + ".config", new_callable=ConfigViewMock
    )

    # Make it look like we have an API base URL configured.
    api_base_url = faker.url()
    auth_base_url = faker.url()
    mock_config["api_base_url"].as_str.return_value = api_base_url
    mock_config["security"]["fief"][
        "base_url"
    ].as_str.return_value = auth_base_url

    client_id = faker.pystr()
    mock_config["security"]["fief"][
        "client_id"
    ].as_str.return_value = client_id

    return ConfigForTests(
        mock_config=mock_config,
        api_base_url=api_base_url,
        auth_base_url=auth_base_url,
        auth_client_id=client_id,
    )


@pytest.mark.parametrize(
    "endpoint",
    [
        endpoints.get_index,
        partial(
            endpoints.get_details, ObjectType.ARTIFACT.value, "bucket", "name"
        ),
    ],
    ids=["get_index", "get_details"],
)
@pytest.mark.parametrize("fragment", [False, True], ids=["normal", "fragment"])
@pytest.mark.asyncio
async def test_fragment(
    endpoint: Callable[..., Coroutine[str, None, None]],
    fragment: bool,
    config: ConfigForTests,
) -> None:
    """
    Tests that we can get fragment versions of each page.

    Args:
        endpoint: The endpoint function to test.
        fragment: Whether to get the page as a fragment or not.
        config: The configuration to use for testing.

    """
    # Act.
    got_response = await endpoint(fragment=fragment)

    # Assert.
    if not fragment:
        # It should have gotten a complete page.
        assert "</html>" in got_response
        # It should have specified the base URL.
        assert config.api_base_url in got_response
    else:
        # It should have gotten a fragment.
        assert "</html>" not in got_response


@pytest.mark.asyncio
async def test_get_index(config: ConfigForTests) -> None:
    """
    Tests that the `get_index` endpoint works.

    Args:
        config: The configuration to use for testing.

    """
    # Act.
    got_response = await endpoints.get_index()

    # Assert.
    # It should have made the response.
    assert "</html>" in got_response

    # It should have specified the global variables.
    assert config.auth_base_url in got_response
    assert config.auth_client_id in got_response
    assert config.api_base_url in got_response


@pytest.mark.asyncio
async def test_get_details(faker: Faker, config: ConfigForTests) -> None:
    """
    Tests that the `get_details` endpoint works.

    Args:
        faker: The fixture to use for generating fake data.
        config: The configuration to use for testing.

    """
    # Arrange.
    bucket = faker.pystr()
    name = faker.pystr()
    object_type = faker.random_element(ObjectType)

    # Act.
    got_response = await endpoints.get_details(object_type, bucket, name)

    # Assert.
    # It should have filled in the template.
    assert "</html>" in got_response
    assert "</artifact-details>" in got_response
    assert bucket in got_response
    assert name in got_response

    # It should have specified the global variables.
    assert config.auth_base_url in got_response
    assert config.auth_client_id in got_response
    assert config.api_base_url in got_response


@pytest.mark.asyncio
async def test_get_auth_callback(config: ConfigForTests) -> None:
    """
    Tests that the `get_auth_callback` endpoint works.

    Args:
        config: The configuration to use for testing.

    """
    # Act.
    got_response = await endpoints.get_auth_callback()

    # Assert.
    # It should have filled in the template.
    assert "</html>" in got_response
    assert "mallard-auth.min.js" in got_response

    # It should have specified the global variables.
    assert config.auth_base_url in got_response
    assert config.auth_client_id in got_response
    assert config.api_base_url in got_response
