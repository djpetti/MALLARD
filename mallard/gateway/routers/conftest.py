"""
Testing configuration for the routers.
"""
from unittest import mock as mock

import pytest
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.gateway.backends.metadata import ArtifactMetadataStore
from mallard.gateway.backends.objects import ObjectStore
from mallard.gateway.routers.images import endpoints as image_endpoints
from mallard.gateway.routers.root import endpoints as root_endpoints
from mallard.gateway.routers.videos import endpoints as video_endpoints
from mallard.type_helpers import ArbitraryTypesConfig


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class ConfigForTests:
    """
    Encapsulates standard configuration for most tests.

    Attributes:
        mock_object_store: The mocked `ObjectStore` instance.
        mock_metadata_store: The mocked `ImageMetadataStore` instance.
        mock_streaming_response_class: The mocked `StreamingResponse` class.
    """

    mock_object_store: ObjectStore
    mock_metadata_store: ArtifactMetadataStore
    mock_streaming_response_class: mock.Mock


@pytest.fixture
def config(mocker: MockFixture) -> ConfigForTests:
    """
    Generates standard configuration for most tests.

    Args:
        mocker: The fixture to use for mocking.

    Returns:
        The configuration that it generated.

    """
    mock_object_store = mocker.create_autospec(ObjectStore, instance=True)
    mock_metadata_store = mocker.create_autospec(
        ArtifactMetadataStore, instance=True
    )

    mock_streaming_response_class = mocker.patch(
        image_endpoints.__name__ + ".StreamingResponse"
    )
    mocker.patch(
        root_endpoints.__name__ + ".StreamingResponse",
        new=mock_streaming_response_class,
    )
    mocker.patch(
        video_endpoints.__name__ + ".StreamingResponse",
        new=mock_streaming_response_class,
    )

    return ConfigForTests(
        mock_object_store=mock_object_store,
        mock_metadata_store=mock_metadata_store,
        mock_streaming_response_class=mock_streaming_response_class,
    )
