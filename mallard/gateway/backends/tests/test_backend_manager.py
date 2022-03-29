"""
Tests for the `backend_manager` module.
"""


import unittest.mock as mock

import pytest
from confuse import ConfigTypeError
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.config_view_mock import ConfigViewMock
from mallard.gateway.backends import backend_manager
from mallard.gateway.backends.metadata import MetadataStore
from mallard.gateway.backends.objects import ObjectStore
from mallard.type_helpers import ArbitraryTypesConfig


class TestBackendManager:
    """
    Tests for the `BackendManager` class.
    """

    @dataclass(frozen=True, config=ArbitraryTypesConfig)
    class ConfigForTests:
        """
        Encapsulates standard configuration for most tests.

        Attributes:
            manager: The `BackendManager` object under test.
            mock_import_module: The mocked `import_module` function.
            mock_config: The mocked `ConfigView` instance.
            mock_issubclass: Mocked `issubclass` function.
            mock_object_store_class: The mocked `ObjectStore` subclass to use.
            mock_metadata_store_class: The mocked `MetadataStore` subclass to
                use.
        """

        manager: backend_manager.BackendManager
        mock_import_module: mock.Mock
        mock_config: ConfigViewMock
        mock_issubclass: mock.Mock
        mock_object_store_class: mock.Mock
        mock_metadata_store_class: mock.Mock

    @classmethod
    @pytest.fixture
    async def config(cls, mocker: MockFixture) -> ConfigForTests:
        """
        Generates standard configuration for most tests.

        Args:
            mocker: The fixture to use for mocking.

        Returns:
            The configuration that it generated.

        """
        # Mock the dependencies.
        mock_import_module = mocker.patch("importlib.import_module")
        mock_config = mocker.patch(
            backend_manager.__name__ + ".config", new_callable=ConfigViewMock
        )

        mock_issubclass = mocker.patch(
            backend_manager.__name__ + ".issubclass"
        )
        # Default to making this check always pass.
        mock_issubclass.return_value = True

        # Set the correct configuration.
        mock_object_view = mock_config["backends"]["object_store"]
        mock_metadata_view = mock_config["backends"]["metadata_store"]
        mock_object_view[
            "type"
        ].as_str.return_value = "test_store.TestObjectStore"
        mock_metadata_view[
            "type"
        ].as_str.return_value = "test_store.TestMetadataStore"

        # Create the fake store classes and enclosing module.
        mock_object_store_class = mocker.create_autospec(ObjectStore)
        mock_metadata_store_class = mocker.create_autospec(MetadataStore)
        mock_module = mocker.Mock(
            spec_set=["TestObjectStore", "TestMetadataStore"]
        )
        mock_module.TestObjectStore = mock_object_store_class
        mock_module.TestMetadataStore = mock_metadata_store_class
        # Make it look like we can import this.
        mock_import_module.return_value = mock_module

        async with backend_manager.BackendManager.create() as manager:
            yield cls.ConfigForTests(
                manager=manager,
                mock_import_module=mock_import_module,
                mock_config=mock_config,
                mock_issubclass=mock_issubclass,
                mock_object_store_class=mock_object_store_class,
                mock_metadata_store_class=mock_metadata_store_class,
            )

    @pytest.mark.asyncio
    async def test_object_store(
        self, config: ConfigForTests, mocker: MockFixture
    ) -> None:
        """
        Tests that we can properly load the object store.

        Args:
            config: The configuration to use for testing.
            mocker: The fixture to use for mocking.

        """
        # Arrange.
        # Act.
        object_store = config.manager.object_store

        # Assert.
        # It should have used the fake ObjectStore class.
        config.mock_object_store_class.from_config.assert_called_once_with(
            config.mock_config["backends"]["object_store"]["config"]
        )
        assert (
            object_store
            == config.mock_object_store_class.from_config.return_value.__aenter__.return_value
        )

        # It should have imported the class.
        config.mock_import_module.assert_any_call("test_store")

    def test_metadata_store(
        self, config: ConfigForTests, mocker: MockFixture
    ) -> None:
        """
        Tests that we can properly load the metadata store.

        Args:
            config: The configuration to use for testing.
            mocker: The fixture to use for mocking.

        """
        # Arrange.
        # Act.
        metadata_store = config.manager.metadata_store

        # Assert.
        # It should have used the fake ObjectStore class.
        config.mock_metadata_store_class.from_config.assert_called_once_with(
            config.mock_config["backends"]["metadata_store"]["config"]
        )
        assert (
            metadata_store
            == config.mock_metadata_store_class.from_config.return_value.__aenter__.return_value
        )

        # It should have imported the class.
        config.mock_import_module.assert_any_call("test_store")

    @pytest.mark.asyncio
    async def test_load_invalid_type_spec(
        self, config: ConfigForTests
    ) -> None:
        """
        Tests that loading a backend fails if the type spec is invalid.

        Args:
            config: The configuration to use for testing.

        """
        # Arrange.
        mock_store_view = config.mock_config["backends"]["object_store"]
        # Make this not point to a class.
        mock_store_view["type"].as_str.return_value = "invalid"

        # Act and assert.
        with pytest.raises(ConfigTypeError, match="config is not valid"):
            async with backend_manager.BackendManager.create():
                pass

    @pytest.mark.asyncio
    async def test_load_missing_class(
        self, config: ConfigForTests, mocker: MockFixture
    ) -> None:
        """
        Tests that loading a backend fails if the specified type class does
        not exist.

        Args:
            config: The configuration to use for testing.
            mocker: The fixture to use for mocking.

        """
        # Arrange.
        # Set the correct configuration.
        mock_store_view = config.mock_config["backends"]["object_store"]
        mock_store_view["type"].as_str.return_value = "test_store.TestStore"

        # Make it look like we load a module without the correct class.
        config.mock_import_module.return_value = mocker.Mock(spec_set=[])

        # Act and assert.
        with pytest.raises(ConfigTypeError, match="does not exist"):
            async with backend_manager.BackendManager.create():
                pass

    @pytest.mark.asyncio
    async def test_load_failed_type_check(
        self, config: ConfigForTests, mocker: MockFixture
    ) -> None:
        """
        Tests that loading a backend fails if the specified type class is not
        supported for that backend.

        Args:
            config: The configuration to use for testing.
            mocker: The fixture to use for mocking.

        """
        # Arrange.
        # Set the correct configuration.
        mock_store_view = config.mock_config["backends"]["object_store"]
        mock_store_view["type"].as_str.return_value = "test_store.TestStore"

        # Create the fake store class and enclosing module.
        mock_store_class = mocker.create_autospec(ObjectStore)
        # We need the __name__ attribute for the error message.
        mock_store_class.__name__ = "TestStore"
        mock_module = mocker.Mock(spec_set=["TestStore"])
        mock_module.TestStore = mock_store_class
        # Make it look like we can import this.
        config.mock_import_module.return_value = mock_module

        # Make it look like the type check fails.
        config.mock_issubclass.return_value = False

        # Act and assert.
        with pytest.raises(ConfigTypeError, match="Expected a subclass"):
            async with backend_manager.BackendManager.create():
                pass

    @pytest.mark.asyncio
    async def test_depend(self, config: ConfigForTests) -> None:
        """
        Tests that the `depend` method works.

        Args:
            config: The configuration to use for testing.

        """
        # Act and assert.
        async for manager in backend_manager.BackendManager.depend():
            assert isinstance(manager, backend_manager.BackendManager)
